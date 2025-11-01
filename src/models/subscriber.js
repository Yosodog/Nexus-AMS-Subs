const axios = require('axios');
const {
  subscribeToChannel,
  unsubscribeFromChannel,
} = require('../services/pusherService');
const {sendUpdate} = require('../services/apiService');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');

const MAX_SUBSCRIPTION_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function subscribe(model, event, attempt = 1) {
  try {
    // Make initial subscription request to get the channel name
    const response = await axios.get(
        `${config.pwApiUrl}/${model}/${event}?api_key=${config.pwApiToken}`,
        {timeout: 10000},
    );

    const channelName = response?.data?.channel;
    if (!channelName) {
      throw new Error('Channel name missing from subscription response');
    }

    console.log(
        `Received channel ${channelName} for ${model}:${event} (attempt ${attempt})`,
    );

    // Set up Pusher subscription to listen for updates
    const channel = subscribeToChannel(channelName);

    const eventName = `${model.toUpperCase()}_${event.toUpperCase()}`;

    const handleDelivery = (payload, source) => {
      sendUpdate(model, event, payload).catch((error) => {
        const formattedError = formatAxiosError(error);
        console.error(
            `Unhandled error while forwarding ${model}:${event} (${source}): ${formattedError}`,
        );
      });
    };

    channel.bind(eventName, (data) => handleDelivery(data, 'single'));

    channel.bind(`BULK_${eventName}`, (data) => handleDelivery(data, 'bulk'));

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
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
            `Retrying ${model}:${event} subscription in ${delay}ms (attempt ${attempt + 1}/${MAX_SUBSCRIPTION_ATTEMPTS})`,
        );

        setTimeout(() => {
          subscribe(model, event, attempt + 1).catch((retryError) => {
            const formattedError = formatAxiosError(retryError);
            console.error(
                `Retry subscription failed for ${model}:${event}: ${formattedError}`,
            );
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
    const formattedError = formatAxiosError(error);
    console.error(
        `Failed to subscribe to ${model}:${event}: ${formattedError}`,
    );

    if (attempt < MAX_SUBSCRIPTION_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
          `Retrying ${model}:${event} subscription in ${delay}ms (attempt ${attempt + 1}/${MAX_SUBSCRIPTION_ATTEMPTS})`,
      );

      await wait(delay);
      return subscribe(model, event, attempt + 1);
    }

    const message =
      `Exceeded maximum retries requesting channel for ${model}:${event}.`;
    console.error(message);
    throw new Error(message);
  }
}

module.exports = {subscribe};
