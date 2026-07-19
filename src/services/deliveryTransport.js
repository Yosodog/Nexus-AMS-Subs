const config = require('../config/config');
const {sendUpdate} = require('./apiService');
const {
  publishUpdate,
  shutdownRedisStream,
} = require('./redisStreamService');

async function deliverUpdate(model, event, data, metadata = {}) {
  if (config.deliveryDriver === 'redis-stream') {
    return publishUpdate(model, event, data, metadata);
  }

  return sendUpdate(model, event, data, metadata);
}

async function shutdownDeliveryTransport() {
  if (config.deliveryDriver === 'redis-stream') {
    await shutdownRedisStream();
  }
}

module.exports = {
  deliverUpdate,
  shutdownDeliveryTransport,
};
