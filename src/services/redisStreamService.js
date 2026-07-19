const {createClient} = require('redis');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

const MAX_REDIS_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

let client;
let connectPromise;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getClient() {
  if (client) {
    return client;
  }

  client = createClient({url: config.subsRedisUrl})
      .on('error', (error) => {
        logger.error('Redis stream client error', {
          error: formatAxiosError(error),
        });
      })
      .on('reconnecting', () => {
        logger.warn('Redis stream client reconnecting');
      })
      .on('ready', () => {
        logger.info('Redis stream client ready', {
          stream: config.subsRedisStream,
        });
      });

  return client;
}

async function ensureConnected() {
  const redisClient = getClient();

  if (redisClient.isOpen) {
    return redisClient;
  }

  if (!connectPromise) {
    connectPromise = redisClient.connect()
        .finally(() => {
          connectPromise = undefined;
        });
  }

  await connectPromise;
  return redisClient;
}

function representativeIds(data) {
  const records = Array.isArray(data) ? data : [data];

  return records
      .filter((record) => record && typeof record === 'object' && record.id)
      .slice(0, 5)
      .map((record) => record.id);
}

async function publishUpdate(model, event, data, metadata = {}, attempt = 1) {
  try {
    const redisClient = await ensureConnected();
    const streamId = await redisClient.xAdd(config.subsRedisStream, '*', {
      message_id: metadata.messageId,
      schema_version: '1',
      model,
      event,
      source: metadata.source || 'single',
      received_at: metadata.receivedAt,
      payload: JSON.stringify(data),
    });

    logger.info('Published update to Redis stream', {
      stream: config.subsRedisStream,
      streamId,
      messageId: metadata.messageId,
      model,
      event,
      source: metadata.source,
      payloadSize: Array.isArray(data)
        ? `${data.length} records`
        : `${Object.keys(data || {}).length} fields`,
      representativeIds: representativeIds(data),
    });

    return streamId;
  } catch (error) {
    logger.error('Failed to publish update to Redis stream', {
      stream: config.subsRedisStream,
      messageId: metadata.messageId,
      model,
      event,
      attempt,
      error: formatAxiosError(error),
    });

    if (attempt < MAX_REDIS_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await wait(delay);
      return publishUpdate(model, event, data, metadata, attempt + 1);
    }

    const terminalError = new Error(
        `Failed to publish ${model}:${event} after ${MAX_REDIS_ATTEMPTS} attempts`,
    );
    terminalError.cause = error;
    throw terminalError;
  }
}

async function shutdownRedisStream() {
  if (!client?.isOpen) {
    return;
  }

  await client.close();
  client = undefined;
  connectPromise = undefined;
}

module.exports = {
  publishUpdate,
  shutdownRedisStream,
};
