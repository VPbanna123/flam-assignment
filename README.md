# queuectl

`queuectl` is a production-style CLI background job queue that stores all state in SQLite and executes shell commands with multiple cooperative workers. It is built from scratch with Node.js, ES modules, `better-sqlite3`, Commander.js, `uuid`, and Jest.

No BullMQ, RabbitMQ, Redis Queue, Celery, Agenda, Bree, or existing queue framework is used.

## Architecture Diagram

```text
CLI commands
  |
  v
Services: JobService, WorkerService, ConfigService
  |
  v
Repositories: JobRepository, ConfigRepository, WorkerRepository
  |
  v
SQLite: jobs, config, workers
  ^
  |
Worker loop -> recover expired leases -> atomic claim -> heartbeat lease -> child_process.exec -> complete / retry / DLQ
```

## Folder Structure

```text
src/
  cli/            Commander command registration
  commands/       CLI handlers
  core/           worker, execution, locking, retry logic
  database/       SQLite connection and schema
  repositories/   persistence layer
  services/       application layer
  utils/          logging, validation, time, constants
  models/         job model
tests/            Jest tests
scripts/          runnable demo
```

## Requirements

- Node.js 20+
- npm
- SQLite support through `better-sqlite3`

## Installation

```bash
npm install
npm link
```

`npm link` is optional. Without it, use `node src/cli/index.js`.

## Running

```bash
queuectl enqueue '{"id":"job1","command":"echo hello"}'
queuectl worker start
```

Start multiple workers in one foreground process:

```bash
queuectl worker start --count 3
```

Request graceful shutdown:

```bash
queuectl worker stop
```

Workers finish the current job, observe the stop flag in SQLite, and exit.

## CLI Commands

```bash
queuectl enqueue '{"id":"job1","command":"echo hello"}'
queuectl worker start
queuectl worker start --count 3
queuectl worker stop
queuectl status
queuectl list
queuectl list --state pending
queuectl list --state pending --json
queuectl dlq list
queuectl dlq retry job1
queuectl config set max-retries 5
queuectl config set backoff-base 2
queuectl config get
```

Configuration aliases accept dashed or underscored names:

- `max-retries` / `max_retries`
- `backoff-base` / `backoff_base`
- `poll-interval-ms` / `poll_interval_ms`
- `job-timeout-ms` / `job_timeout_ms`
- `job-lease-ms` / `job_lease_ms`
- `job-heartbeat-interval-ms` / `job_heartbeat_interval_ms`
- `recovery-interval-ms` / `recovery_interval_ms`

## Job Payload

Minimum payload:

```json
{"id":"job1","command":"echo hello"}
```

Optional fields:

```json
{
  "id": "nightly-report",
  "command": "node scripts/report.js",
  "max_retries": 5,
  "priority": 10,
  "run_at": "2026-07-10T10:00:00.000Z",
  "timeout_ms": 60000
}
```

If `id` is omitted, `queuectl` generates a UUID.

## Database Schema

The database is created automatically at `queue.db`, or at `QUEUECTL_DB_PATH` when that environment variable is set.

### jobs

- `id`
- `command`
- `state`
- `attempts`
- `max_retries`
- `worker_id`
- `next_retry_at`
- `run_at`
- `priority`
- `timeout_ms`
- `created_at`
- `updated_at`
- `started_at`
- `heartbeat_at`
- `lease_expires_at`
- `completed_at`
- `last_error`
- `stdout`
- `stderr`
- `exit_code`
- `duration_ms`

### config

- `key`
- `value`
- `updated_at`

### workers

- `worker_id`
- `pid`
- `status`
- `heartbeat_at`
- `created_at`
- `started_at`
- `last_heartbeat`
- `stop_requested_at`
- `stopped_at`

## Worker Architecture

Workers run a polling loop:

1. Heartbeat in SQLite.
2. Recover expired `processing` job leases.
3. Atomically claim one eligible job.
4. Renew the claimed job's lease while it is running.
5. Execute the shell command with `child_process.exec()`.
6. Persist stdout, stderr, exit code, duration, and final state.
7. Sleep briefly when no job is available.

Eligible jobs have state `pending` or retryable `failed`, and both `run_at` and `next_retry_at` are due.

Workers register themselves in SQLite with `worker_id`, `pid`, `started_at`, `last_heartbeat`, and `status`. `queuectl status` uses this registry to show active workers and automatically marks stale worker rows as stopped.

## Crash Recovery

Jobs must not remain in `processing` forever. QueueCTL uses a lease-based recovery model:

1. When a worker claims a job, `JobRepository.claimNext()` sets `heartbeat_at` and `lease_expires_at`.
2. While the command runs, `Worker.startJobHeartbeat()` periodically renews the lease through `JobRepository.renewLease()`.
3. If the worker is killed with `SIGKILL`, no cleanup handler runs and the lease stops being renewed.
4. Other workers call `Worker.recoverExpiredJobs()` during their polling loop.
5. `JobRepository.recoverExpiredProcessingJobs()` moves expired `processing` jobs back to `pending`, clears ownership fields, and records `last_error`.
6. A worker can then claim the job again using the normal atomic claim path.

Default recovery-related config:

```text
job_lease_ms=30000
job_heartbeat_interval_ms=10000
recovery_interval_ms=10000
```

