const {initializeSubscriptions} = require('./models/subscriptionHandler');
const {shutdownPusher} = require('./services/pusherService');
const {drainDeliveryQueue} = require('./services/deliveryQueue');
const {shutdownDeliveryTransport} = require('./services/deliveryTransport');
const {createProcessHealth} = require('./services/processHealth');
const config = require('./config/config');
const logger = require('./utils/logger');

let shuttingDown = false;
const processHealth = createProcessHealth();

function safeErrorCode(error, fallback) {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : fallback;
}

async function drainWithTimeout(
    drain,
    timeoutMs,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
) {
  let timeout;
  const timeoutResult = new Promise((resolve) => {
    timeout = setTimeoutFn(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(drain).then(() => true),
      timeoutResult,
    ]);
  } finally {
    clearTimeoutFn(timeout);
  }
}

async function performGracefulShutdown(signal, options = {}) {
  const health = options.health || processHealth;
  const log = options.logger || logger;
  const stopPusher = options.shutdownPusher || shutdownPusher;
  const drain = options.drainDeliveryQueue || drainDeliveryQueue;
  const stopTransport = options.shutdownDeliveryTransport ||
    shutdownDeliveryTransport;
  const exit = options.exit || ((code) => process.exit(code));
  const timeoutMs = options.timeoutMs || config.shutdownTimeoutMs;

  try {
    await health.markStopping(signal);
  } catch (error) {
    log.error('Failed to mark subscription service as stopping', {
      code: safeErrorCode(error, 'HEALTH_WRITE_FAILED'),
    });
  }

  let transportClosed = true;
  try {
    stopPusher();
  } catch (error) {
    transportClosed = false;
    log.error('Failed to disconnect subscription source during shutdown', {
      code: safeErrorCode(error, 'SOURCE_CLOSE_FAILED'),
    });
  }

  let drained = false;
  try {
    drained = await drainWithTimeout(
        drain,
        timeoutMs,
        options.setTimeoutFn,
        options.clearTimeoutFn,
    );
  } catch (error) {
    log.error('Delivery queue drain failed during shutdown', {
      code: safeErrorCode(error, 'DRAIN_FAILED'),
    });
  }

  if (!drained) {
    log.error('Delivery queue did not drain before shutdown timeout', {
      timeoutMs,
    });
  }

  try {
    await stopTransport();
  } catch (error) {
    transportClosed = false;
    log.error('Failed to close delivery transport during shutdown', {
      code: safeErrorCode(error, 'TRANSPORT_CLOSE_FAILED'),
    });
  }

  try {
    await health.stop({signal, drained, transportClosed});
  } catch (error) {
    transportClosed = false;
    log.error('Failed to write final subscription service health state', {
      code: safeErrorCode(error, 'HEALTH_WRITE_FAILED'),
    });
  }

  exit(drained && transportClosed ? 0 : 1);
}

function registerProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection detected', {
      code: safeErrorCode(reason, 'UNHANDLED_REJECTION'),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception detected', {
      code: safeErrorCode(error, 'UNCAUGHT_EXCEPTION'),
    });
  });

  const gracefulShutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.warn('Shutdown signal received. Shutting down gracefully...', {
      signal,
    });
    await performGracefulShutdown(signal);
  };

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      gracefulShutdown(signal).catch((error) => {
        logger.error('Graceful shutdown failed', {
          code: safeErrorCode(error, 'SHUTDOWN_FAILED'),
        });
        process.exit(1);
      });
    });
  });
}

async function startApp() {
  logger.info('Starting subscription service...');
  await processHealth.start();

  try {
    registerProcessHandlers();
    initializeSubscriptions();
    await processHealth.markReady();
  } catch (error) {
    await processHealth.failStartup().catch(() => undefined);
    throw error;
  }
}

if (require.main === module) {
  startApp().catch((error) => {
    logger.error('Subscription service failed to start', {
      code: safeErrorCode(error, 'STARTUP_FAILED'),
    });
    process.exitCode = 1;
  });
}

module.exports = {
  drainWithTimeout,
  performGracefulShutdown,
  registerProcessHandlers,
  safeErrorCode,
  startApp,
};
