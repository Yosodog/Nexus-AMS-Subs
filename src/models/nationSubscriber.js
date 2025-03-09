const axios = require('axios');
const {initializePusher} = require('../services/pusherService');
const apiService = require('../services/apiService');
const config = require('../config/config');

async function subscribeToNationUpdates() {
  try {
    // Make initial subscription request to get the channel name
    const response = await axios.get(
        `${config.pwApiUrl}/nation/update?api_key=${config.pwApiToken}`,
    );

    const channelName = response.data.channel;
    console.log(`Subscribed to channel: ${channelName}`);

    // Set up Pusher subscription to listen for updates
    const channel = initializePusher(channelName);

    channel.bind('NATION_UPDATE', (data) => {
      console.log('Received NATION_UPDATE:', data);
      apiService.sendUpdate('nation', data);
    });

    channel.bind('BULK_NATION_UPDATE', (data) => {
      console.log('Received BULK_NATION_UPDATE:', data);
      apiService.sendUpdate('nation', data);
    });
  } catch (error) {
    console.error('Failed to subscribe to nation updates:', error);
  }
}

module.exports = {subscribeToNationUpdates};