With these defaults, worst-case recovery is under 60 seconds: a crashed job becomes recoverable after a 30 second lease, and workers scan for expired leases every 10 seconds.

## Locking Strategy

Duplicate processing is prevented by a SQLite transaction:

1. Select one eligible candidate ordered by priority and schedule time.
2. Run `UPDATE jobs SET state='processing', worker_id=? ... WHERE id=? AND state IN ('pending','failed')`.
3. Proceed only when exactly one row was changed.

SQLite WAL mode and `busy_timeout` are enabled so multiple worker processes can coordinate safely through the database.

Final state writes are also ownership-aware. The worker includes its `worker_id` when marking a job completed, failed, or dead, so a stale worker cannot overwrite a job after its lease has already been recovered by another worker.

## Retry Logic

Failed jobs increment `attempts` and are retried with exponential backoff:

```text
delay = backoff_base ^ attempts
```

With `backoff_base=2`:

- attempt 1: 2 seconds
- attempt 2: 4 seconds
- attempt 3: 8 seconds

`next_retry_at` stores the next eligible time.

## Dead Letter Queue

When attempts exceed `max_retries`, the job moves to `dead`.

```bash
queuectl dlq list
queuectl dlq retry job1
```

Retrying a DLQ job resets `attempts` to `0`, clears the error, and moves it back to `pending`.

## Configuration

Defaults are inserted into SQLite on first run:

```text
max_retries=3
backoff_base=2
poll_interval_ms=500
job_timeout_ms=30000
job_lease_ms=30000
job_heartbeat_interval_ms=10000
recovery_interval_ms=10000
```

Update values with:

```bash
queuectl config set max-retries 5
queuectl config get
```

## Status and Metrics

`queuectl status` displays counts for:

- pending
- processing
- completed
- failed
- dead
- running workers

When workers are active, `queuectl status` also prints the active worker registry, including worker id, PID, started time, last heartbeat, and status.

Per-job metrics include stdout, stderr, exit code, execution duration, timestamps, and last error.

## Testing

```bash
npm test
```

Tests cover enqueueing, successful execution, retries, exponential backoff, DLQ, persistence, duplicate prevention, multiple workers, graceful shutdown, strict JSON output, worker registry behavior, SIGKILL crash recovery, and 100-job concurrent execution across 3 worker processes.

## Demo

```bash
npm run demo
```

The demo uses a temporary database, enqueues successful and failing jobs, starts a worker, shows status, lists the DLQ, and retries a dead job.

Manual demo flow for live review preparation:

```bash
export QUEUECTL_DB_PATH=/tmp/queuectl-demo.db
queuectl enqueue '{"id":"demo-ok","command":"echo ok"}'
queuectl enqueue '{"id":"demo-fail","command":"exit 1","max_retries":1}'
queuectl worker start --count 2
```

In another terminal:

```bash
export QUEUECTL_DB_PATH=/tmp/queuectl-demo.db
queuectl status
queuectl list --state completed --json
queuectl worker stop
queuectl dlq list
queuectl dlq retry demo-fail
```

For crash recovery review, start a long-running job, kill the worker process with `SIGKILL`, then start `queuectl worker start` again and watch the job return from `processing` to `pending` after lease expiration.

## Live Review Checklist

- Be ready to run `npm test`.
- Be ready to demonstrate `queuectl list --state pending --json` printing only JSON.
- Be ready to explain `JobRepository.claimNext()` and why the guarded SQLite update is atomic across processes.
- Be ready to explain lease expiration and `JobRepository.recoverExpiredProcessingJobs()`.
- Be ready to explain why `dlq retry` resets attempts.
- Be ready to start workers in one terminal and stop them from another using `queuectl worker stop`.

## Error Handling

The CLI and services handle:

- invalid JSON
- invalid job commands
- duplicate job IDs
- invalid states
- invalid config keys
- invalid worker counts
- SQLite constraint failures
- command failures and timeouts

## Assumptions

- `worker start` runs workers in the foreground.
- `worker stop` is cooperative and stored in SQLite, so running workers can stop gracefully across processes.
- Shell command safety is the operator's responsibility. Commands execute with the current user's permissions.
- SQLite is appropriate for local and small-to-medium workloads where operational simplicity matters.
- QueueCTL provides at-least-once execution after crashes. A command with external side effects should be idempotent because a worker can be killed after the shell command does work but before QueueCTL records completion.

## Tradeoffs

- SQLite provides durable local coordination without external infrastructure, but it is not intended to replace a distributed queue broker for very high write throughput.
- `child_process.exec()` is convenient and captures output, but has shell semantics. A future version could offer an `execFile` mode for stricter command execution.
- Worker heartbeats support visibility into running workers and job leases support crash recovery for long-running `processing` jobs.
- Lease-based crash recovery prevents jobs from being stuck in `processing`, but it intentionally favors availability over exactly-once external side effects.
- The worker registry reuses SQLite instead of PID files or a control socket. This keeps the deployment simple, but stop latency is bounded by the worker polling loop and the current job duration.

## Future Improvements

- Cron-like recurring jobs
- Named queues
- Per-queue concurrency limits
- Job cancellation
- Web dashboard
- Structured JSON output mode for all CLI commands
- Job event history table for auditing DLQ retries and crash recoveries
