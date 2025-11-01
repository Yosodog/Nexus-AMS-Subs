const path = require('path');
const fs = require('fs');

// Try loading from project root (working directory first)
let dotenvPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(dotenvPath)) {
  // fallback: go up 2 levels from config.js (src/config -> ../..)
  dotenvPath = path.resolve(__dirname, '../../.env');
}

require('dotenv').config({path: dotenvPath});

const trimTrailingSlash = (value) =>
  typeof value === 'string' ? value.replace(/\/+$/, '') : value;

const withDefault = (value, fallback) => value || fallback;

const config = {
  pwApiUrl: trimTrailingSlash(process.env.PW_API_URL),
  pwApiToken: process.env.PW_API_TOKEN,
  pusherSocketHost: process.env.PUSHER_SOCKET_HOST,
  pwAuthUrl: process.env.PW_AUTH_URL,
  nexusApiUrl: trimTrailingSlash(process.env.NEXUS_API_URL),
  nexusApiToken: process.env.NEXUS_API_TOKEN,
  pusherAppKey: withDefault(process.env.PUSHER_APP_KEY, 'a22734a47847a64386c8'),
  pusherCluster: withDefault(process.env.PUSHER_CLUSTER, 'abc'),
  pwSnapshotUrl: trimTrailingSlash(
      withDefault(
          process.env.PW_SNAPSHOT_URL,
          'https://api.politicsandwar.com/subscriptions/v1/snapshot',
      ),
  ),
  enableSnapshots: process.env.ENABLE_SNAPSHOTS !== 'false',
  snapshotIntervalMinutes: Number(process.env.SNAPSHOT_INTERVAL_MINUTES) || 60,
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
  'nexusApiUrl',
  'nexusApiToken',
];

const missingKeys = requiredKeys.filter((key) => !config[key]);

if (missingKeys.length > 0) {
  throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}`,
  );
}

module.exports = Object.freeze(config);
