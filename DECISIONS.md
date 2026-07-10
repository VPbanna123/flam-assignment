# Architecture Decisions

This document answers the five required assignment questions using the current codebase. File and function references are intentionally specific so the design can be reviewed from source.

## 1. Atomic Job Claiming

The atomic claim lives in `JobRepository.claimNext()` in `src/repositories/JobRepository.js`.

The important lines are:

- `src/repositories/JobRepository.js:53-92`: `claimNext(workerId, { leaseMs })`.
- `src/repositories/JobRepository.js:54`: `this.db.transaction(() => { ... })` wraps the claim flow.
- The guarded update:
  - `UPDATE jobs`
  - `SET state = 'processing', worker_id = ?, heartbeat_at = ?, lease_expires_at = ?, started_at = ?, updated_at = ?`
  - `WHERE id = ?`
  - `AND state IN ('pending', 'failed')`
  - `AND next_retry_at <= ?`
  - `AND run_at <= ?`
- `src/repositories/JobRepository.js:71-83`: the guarded `UPDATE`.
- `src/repositories/JobRepository.js:85-87`: the `result.changes !== 1` check.

Why this is atomic across separate OS processes:

SQLite serializes writes to the same database file. This project enables WAL mode and a busy timeout in `initializeSchema()` at `src/database/schema.js:3-6`, so separate worker processes can coordinate through the same SQLite file. Two workers may both read the same candidate id, but only one can successfully update that row while it is still in `pending` or retryable `failed`. Once the first worker changes the state to `processing`, the second worker's `WHERE state IN ('pending', 'failed')` no longer matches, so its update changes zero rows and the worker does not execute the job.

The design deliberately does not rely on an in-memory mutex, because workers can run in separate terminal sessions and separate OS processes. The database row transition is the lock.

## 2. SIGKILL Crash Recovery

When a worker claims a job, `JobRepository.claimNext()` at `src/repositories/JobRepository.js:53-92` sets:

- `state = 'processing'`
- `worker_id = <worker id>`
- `heartbeat_at = now`
- `lease_expires_at = now + job_lease_ms`
- `started_at = now`

The defaults are defined in `src/utils/constants.js:20-28`:

- `job_lease_ms = 30000`
- `job_heartbeat_interval_ms = 10000`
- `recovery_interval_ms = 10000`

Step by step when a worker is `SIGKILL`ed halfway through a job:

1. The job is already in `processing`, owned by the killed worker, with a `lease_expires_at` timestamp.
2. `SIGKILL` prevents the worker from running cleanup code. It cannot mark the job completed, failed, or stopped.
3. No further job heartbeat can be written by that worker.
4. Another running worker, or a worker started later, calls `Worker.recoverExpiredJobs()` during its polling loop at `src/core/Worker.js:37-40`.
5. `recoverExpiredJobs()` at `src/core/Worker.js:156-176` calls `JobRepository.recoverExpiredProcessingJobs()`.
6. `JobRepository.recoverExpiredProcessingJobs()` at `src/repositories/JobRepository.js:111-145` finds `processing` jobs whose `lease_expires_at <= now`.
7. It atomically moves those jobs back to `pending`, clears `worker_id`, `heartbeat_at`, `lease_expires_at`, and `started_at`, sets `next_retry_at` to now, and records `last_error = 'Worker lease expired while processing'`.
8. The same or another worker can then claim the job again through the normal atomic claim path.

Worst-case recovery delay with defaults is under 60 seconds. A healthy job lease lasts 30 seconds, and workers scan for recovery every 10 seconds. In practice that means a crashed job is eligible after the lease expires and is normally recovered on the next recovery scan, so the expected worst case is about 40 seconds plus normal polling/database scheduling overhead.

Tradeoff: this system is at-least-once, not exactly-once at the external side-effect level. If a shell command performs an external side effect and then the worker is killed before QueueCTL records completion, the job can be run again. QueueCTL prevents two live workers from owning the same job at the same time, and it prevents permanent `processing` jobs, but shell commands should still be written idempotently when side effects matter.

## 3. DLQ Retry Attempts

`dlq retry <id>` resets `attempts` to `0`.

