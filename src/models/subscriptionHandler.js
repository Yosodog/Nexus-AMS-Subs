const axios = require('axios');
const {sendUpdate} = require('../services/apiService');
const config = require('../config/config');
const {subscribe} = require('./subscriber');
const {formatAxiosError} = require('../utils/error');

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
    console.log(`Fetched snapshot for ${model} (${sizeDescription}).`);

    // Send data to Nexus AMS
    await sendUpdate(model, 'snapshot', payload);
  } catch (error) {
    const formattedError = formatAxiosError(error);
    console.error(`Failed to fetch snapshot for ${model}: ${formattedError}`);
  }
}

function startSnapshotScheduler() {
  if (!config.enableSnapshots) {
    console.log('Snapshots disabled via configuration.');
    return;
  }

  const intervalMs = Math.max(config.snapshotIntervalMinutes, 1) * 60 * 1000;

  console.log('Fetching initial snapshots...');
  SNAPSHOT_MODELS.forEach((model) => {
    fetchSnapshot(model).catch((error) => {
      const formattedError = formatAxiosError(error);
      console.error(`Initial snapshot failed for ${model}: ${formattedError}`);
    });
  });

  setInterval(() => {
    console.log('Fetching scheduled snapshots...');
    SNAPSHOT_MODELS.forEach((model) => {
      fetchSnapshot(model).catch((error) => {
        const formattedError = formatAxiosError(error);
        console.error(`Scheduled snapshot failed for ${model}: ${formattedError}`);
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
        console.error(
            `Unexpected error bootstrapping subscription for ${model}:${event}: ${formattedError}`,
        );
      });
    });
  });

  startSnapshotScheduler();
}

module.exports = {initializeSubscriptions, startSnapshotScheduler};
