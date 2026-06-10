const fs = require('fs/promises');
const path = require('path');
const config = require('../config/config');
const {sendUpdate} = require('./apiService');
const {formatAxiosError} = require('../utils/error');
const logger = require('../utils/logger');

function payloadSizeDescription(data) {
  if (Array.isArray(data)) {
    return `${data.length} records`;
  }

  if (data && typeof data === 'object') {
    return `${Object.keys(data).length} fields`;
  }

  return typeof data;
}

async function writeDeadLetter(record, deadLetterFile) {
  const directory = path.dirname(deadLetterFile);
  await fs.mkdir(directory, {recursive: true});
  await fs.appendFile(deadLetterFile, `${JSON.stringify(record)}\n`, 'utf8');
}

function createDeliveryQueue(options = {}) {
  const deliver = options.deliver || sendUpdate;
  const log = options.logger || logger;
  const queueConfig = options.config || config;
  const maxQueueSize = Math.max(queueConfig.deliveryQueueMaxSize || 1000, 1);
  const concurrency = Math.max(queueConfig.deliveryQueueConcurrency || 3, 1);
  const enableDeadLetters = queueConfig.enableDeadLetters !== false;
  const deadLetterFile = queueConfig.deadLetterFile;
  const deadLetterWriter = options.writeDeadLetter || writeDeadLetter;

  const queue = [];
  const drainWaiters = [];
  let active = 0;
  let accepted = 0;
  let completed = 0;
  let failed = 0;
  let dropped = 0;

  const getStats = () => ({
    active,
    accepted,
    completed,
    failed,
    dropped,
    pending: queue.length,
    maxQueueSize,
    concurrency,
  });

  const notifyDrainWaiters = () => {
    if (active > 0 || queue.length > 0) {
      return;
    }

    while (drainWaiters.length > 0) {
      drainWaiters.shift()();
    }
  };

  const recordDeadLetter = async (job, reason, error) => {
    if (!enableDeadLetters || !deadLetterFile) {
      return;
    }

    const record = {
      reason,
      model: job.model,
      event: job.event,
      metadata: job.metadata,
      queuedAt: job.queuedAt,
      recordedAt: new Date().toISOString(),
      error: error ? formatAxiosError(error) : undefined,
      payload: job.data,
    };

    await deadLetterWriter(record, deadLetterFile);
  };

  const runJob = async (job) => {
    try {
      await deliver(job.model, job.event, job.data);
      completed += 1;
      log.debug('Delivery queue job completed', {
        model: job.model,
        event: job.event,
        source: job.metadata.source,
        queuedAt: job.queuedAt,
      });
    } catch (error) {
      failed += 1;
      const formattedError = formatAxiosError(error);
      log.error('Delivery queue job failed after retries', {
        model: job.model,
        event: job.event,
        source: job.metadata.source,
        error: formattedError,
      });

      try {
        await recordDeadLetter(job, 'delivery_failed', error);
      } catch (deadLetterError) {
        log.error('Failed to record delivery dead letter', {
          model: job.model,
          event: job.event,
          error: formatAxiosError(deadLetterError),
        });
      }
    }
  };

  const processQueue = () => {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift();
      active += 1;

      runJob(job)
          .finally(() => {
            active -= 1;
            processQueue();
            notifyDrainWaiters();
          });
    }

    notifyDrainWaiters();
  };

  const enqueue = (model, event, data, metadata = {}) => {
    const job = {
      model,
      event,
      data,
      metadata,
      queuedAt: new Date().toISOString(),
    };

    if (queue.length >= maxQueueSize) {
      dropped += 1;
      log.error('Delivery queue is full; recording event as dead letter', {
        model,
        event,
        source: metadata.source,
        payloadSize: payloadSizeDescription(data),
        pending: queue.length,
        active,
        maxQueueSize,
      });

      recordDeadLetter(job, 'queue_full')
          .catch((error) => {
            log.error('Failed to record queue overflow dead letter', {
              model,
              event,
              error: formatAxiosError(error),
            });
          });

      return false;
    }

    queue.push(job);
    accepted += 1;
    log.debug('Queued update delivery', {
      model,
      event,
      source: metadata.source,
      payloadSize: payloadSizeDescription(data),
      pending: queue.length,
      active,
    });
    processQueue();

    return true;
  };

  const drain = () => {
    if (active === 0 && queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      drainWaiters.push(resolve);
    });
  };

  return {
    enqueue,
    getStats,
    drain,
  };
}

const defaultQueue = createDeliveryQueue();

module.exports = {
  createDeliveryQueue,
  enqueueUpdate: defaultQueue.enqueue,
  getDeliveryQueueStats: defaultQueue.getStats,
};
