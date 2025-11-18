const axios = require('axios');
const {sendUpdate} = require('../services/apiService');
const config = require('../config/config');
const {subscribe} = require('./subscriber');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

const SNAPSHOT_MODELS = config.snapshotModels;

async function fetchSnapshot(model) {
  try {
    const response = await axios.get(
        `${config.pwSnapshotUrl}/${model}?api_key=${config.pwApiToken}`,
        {
          headers: {
            Authorization: `Bearer ${config.pwApiToken}`,
            Accept: 'application/json',
          },
          timeout: 30000,
      },
    );

    const payload = response.data;
    const sizeDescription = Array.isArray(payload)
      ? `${payload.length} records`
      : `${Object.keys(payload || {}).length} fields`;
    logger.info('Fetched snapshot', {model, size: sizeDescription});

    // Send data to Nexus AMS
    await sendUpdate(model, 'snapshot', payload);
  } catch (error) {
    const formattedError = formatAxiosError(error);
    logger.error('Failed to fetch snapshot', {
      model,
      error: formattedError,
    });
  }
}

function startSnapshotScheduler() {
  if (!config.enableSnapshots) {
    logger.info('Snapshots disabled via configuration.');
    return;
  }

  const intervalMs = Math.max(config.snapshotIntervalMinutes, 1) * 60 * 1000;

  logger.info('Fetching initial snapshots...', {
    intervalMinutes: config.snapshotIntervalMinutes,
  });
  SNAPSHOT_MODELS.forEach((model) => {
    fetchSnapshot(model).catch((error) => {
      const formattedError = formatAxiosError(error);
      logger.error('Initial snapshot failed', {model, error: formattedError});
    });
  });

  setInterval(() => {
    logger.info('Fetching scheduled snapshots...');
    SNAPSHOT_MODELS.forEach((model) => {
      fetchSnapshot(model).catch((error) => {
        const formattedError = formatAxiosError(error);
        logger.error('Scheduled snapshot failed', {
          model,
          error: formattedError,
        });
      });
    });
  }, intervalMs);
}

// Initialize subscriptions and start snapshot scheduler
function initializeSubscriptions() {
  const subscriptionMatrix = {
    nation: ['create', 'update', 'delete'],
    alliance: ['create', 'update', 'delete'],
    city: ['create', 'update', 'delete'],
    war: ['create', 'update', 'delete'],
    warattack: ['create'],
    account: ['create', 'update', 'delete'],
  };

  Object.entries(subscriptionMatrix).forEach(([model, events]) => {
    events.forEach((event) => {
      subscribe(model, event).catch((error) => {
        const formattedError = formatAxiosError(error);
        logger.error('Unexpected error bootstrapping subscription', {
          model,
          event,
          error: formattedError,
        });
      });
    });
  });

  startSnapshotScheduler();
}

module.exports = {initializeSubscriptions, startSnapshotScheduler};
