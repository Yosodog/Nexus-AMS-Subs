const path = require('path');
const fs = require('fs');

// Try loading from project root (working directory first)
let dotenvPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(dotenvPath)) {
  // fallback: go up 2 levels from config.js (src/config -> ../..)
  dotenvPath = path.resolve(__dirname, '../../.env');
}

require('dotenv').config({path: dotenvPath, quiet: true});

const trimTrailingSlash = (value) =>
  typeof value === 'string' ? value.replace(/\/+$/, '') : value;

const withDefault = (value, fallback) => value || fallback;

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const safeIdentifier = (value, fallback = 'unknown') => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(normalized)
    ? normalized
    : fallback;
};

const deliveryDriver = withDefault(process.env.DELIVERY_DRIVER, 'http')
    .trim()
    .toLowerCase();

if (!['http', 'redis-stream'].includes(deliveryDriver)) {
  throw new Error(
      `Unsupported DELIVERY_DRIVER: ${deliveryDriver}. Expected http or redis-stream.`,
  );
}

const config = {
  pwApiUrl: trimTrailingSlash(process.env.PW_API_URL),
  pwApiToken: process.env.PW_API_TOKEN,
  pusherSocketHost: process.env.PUSHER_SOCKET_HOST,
  pwAuthUrl: process.env.PW_AUTH_URL,
  nexusApiUrl: trimTrailingSlash(process.env.NEXUS_API_URL),
  nexusApiToken: process.env.NEXUS_API_TOKEN,
  deliveryDriver,
  subsRedisUrl: process.env.SUBS_REDIS_URL,
  subsRedisStream: withDefault(
      process.env.SUBS_REDIS_STREAM,
      'nexus:subscriptions:v1',
  ),
  subsRedisHmacSecret: process.env.SUBS_REDIS_HMAC_SECRET,
  pusherAppKey: withDefault(process.env.PUSHER_APP_KEY, 'a22734a47847a64386c8'),
  pusherCluster: withDefault(process.env.PUSHER_CLUSTER, 'abc'),
  pwSnapshotUrl: trimTrailingSlash(
      withDefault(
          process.env.PW_SNAPSHOT_URL,
          'https://api.politicsandwar.com/subscriptions/v1/snapshot',
      ),
  ),
  // Snapshot ingestion is intentionally disabled until it is ready to run.
  enableSnapshots: false,
  snapshotIntervalMinutes: positiveInteger(
      process.env.SNAPSHOT_INTERVAL_MINUTES,
      60,
  ),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  deliveryQueueConcurrency: positiveInteger(
      process.env.DELIVERY_QUEUE_CONCURRENCY,
      3,
  ),
  deliveryQueueMaxSize: positiveInteger(
      process.env.DELIVERY_QUEUE_MAX_SIZE,
      1000,
  ),
  enableDeadLetters: process.env.ENABLE_DEAD_LETTERS !== 'false',
  deadLetterFile: withDefault(
      process.env.DEAD_LETTER_FILE,
      path.resolve(process.cwd(), 'data/dead-letter-events.jsonl'),
  ),
  processHealthFile: withDefault(
      process.env.PROCESS_HEALTH_FILE,
      path.resolve(process.cwd(), 'data/process-health.json'),
  ),
  processHealthIntervalMs: positiveInteger(
      process.env.PROCESS_HEALTH_INTERVAL_MS,
      15000,
  ),
  processHealthStaleAfterMs: positiveInteger(
      process.env.PROCESS_HEALTH_STALE_AFTER_MS,
      45000,
  ),
  shutdownTimeoutMs: positiveInteger(
      process.env.SHUTDOWN_TIMEOUT_MS,
      60000,
  ),
  buildCommit: safeIdentifier(process.env.BUILD_COMMIT),
  releaseId: safeIdentifier(process.env.NEXUS_RELEASE_ID),
  snapshotModels: (() => {
    const models = (process.env.SNAPSHOT_MODELS || 'nation')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return models.length > 0 ? models : ['nation'];
  })(),
};

const requiredKeys = [
  'pwApiUrl',
  'pwApiToken',
  'pusherSocketHost',
  'pwAuthUrl',
];

if (config.deliveryDriver === 'http') {
  requiredKeys.push('nexusApiUrl', 'nexusApiToken');
} else {
  requiredKeys.push(
      'subsRedisUrl',
      'subsRedisStream',
      'subsRedisHmacSecret',
  );
}

const missingKeys = requiredKeys.filter((key) => !config[key]);

if (missingKeys.length > 0) {
  throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
  );
}

if (
  config.deliveryDriver === 'redis-stream' &&
  Buffer.byteLength(config.subsRedisHmacSecret, 'utf8') < 32
) {
  throw new Error(
      'SUBS_REDIS_HMAC_SECRET must be configured with at least 32 characters.',
  );
}

module.exports = Object.freeze(config);
