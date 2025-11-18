const axios = require('axios');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

const MAX_API_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

const httpClient = axios.create({
  baseURL: config.nexusApiUrl,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.nexusApiToken}`,
    'Content-Type': 'application/json',
  },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendUpdate(model, event, data, attempt = 1) {
  const endpoint = `/${model}/${event}`;

  try {
    await httpClient.post(endpoint, data);
    const payloadSize = Array.isArray(data)
      ? `${data.length} records`
      : `${Object.keys(data || {}).length} fields`;
    logger.info('Delivered update to Nexus AMS', {
      model,
      event,
      payloadSize,
    });
  } catch (error) {
    const formattedError = formatAxiosError(error);
    logger.error('Failed to send update to Nexus AMS', {
      model,
      event,
      attempt,
      error: formattedError,
    });

    if (attempt < MAX_API_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('Retrying update delivery', {
        model,
        event,
        attempt: attempt + 1,
        delayMs: delay,
        maxAttempts: MAX_API_ATTEMPTS,
      });
      await wait(delay);
      return sendUpdate(model, event, data, attempt + 1);
    }

    logger.error('Abandoning delivery after max attempts', {
      model,
      event,
      maxAttempts: MAX_API_ATTEMPTS,
    });

    const terminalError = new Error(
        `Failed to deliver ${model}:${event} after ${MAX_API_ATTEMPTS} attempts`,
    );
    terminalError.cause = error;
    throw terminalError;
  }
}

module.exports = {sendUpdate};
