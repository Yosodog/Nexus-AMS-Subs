const axios = require('axios');
const {initializePusher} = require('../services/pusherService');
const apiService = require('../services/apiService');
const config = require('../config/config');

async function subscribe(model, event) {
  try {
    // Make initial subscription request to get the channel name
    const response = await axios.get(
        `${config.pwApiUrl}/${model}/${event}?api_key=${config.pwApiToken}`,
    );

    const channelName = response.data.channel;
    console.log(`Subscribed to channel: ${channelName}`);

    // Set up Pusher subscription to listen for updates
    const channel = initializePusher(channelName);

    let eventName = `${model.toUpperCase()}_${event.toUpperCase()}`;

    channel.bind(eventName, (data) => {
      console.log(`Received ${eventName}`, data);
      apiService.sendUpdate(model, event, data);
    });

    channel.bind(`BULK_${eventName}`, (data) => {
      console.log(`Received BULK_${eventName}`, data);
      apiService.sendUpdate(model, event, data);
    });
  } catch (error) {
    console.error('Failed to subscribe to nation updates:', error);
  }
}

module.exports = {subscribe};