The implementation is `JobRepository.retryDead()` at `src/repositories/JobRepository.js:249-267`. It updates a `dead` job to:

- `state = 'pending'`
- `attempts = 0`
- `worker_id = NULL`
- `heartbeat_at = NULL`
- `lease_expires_at = NULL`
- `next_retry_at = now`
- `run_at = now`
- `last_error = NULL`

This is the right call for this assignment because manually retrying from the DLQ is an operator decision. By the time a job is in `dead`, automatic retries have been exhausted. A human retry usually means something outside the job changed: a dependency came back, config was fixed, a command was corrected elsewhere, or the operator intentionally wants a fresh retry budget.

The tradeoff is that repeated manual retries can hide a permanently broken job. The system keeps the same job id and timestamps/errors in SQLite, but it does not keep a separate DLQ retry audit table. A production expansion could add `dead_at`, `retried_at`, or a job-events table if auditability became important.

Config note: `max_retries` and `timeout_ms` are copied onto the job when it is enqueued in `JobService.enqueue()` at `src/services/JobService.js:15` and `src/services/JobService.js:28`, so later config changes do not rewrite already-enqueued jobs. `backoff_base` is read when a failure is processed in `RetryManager.buildFailure()` at `src/core/RetryManager.js:11`, so changing it affects future retry scheduling.

## 4. Cross-Process Worker Stop

The chosen design is a SQLite worker registry, implemented in `WorkerRepository` and used by `WorkerService`.

`queuectl worker stop` calls `stopWorkerCommand()` at `src/commands/workerCommand.js:27-36`, which calls `workerService.requestStopForRunningWorkers()`. That delegates to `WorkerRepository.requestStopForRunning()` at `src/repositories/WorkerRepository.js:58-66`, which sets `stop_requested_at` for all running workers. Workers check `workerService.shouldStop(workerId)` between jobs in `Worker.start()` at `src/core/Worker.js:37`. Because the check happens between jobs, workers finish the current job before exiting.

Designs considered and rejected:

- PID registry with OS signals: A PID registry would work for same-machine workers, but stale PIDs are easy to mishandle after crashes or PID reuse. It also makes Windows support and signal semantics less clean. QueueCTL already needs SQLite for jobs, so a DB-backed stop request is simpler and durable.
- Control socket: A socket can provide fast signaling, but it introduces socket lifecycle management, port/path conflicts, cleanup after crashes, and more operational surface area than this assignment needs.
- Global config stop flag only: The earlier simple approach used a shared config flag. It can stop workers, but it is coarse and can be accidentally cleared by a new `worker start`. The worker registry is more precise because it records stop requests against currently running workers.

The tradeoff of the SQLite registry is that stop latency depends on the worker loop. An idle worker stops on the next poll. A busy worker exits only after its current shell command finishes, which is intentional for graceful shutdown.

## 5. Future Priority Queues

Priority is already partially supported. Jobs have a `priority` column at `src/database/schema.js:18`, and `JobRepository.claimNext()` orders candidates at `src/repositories/JobRepository.js:63` by:

```sql
ORDER BY priority DESC, run_at ASC, created_at ASC
```

What survives unchanged:

- The repository/service layering.
- SQLite persistence.
- Atomic claiming through a guarded `UPDATE`.
- Worker process model.
- Retry, DLQ, worker registry, and crash recovery.
- The `list --json` interface because job objects already include persisted fields.

What would need work:

- CLI validation and documentation for priority would need to be promoted from optional payload support to a first-class user-facing feature.
- If the requirement became multiple named priority queues, the schema would need a `queue` or `queue_name` column and the claim index would need to include it.
- If priority changes were allowed after enqueue, an update command and concurrency rules around reprioritizing `pending` versus `processing` jobs would be needed.
- Fairness rules would need a product decision. Strict priority can starve low-priority jobs. Aging or per-priority quotas would require changes to the claim ordering.

The current design handles simple integer priorities well because priority is part of the persisted job row and the atomic claim query already sorts by it. More advanced scheduling policies would be incremental changes around the claim query and indexes, not a rewrite of the worker architecture.
