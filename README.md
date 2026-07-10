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
Worker loop -> atomic claim -> child_process.exec -> complete / retry / DLQ
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
- `status`
- `heartbeat_at`
- `created_at`
- `stopped_at`

## Worker Architecture

Workers run a polling loop:

1. Heartbeat in SQLite.
2. Atomically claim one eligible job.
3. Execute the shell command with `child_process.exec()`.
4. Persist stdout, stderr, exit code, duration, and final state.
5. Sleep briefly when no job is available.

Eligible jobs have state `pending` or retryable `failed`, and both `run_at` and `next_retry_at` are due.

## Locking Strategy

Duplicate processing is prevented by a SQLite transaction:

1. Select one eligible candidate ordered by priority and schedule time.
2. Run `UPDATE jobs SET state='processing', worker_id=? ... WHERE id=? AND state IN ('pending','failed')`.
3. Proceed only when exactly one row was changed.

SQLite WAL mode and `busy_timeout` are enabled so multiple worker processes can coordinate safely through the database.

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

Per-job metrics include stdout, stderr, exit code, execution duration, timestamps, and last error.

## Testing

```bash
npm test
```

Tests cover enqueueing, successful execution, retries, exponential backoff, DLQ, persistence, duplicate prevention, multiple workers, and graceful shutdown.

## Demo

```bash
npm run demo
```

The demo uses a temporary database, enqueues successful and failing jobs, starts a worker, shows status, lists the DLQ, and retries a dead job.

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

## Tradeoffs

- SQLite provides durable local coordination without external infrastructure, but it is not intended to replace a distributed queue broker for very high write throughput.
- `child_process.exec()` is convenient and captures output, but has shell semantics. A future version could offer an `execFile` mode for stricter command execution.
- Worker heartbeats support visibility into running workers. Full crash recovery for long-running `processing` jobs can be extended with heartbeat-expiry rescue policies.

## Future Improvements

- Cron-like recurring jobs
- Named queues
- Per-queue concurrency limits
- Job cancellation
- Web dashboard
- Structured JSON output mode for all CLI commands
- Stale `processing` job recovery command
