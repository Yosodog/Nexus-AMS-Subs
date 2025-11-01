const axios = require('axios');
const {
  subscribeToChannel,
  unsubscribeFromChannel,
} = require('../services/pusherService');
const apiService = require('../services/apiService');
const config = require('../config/config');

const MAX_SUBSCRIPTION_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function subscribe(model, event, attempt = 1) {
  try {
    // Make initial subscription request to get the channel name
    const response = await axios.get(
        `${config.pwApiUrl}/${model}/${event}?api_key=${config.pwApiToken}`,
    );

    const channelName = response.data.channel;
    console.log(
        `Received channel ${channelName} for ${model}:${event} (attempt ${attempt})`,
    );

    // Set up Pusher subscription to listen for updates
    const channel = subscribeToChannel(channelName);

    let eventName = `${model.toUpperCase()}_${event.toUpperCase()}`;

    channel.bind(eventName, (data) => {
      apiService.sendUpdate(model, event, data);
    });

    channel.bind(`BULK_${eventName}`, (data) => {
      apiService.sendUpdate(model, event, data);
    });

    const handleSubscriptionSuccess = () => {
      console.log(`Successfully subscribed to channel: ${channelName}`);
    };

    const handleSubscriptionError = (status) => {
      console.error(
          `Failed to subscribe to channel: ${channelName}, status: ${status}`);

      channel.unbind('pusher:subscription_succeeded', handleSubscriptionSuccess);
      channel.unbind('pusher:subscription_error', handleSubscriptionError);
      channel.unbind(eventName);
      channel.unbind(`BULK_${eventName}`);
      unsubscribeFromChannel(channelName);

      if (attempt < MAX_SUBSCRIPTION_ATTEMPTS) {
        const delay = RETRY_DELAY_MS * attempt;
        console.warn(
            `Retrying ${model}:${event} subscription in ${delay}ms (attempt ${attempt + 1}/${MAX_SUBSCRIPTION_ATTEMPTS})`,
        );

        setTimeout(() => {
          subscribe(model, event, attempt + 1).catch((error) => {
            console.error(
                `Retry subscription failed for ${model}:${event}:`, error);
          });
        }, delay);
      } else {
        console.error(
            `Exceeded maximum retries for ${model}:${event} on channel ${channelName}.`,
        );
      }
    };

    channel.bind('pusher:subscription_succeeded', handleSubscriptionSuccess);
    channel.bind('pusher:subscription_error', handleSubscriptionError);
  } catch (error) {
    console.error(`Failed to subscribe to ${model}:${event}:`, error.message);

    if (attempt < MAX_SUBSCRIPTION_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * attempt;
      console.warn(
          `Retrying ${model}:${event} subscription in ${delay}ms (attempt ${attempt + 1}/${MAX_SUBSCRIPTION_ATTEMPTS})`,
      );

      await wait(delay);
      return subscribe(model, event, attempt + 1);
    } else {
      console.error(
          `Exceeded maximum retries requesting channel for ${model}:${event}.`,
      );
    }
  }
}

module.exports = {subscribe};
