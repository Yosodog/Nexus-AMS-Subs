const {initializeSubscriptions} = require('./models/subscriptionHandler');
const {shutdownPusher} = require('./services/pusherService');
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

  const gracefulShutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.warn('Shutdown signal received. Shutting down gracefully...', {
      signal,
    });
    shutdownPusher();
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  };

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => gracefulShutdown(signal));
  });
}

function startApp() {
  logger.info('Starting subscription service...');
  registerProcessHandlers();
  initializeSubscriptions();
}

startApp();
