const axios = require('axios');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');

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
    console.log(`Successfully sent ${event} for ${model} (${payloadSize}).`);
  } catch (error) {
    const formattedError = formatAxiosError(error);
    console.error(
        `Failed to send ${event} for ${model} on attempt ${attempt}: ${formattedError}`,
    );

    if (attempt < MAX_API_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
          `Retrying ${model}:${event} delivery in ${delay}ms (attempt ${
            attempt + 1
          }/${MAX_API_ATTEMPTS}).`,
      );
      await wait(delay);
      return sendUpdate(model, event, data, attempt + 1);
    }

    console.error(
        `Abandoning delivery for ${model}:${event} after ${MAX_API_ATTEMPTS} attempts.`,
    );

    const terminalError = new Error(
        `Failed to deliver ${model}:${event} after ${MAX_API_ATTEMPTS} attempts`,
    );
    terminalError.cause = error;
    throw terminalError;
  }
}

module.exports = {sendUpdate};
