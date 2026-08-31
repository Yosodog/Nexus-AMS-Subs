# Nexus AMS Subs

Nexus AMS Subs listens for Politics & War GraphQL subscription events and sends nation, alliance, and war updates to Nexus AMS. It can deliver events over HTTPS or a signed Redis Stream.

## Beta status

Nexus AMS Subs is part of the Nexus AMS beta. Run a Subs beta that is compatible with your Nexus AMS release. The delivery contract is versioned, but compatibility may still change before 1.0.

This repository contains only the subscription service. The main application is in the [Nexus AMS repository](https://github.com/Yosodog/Nexus-AMS).

## What it does

- Connects to the Politics & War subscription API through Pusher.
- Receives nation, alliance, and war events.
- Delivers events to Nexus AMS over HTTPS or Redis Streams.
- Retries failed HTTP deliveries with backoff.
- Places failed or overflowed events in a local dead-letter file when dead letters are enabled.
- Writes a local process heartbeat for readiness checks.
- Stops cleanly by draining accepted work before exit.

Snapshot retrieval is present but disabled in the beta. Keep `ENABLE_SNAPSHOTS=false` unless you are testing that path.

## Requirements

- Node.js 20 or newer
- npm
- A Politics & War API token with subscription access
- A compatible Nexus AMS beta deployment
- Redis 6.2 or newer when using Redis Streams

## Installation

Clone the compatible release, install dependencies, and create the environment file:

```bash
git clone https://github.com/Yosodog/Nexus-AMS-Subs.git
cd Nexus-AMS-Subs
npm ci
cp .env.example .env
```

For a production beta deployment, set `BUILD_COMMIT` to the exact Subs commit and set `NEXUS_RELEASE_ID` to the release identifier used by the matching Nexus installation. Production startup rejects missing or unknown provenance.

Start the service with:

```bash
npm start
```

## Configuration

The defaults and complete setting list are in [.env.example](.env.example). These settings normally require a deployment-specific value:

| Variable | Purpose |
| --- | --- |
| `PW_API_TOKEN` | Politics & War API token used to authorize subscriptions. |
| `NEXUS_API_URL` | Nexus subscription endpoint used by HTTP delivery. |
| `NEXUS_API_TOKEN` | Shared bearer token accepted by Nexus. |
| `NODE_ENV` | Set to `production` on a production host. |
| `DELIVERY_DRIVER` | Selects `http` or `redis-stream`. |
| `BUILD_COMMIT` | Exact source commit or image revision. |
| `NEXUS_RELEASE_ID` | Release identifier shared with the Nexus deployment. |

Common optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUSHER_APP_KEY` | `a22734a47847a64386c8` | Pusher application key supplied by Politics & War. |
| `PUSHER_CLUSTER` | `abc` | Pusher cluster supplied by Politics & War. |
| `PW_SNAPSHOT_URL` | Politics & War snapshot endpoint | Overrides the snapshot endpoint. |
| `ENABLE_SNAPSHOTS` | `false` | Enables the experimental snapshot path. Leave this off for the beta. |
| `SNAPSHOT_INTERVAL_MINUTES` | `60` | Minutes between snapshot requests. |
| `SNAPSHOT_MODELS` | `nation` | Comma-separated snapshot model list. |
| `LOG_LEVEL` | `info` | Minimum `debug`, `info`, `warn`, or `error` level to write. |
| `DELIVERY_QUEUE_CONCURRENCY` | `3` | Maximum number of active deliveries. |
| `DELIVERY_QUEUE_MAX_SIZE` | `1000` | Maximum number of deliveries waiting behind active work. |
| `ENABLE_DEAD_LETTERS` | `true` | Writes failed or overflowed deliveries to a JSONL file. |
| `DEAD_LETTER_FILE` | `data/dead-letter-events.jsonl` | Dead-letter file path. |
| `PROCESS_HEALTH_FILE` | `data/process-health.json` | Local process heartbeat path. |
| `PROCESS_HEALTH_INTERVAL_MS` | `15000` | Heartbeat interval. |
| `PROCESS_HEALTH_STALE_AFTER_MS` | `45000` | Maximum heartbeat age accepted by the health check. |
| `SHUTDOWN_TIMEOUT_MS` | `60000` | Maximum drain time after `SIGTERM` or `SIGINT`. |

## HTTP delivery

HTTP is the default delivery driver. Set:

```dotenv
DELIVERY_DRIVER=http
NEXUS_API_URL=https://nexus.example.com/api/v1/subs
NEXUS_API_TOKEN=replace-with-the-token-from-nexus
```

The service retries failed deliveries with backoff. Events that exhaust their attempts are written to the dead-letter file when dead letters are enabled.

## Redis Streams delivery

Redis Streams can keep subscription traffic off the public HTTP endpoint. Configure the same Redis endpoint, stream name, and HMAC secret in Subs and Nexus:

```dotenv
DELIVERY_DRIVER=redis-stream
SUBS_REDIS_URL=redis://127.0.0.1:6379/3
SUBS_REDIS_STREAM=nexus:subscriptions:v1
SUBS_REDIS_HMAC_SECRET=replace-with-at-least-32-random-characters
```

Nexus must run `php artisan subs:consume-stream` against the same Redis instance. The HMAC secret must contain at least 32 characters. Each stream entry signs the versioned `message_id`, `schema_version`, `model`, `event`, `source`, `received_at`, and `payload` fields.

Keep `NEXUS_API_URL` and `NEXUS_API_TOKEN` configured as manual fallback settings. The service does not publish to HTTP and Redis at the same time, and it does not switch drivers automatically. To return to HTTP, stop Subs, account for pending stream entries, change `DELIVERY_DRIVER`, and restart the process.

Use a private network or a TLS `rediss://` endpoint when Redis is on another server. Do not expose an unauthenticated Redis port to the internet.

## Readiness and shutdown

The service writes an atomic heartbeat to `PROCESS_HEALTH_FILE` with mode `0600`. The file contains process state, build identifiers, the active delivery driver, and bounded queue counters. It does not include URLs, credentials, event payloads, or dead-letter contents.

Probe the running process from the same working directory and user:

```bash
npm run healthcheck
```

The command exits with an error when the heartbeat is missing, malformed, stale, reports degraded delivery, or contains invalid production provenance. Three consecutive delivery failures set the process state to `degraded`; a successful delivery clears that condition.

On `SIGTERM` or `SIGINT`, the process disconnects from Pusher, drains accepted deliveries, closes the active transport, records its final state, and exits. Set the process manager's stop grace period above `SHUTDOWN_TIMEOUT_MS`. The default needs at least 70 seconds.

## Development

Run the test suite with:

```bash
npm test
```

Tests use local fixtures and fakes. They do not require a live Politics & War or Nexus deployment.

## Issues and support

Use [Nexus AMS Subs issues](https://github.com/Yosodog/Nexus-AMS-Subs/issues) for subscription connection, delivery, dead-letter, and process health problems. Use the [main Nexus AMS issue tracker](https://github.com/Yosodog/Nexus-AMS/issues) for application behavior.

Include the Subs commit, Nexus release ID, active delivery driver, and redacted logs in bug reports. Do not post API tokens, Redis credentials, HMAC secrets, or event payloads that contain private data.

## License

Nexus AMS Subs is licensed under GPL-3.0. See [LICENSE](LICENSE) for the full license text.
