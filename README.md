# Nexus AMS Subs

Nexus AMS Subs is a Node.js application that listens to GraphQL subscriptions from the Politics & War API and forwards relevant updates to the Nexus AMS backend. This enables real-time synchronization of in-game nation, alliance, and war data with Nexus AMS, ensuring that alliance management and banking systems remain up to date.

## ⚠️ WARNING ⚠️
This repository is not ready for production. Use this project at your own risk. This project is currently in the pre-alpha stage.

## Nexus AMS Repository
This repository is only for the subscription side. For the Nexus AMS main repository, please go [here](https://github.com/Yosodog/Nexus-AMS).

## Features
- Subscribes to real-time updates from the Politics & War API.
- Listens for nation updates and forwards them to Nexus AMS.
- Uses **Pusher** for handling GraphQL subscriptions.
- Communicates with Nexus AMS via HTTP requests.
- Implements automatic reconnection logic for subscriptions.

## How It Works
1. **GraphQL Subscriptions**: The application subscribes to Politics & War's GraphQL API to receive real-time updates on nations, alliances, and wars, etc.
2. **Pusher Service**: Uses Pusher to manage and maintain active subscriptions.
3. **API Forwarding**: When an update/creation/deletion is received, the application sends an HTTP request to Nexus AMS with the updated data.
4. **Error Handling & Reconnection**: Automatically attempts to reconnect if a subscription is lost.
5. **Resilient Delivery**: Retries outbound deliveries and snapshot fetches with exponential backoff and actionable logging.

## Installation
### Prerequisites
- Node.js (>= 20.x)
- npm

### Clone the Repository
```bash
git clone https://github.com/Yosodog/Nexus-AMS-Subs.git
cd Nexus-AMS-Subs
```

### Install Dependencies
```bash
npm install
```

### Configuration
Create a `.env` file in the root directory and configure the following environment variables:

```
# Nexus AMS API
PW_API_URL=https://api.politicsandwar.com/subscriptions/v1/subscribe
PW_API_TOKEN=your_api_token
PUSHER_SOCKET_HOST=socket.politicsandwar.com
PW_AUTH_URL=https://api.politicsandwar.com/subscriptions/v1/auth
PUSHER_APP_KEY=a22734a47847a64386c8
PUSHER_CLUSTER=abc
NEXUS_API_URL=https://nexus_ams_url.com/api/v1/subs
NEXUS_API_TOKEN=your_nexus_api_token
DELIVERY_DRIVER=http
SUBS_REDIS_URL=redis://127.0.0.1:6379/3
SUBS_REDIS_STREAM=nexus:subscriptions:v1
SUBS_REDIS_HMAC_SECRET=replace_with_at_least_32_random_characters
PW_SNAPSHOT_URL=https://api.politicsandwar.com/subscriptions/v1/snapshot
ENABLE_SNAPSHOTS=false
SNAPSHOT_INTERVAL_MINUTES=60
SNAPSHOT_MODELS=nation
LOG_LEVEL=info
DELIVERY_QUEUE_CONCURRENCY=3
DELIVERY_QUEUE_MAX_SIZE=1000
ENABLE_DEAD_LETTERS=true
DEAD_LETTER_FILE=data/dead-letter-events.jsonl
PROCESS_HEALTH_FILE=data/process-health.json
PROCESS_HEALTH_INTERVAL_MS=15000
PROCESS_HEALTH_STALE_AFTER_MS=45000
SHUTDOWN_TIMEOUT_MS=60000
BUILD_COMMIT=unknown
NEXUS_RELEASE_ID=unknown
```

You can see an example with .env.example

### Running the Application
```bash
npm start
```

The application will initialize subscriptions and begin forwarding updates to Nexus AMS.

### Optional Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PUSHER_APP_KEY` | `a22734a47847a64386c8` | Override the default Pusher application key if Politics & War rotates credentials. |
| `PUSHER_CLUSTER` | `abc` | Set the cluster provided by the Politics & War API. |
| `PW_SNAPSHOT_URL` | `https://api.politicsandwar.com/subscriptions/v1/snapshot` | Alternate base URL for snapshot requests. |
| `ENABLE_SNAPSHOTS` | `false` | Snapshot retrieval is currently disabled. Leave this set to `false`. |
| `SNAPSHOT_INTERVAL_MINUTES` | `60` | Minutes between snapshot refreshes. |
| `SNAPSHOT_MODELS` | `nation` | Comma-separated list of models to snapshot regularly. |
| `LOG_LEVEL` | `info` | Minimum log level to write: `debug`, `info`, `warn`, or `error`. |
| `DELIVERY_QUEUE_CONCURRENCY` | `3` | Maximum concurrent deliveries sent to Nexus AMS. |
| `DELIVERY_QUEUE_MAX_SIZE` | `1000` | Maximum queued deliveries waiting behind active sends before new events are dead-lettered. |
| `ENABLE_DEAD_LETTERS` | `true` | Store failed or overflowed deliveries in a JSONL file for later inspection/replay. |
| `DEAD_LETTER_FILE` | `data/dead-letter-events.jsonl` | File path used for dead-lettered delivery payloads. |
| `PROCESS_HEALTH_FILE` | `data/process-health.json` | Atomic local readiness/heartbeat file written with mode `0600`. |
| `PROCESS_HEALTH_INTERVAL_MS` | `15000` | Interval between process heartbeats. |
| `PROCESS_HEALTH_STALE_AFTER_MS` | `45000` | Maximum heartbeat age accepted by `npm run healthcheck`. |
| `SHUTDOWN_TIMEOUT_MS` | `60000` | Maximum time allowed for the in-memory delivery queue to drain after SIGTERM/SIGINT. |
| `BUILD_COMMIT` | `unknown` | Immutable source commit or image revision exposed in local build metadata. |
| `NEXUS_RELEASE_ID` | `unknown` | Server-assigned release identifier exposed in local build metadata. |
| `DELIVERY_DRIVER` | `http` | Active Nexus delivery transport: `http` or `redis-stream`. Exactly one driver is active. |
| `SUBS_REDIS_URL` | none | Redis connection URL required by `redis-stream`; use `rediss://` for TLS endpoints. |
| `SUBS_REDIS_STREAM` | `nexus:subscriptions:v1` | Redis stream receiving versioned PW deliveries. |
| `SUBS_REDIS_HMAC_SECRET` | none | Shared secret of at least 32 characters required by `redis-stream`; it must exactly match Nexus AMS. |

### Redis Streams Delivery

Set `DELIVERY_DRIVER=redis-stream` to publish each Politics & War single or bulk
delivery as one Redis Stream entry. Nexus AMS must run `php artisan
subs:consume-stream` against the same Redis URL and stream. Redis is transport
only: Nexus acknowledges and removes entries after accepting the work.

Keep `NEXUS_API_URL` and `NEXUS_API_TOKEN` configured as operational backup
settings. There is no automatic fallback or dual publishing. To return to HTTP,
stop this service, set `DELIVERY_DRIVER=http`, and restart it after the Redis
stream has drained or its pending entries have been accounted for.

Each Redis Stream entry is signed with HMAC-SHA256 over the documented
versioned envelope fields. Configure the same `SUBS_REDIS_HMAC_SECRET` in this
service and Nexus AMS before selecting `redis-stream`; either process refuses
to start the transport when the secret is missing or shorter than 32
characters.

For separate servers, use a private network or a TLS `rediss://` endpoint with
restricted Redis credentials. Never expose an unauthenticated Redis port to the
public internet.

### Process readiness and shutdown

The service writes an atomic JSON heartbeat to `PROCESS_HEALTH_FILE`. It contains
only the service state, package/build identifiers, active delivery driver, and
bounded queue counters; URLs, API credentials, Redis credentials, event
payloads, and dead letters are excluded. The file is process-local operational
state and may be placed on a writable runtime mount.

Use the same working directory or `PROCESS_HEALTH_FILE` value when probing it:

```bash
npm run healthcheck
```

The command exits nonzero when the file is missing, malformed, stale, from an
unsupported contract, or reports any state other than `ready`. A SIGTERM or
SIGINT first disconnects Pusher, then drains accepted deliveries, closes the
active transport, records the final state, and exits. Configure the process
manager's stop grace period above `SHUTDOWN_TIMEOUT_MS`; with the default,
allow at least 70 seconds. A drain timeout or transport-close failure exits
nonzero so supervision does not report a clean shutdown after possible loss.


## Contributing
1. Fork the repository.
2. Create a new branch: `git checkout -b feature-branch-name`.
3. Make your changes and commit them: `git commit -m 'Description of changes'`.
4. Push to the branch: `git push origin feature-branch-name`.
5. Open a pull request.

## Bug Reports & Issues
If you encounter any bugs or have feature requests, please create an issue on [GitHub Issues](https://github.com/Yosodog/Nexus-AMS-Subs/issues).

Issues created here should ONLY be for the subscription project. Please use the Nexus AMS repo for issues relating to the actual application.

## License
This project is open-source and available under the GPL-3.0 License.

## Support
If you need assistance or you have questions about this project, please contact Yosodog on Discord. You can join BK's server [here](https://discord.com/invite/VrJFQMBH2R). You can also create an issue here on Github for questions relating to the project.
