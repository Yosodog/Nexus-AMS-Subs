const axios = require('axios');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

const MAX_API_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

function responseStatus(error) {
  const status = Number(error?.response?.status);
  return Number.isInteger(status) ? status : undefined;
}

function isTerminalHttp4xx(error) {
  const status = responseStatus(error);
  return status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429;
}

function createTerminalHttpError(model, event, error) {
  const status = responseStatus(error);
  return Object.assign(
      new Error(
          `Delivery rejected by Nexus AMS with HTTP ${status} for ${model}:${event}`,
      ),
      {
        code: 'DELIVERY_TERMINAL_4XX',
        classification: 'terminal_4xx',
        retryable: false,
        status,
        cause: error,
      },
  );
}

const httpClient = axios.create({
  baseURL: config.nexusApiUrl,
  timeout: 10000,
  headers: {
    Authorization: `Bearer ${config.nexusApiToken}`,
    'Content-Type': 'application/json',
  },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendUpdate(model, event, data, metadata = {}, attempt = 1) {
  const endpoint = `/${model}/${event}`;

  try {
    await httpClient.post(endpoint, data);
    const payloadSize = Array.isArray(data)
      ? `${data.length} records`
      : `${Object.keys(data || {}).length} fields`;
    logger.info('Delivered update to Nexus AMS', {
      model,
      event,
      messageId: metadata.messageId,
      payloadSize,
    });
  } catch (error) {
    const formattedError = formatAxiosError(error);
    logger.error('Failed to send update to Nexus AMS', {
      model,
      event,
      messageId: metadata.messageId,
      attempt,
      classification: isTerminalHttp4xx(error) ? 'terminal_4xx' : 'retryable',
      error: formattedError,
    });

    if (isTerminalHttp4xx(error)) {
      throw createTerminalHttpError(model, event, error);
    }

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
      return sendUpdate(model, event, data, metadata, attempt + 1);
    }

    logger.error('Abandoning delivery after max attempts', {
      model,
      event,
      messageId: metadata.messageId,
      maxAttempts: MAX_API_ATTEMPTS,
    });

    const terminalError = Object.assign(
        new Error(
            `Failed to deliver ${model}:${event} after ${MAX_API_ATTEMPTS} attempts`,
        ),
        {
          code: 'DELIVERY_RETRY_EXHAUSTED',
          classification: 'retry_exhausted',
          retryable: false,
          cause: error,
        },
    );
    throw terminalError;
  }
}

module.exports = {sendUpdate};
