const {createClient} = require('redis');
const config = require('../config/config');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');
const {createSignedEnvelope} = require('./subscriptionEnvelope');

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

async function publishEnvelope(fields, metadata, attempt = 1) {
  try {
    const redisClient = await ensureConnected();
    const streamId = await redisClient.xAdd(
        config.subsRedisStream,
        '*',
        fields,
    );

    logger.info('Published update to Redis stream', {
      stream: config.subsRedisStream,
      streamId,
      messageId: fields.message_id,
      model: fields.model,
      action: fields.action,
      key: fields.key,
      occurredAt: fields.occurred_at,
      payloadSize: metadata.payloadSize,
      representativeIds: metadata.representativeIds,
    });

    return streamId;
  } catch (error) {
    logger.error('Failed to publish update to Redis stream', {
      stream: config.subsRedisStream,
      messageId: fields.message_id,
      model: fields.model,
      action: fields.action,
      attempt,
      error: formatAxiosError(error),
    });

    if (attempt < MAX_REDIS_ATTEMPTS) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await wait(delay);
      return publishEnvelope(fields, metadata, attempt + 1);
    }

    const terminalError = new Error(
        `Failed to publish ${fields.model}:${fields.action} after ${MAX_REDIS_ATTEMPTS} attempts`,
    );
    terminalError.cause = error;
    throw terminalError;
  }
}

function envelopeKey(metadata = {}) {
  if (typeof metadata.key === 'string' && metadata.key.length > 0) {
    return metadata.key;
  }

  if (typeof metadata.source === 'string' && metadata.source.length > 0) {
    return metadata.source;
  }

  return 'single';
}

function occurredAt(metadata = {}) {
  return metadata.occurredAt || metadata.receivedAt ||
    new Date().toISOString();
}

async function publishUpdate(model, action, data, metadata = {}) {
  const payload = JSON.stringify(data);
  const fields = createSignedEnvelope({
    message_id: metadata.messageId,
    schema_version: '1',
    model,
    action,
    occurred_at: occurredAt(metadata),
    key: envelopeKey(metadata),
    payload,
  }, config.subsRedisHmacSecret);

  return publishEnvelope(fields, {
    payloadSize: Array.isArray(data)
      ? `${data.length} records`
      : `${Object.keys(data || {}).length} fields`,
    representativeIds: representativeIds(data),
  });
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
