const {initializeSubscriptions} = require('./models/subscriptionHandler');
const {shutdownPusher} = require('./services/pusherService');
const {drainDeliveryQueue} = require('./services/deliveryQueue');
const {shutdownDeliveryTransport} = require('./services/deliveryTransport');
const logger = require('./utils/logger');

let shuttingDown = false;

function registerProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection detected', {
      reason,
      stack: reason?.stack,
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception detected', {
      error,
      stack: error?.stack,
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
    shutdownPusher();

    const timeout = new Promise((resolve) => setTimeout(resolve, 10000));
    await Promise.race([drainDeliveryQueue(), timeout]);

    try {
      await shutdownDeliveryTransport();
    } catch (error) {
      logger.error('Failed to close delivery transport during shutdown', {error});
    }

    process.exit(0);
  };

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      gracefulShutdown(signal).catch((error) => {
        logger.error('Graceful shutdown failed', {error});
        process.exit(1);
      });
    });
  });
}

function startApp() {
  logger.info('Starting subscription service...');
  registerProcessHandlers();
  initializeSubscriptions();
}

if (require.main === module) {
  startApp();
}

module.exports = {
  registerProcessHandlers,
  startApp,
};
