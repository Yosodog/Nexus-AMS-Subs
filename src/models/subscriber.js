const axios = require('axios');
const {
  subscribeToChannel,
  unsubscribeFromChannel,
} = require('../services/pusherService');
const {sendUpdate} = require('../services/apiService');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

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

    logger.info('Received subscription channel', {
      model,
      event,
      channel: channelName,
      attempt,
    });

    // Set up Pusher subscription to listen for updates
    const channel = subscribeToChannel(channelName);

    const eventName = `${model.toUpperCase()}_${event.toUpperCase()}`;

    const handleDelivery = (payload, source) => {
      sendUpdate(model, event, payload).catch((error) => {
        const formattedError = formatAxiosError(error);
        logger.error('Unhandled error while forwarding event', {
          model,
          event,
          source,
          error: formattedError,
        });
      });
    };

    channel.bind(eventName, (data) => handleDelivery(data, 'single'));

    channel.bind(`BULK_${eventName}`, (data) => handleDelivery(data, 'bulk'));

    const handleSubscriptionSuccess = () => {
      logger.info('Subscribed to channel', {channel: channelName, model, event});
    };

    const handleSubscriptionError = (status) => {
      logger.error('Subscription error', {
        channel: channelName,
        status,
        model,
        event,
      });

      channel.unbind('pusher:subscription_succeeded', handleSubscriptionSuccess);
      channel.unbind('pusher:subscription_error', handleSubscriptionError);
      channel.unbind(eventName);
      channel.unbind(`BULK_${eventName}`);
      unsubscribeFromChannel(channelName);

      if (attempt < MAX_SUBSCRIPTION_ATTEMPTS) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('Retrying subscription', {
          model,
          event,
          attempt: attempt + 1,
          channel: channelName,
          delayMs: delay,
          maxAttempts: MAX_SUBSCRIPTION_ATTEMPTS,
        });

        setTimeout(() => {
          subscribe(model, event, attempt + 1).catch((retryError) => {
            const formattedError = formatAxiosError(retryError);
            logger.error('Retry subscription failed', {
              model,
              event,
              attempt: attempt + 1,
              error: formattedError,
            });
          });
        }, delay);
      } else {
        logger.error('Exceeded maximum retries during channel subscription', {
          model,
          event,
          channel: channelName,
          maxAttempts: MAX_SUBSCRIPTION_ATTEMPTS,
        });
      }
    };

    channel.bind('pusher:subscription_succeeded', handleSubscriptionSuccess);
    channel.bind('pusher:subscription_error', handleSubscriptionError);
  } catch (error) {
    const formattedError = formatAxiosError(error);
    logger.error('Failed to subscribe to model event', {
      model,
      event,
      attempt,
      error: formattedError,
    });

    if (attempt < MAX_SUBSCRIPTION_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('Retrying subscription', {
        model,
        event,
        attempt: attempt + 1,
        delayMs: delay,
        maxAttempts: MAX_SUBSCRIPTION_ATTEMPTS,
      });

      await wait(delay);
      return subscribe(model, event, attempt + 1);
    }

    const message =
      `Exceeded maximum retries requesting channel for ${model}:${event}.`;
    logger.error('Exceeded maximum retries requesting channel', {
      model,
      event,
      maxAttempts: MAX_SUBSCRIPTION_ATTEMPTS,
    });
    throw new Error(message);
  }
}

module.exports = {subscribe};
