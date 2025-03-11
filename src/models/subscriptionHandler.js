const axios = require('axios');
const apiService = require('../services/apiService');
const config = require('../config/config');
const {subscribe} = require('./subscriber');

async function fetchSnapshot(model) {
  try {
    const response = await axios.get(
        `https://api.politicsandwar.com/subscriptions/v1/snapshot/${model}?api_key=${config.pwApiToken}`,
        {
          headers: {
            'Authorization': `Bearer ${config.pwApiToken}`,
            'Accept': 'application/json', // Change to 'text/csv' or 'application/msgpack' if needed
          },
        },
    );

    console.log(`Fetched snapshot for ${model}:`, response.data);

    // Send data to Nexus AMS
    apiService.sendUpdate(model, response.data);
  } catch (error) {
    console.error(`Failed to fetch snapshot for ${model}:`, error.message);
  }
}

function startSnapshotScheduler() {
  console.log('Fetching initial snapshot...');
  fetchSnapshot('nation'); // Run immediately when the app starts

  setInterval(() => {
    console.log('Fetching hourly snapshot...');
    fetchSnapshot('nation'); // Runs every hour after the initial run
  }, 60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
}

// Initialize subscriptions and start snapshot scheduler
function initializeSubscriptions() {
  subscribe('nation', 'create');
  subscribe('nation', 'update');
  subscribe('nation', 'delete');
  subscribe('alliance', 'update');
  subscribe('alliance', 'create');
  subscribe('alliance', 'delete');
  subscribe('city', 'update');
  subscribe('city', 'create');
  subscribe('city', 'delete');
  // startSnapshotScheduler();
}

module.exports = {initializeSubscriptions, startSnapshotScheduler};