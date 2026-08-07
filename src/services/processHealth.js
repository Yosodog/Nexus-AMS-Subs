const fs = require('fs/promises');
const path = require('path');
const {randomUUID} = require('crypto');
const packageMetadata = require('../../package.json');
const {
  HEALTH_SCHEMA_VERSION,
  SERVICE_NAME,
} = require('../processHealthContract');
const config = require('../config/config');
const {getDeliveryQueueStats} = require('./deliveryQueue');
const logger = require('../utils/logger');

async function writeHealthSnapshot(healthFile, snapshot) {
  const directory = path.dirname(healthFile);
  const temporaryFile = `${healthFile}.${process.pid}.${randomUUID()}.tmp`;

  await fs.mkdir(directory, {recursive: true});

  try {
    await fs.writeFile(
        temporaryFile,
        `${JSON.stringify(snapshot)}\n`,
        {encoding: 'utf8', mode: 0o600},
    );
    await fs.rename(temporaryFile, healthFile);
  } finally {
    await fs.rm(temporaryFile, {force: true});
  }
}

function createProcessHealth(options = {}) {
  const healthConfig = options.config || config;
  const now = options.now || (() => new Date());
  const writeSnapshot = options.writeSnapshot || writeHealthSnapshot;
  const queueStats = options.getDeliveryQueueStats || getDeliveryQueueStats;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const log = options.logger || logger;
  const startedAt = now().toISOString();
  let heartbeatTimer;
  let state = 'starting';
  let shutdown = null;
  let writeChain = Promise.resolve();

  const snapshot = () => ({
    schema_version: HEALTH_SCHEMA_VERSION,
    service: SERVICE_NAME,
    status: state,
    pid: process.pid,
    started_at: startedAt,
    heartbeat_at: now().toISOString(),
    stale_after_ms: healthConfig.processHealthStaleAfterMs,
    build: {
      version: packageMetadata.version,
      commit: healthConfig.buildCommit,
      release: healthConfig.releaseId,
    },
    delivery: {
      driver: healthConfig.deliveryDriver,
      queue: queueStats(),
    },
    ...(shutdown ? {shutdown} : {}),
  });

  const publish = () => {
    const nextSnapshot = snapshot();
    writeChain = writeChain
        .catch(() => undefined)
        .then(() => writeSnapshot(healthConfig.processHealthFile, nextSnapshot));

    return writeChain;
  };

  const start = async () => {
    await publish();
    heartbeatTimer = setIntervalFn(
        () => publish().catch(() => {
          log.error('Failed to write process health heartbeat', {
            code: 'HEALTH_WRITE_FAILED',
          });
        }),
        healthConfig.processHealthIntervalMs,
    );
    heartbeatTimer.unref?.();
  };

  const markReady = async () => {
    state = 'ready';
    await publish();
  };

  const markStopping = async (signal) => {
    state = 'stopping';
    shutdown = {signal};
    await publish();
  };

  const stop = async ({signal, drained, transportClosed}) => {
    if (heartbeatTimer) {
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    state = drained && transportClosed ? 'stopped' : 'degraded';
    shutdown = {signal, drained, transport_closed: transportClosed};
    await publish();
  };

  const failStartup = async () => {
    if (heartbeatTimer) {
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = undefined;
    }

    state = 'failed';
    await publish();
  };

  return {
    start,
    markReady,
    markStopping,
    stop,
    failStartup,
  };
}

module.exports = {
  HEALTH_SCHEMA_VERSION,
  SERVICE_NAME,
  createProcessHealth,
  writeHealthSnapshot,
};
