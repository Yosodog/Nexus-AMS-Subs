const {initializeSubscriptions} = require('./models/subscriptionHandler');
const {shutdownPusher} = require('./services/pusherService');

let shuttingDown = false;

function registerProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection detected:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception detected:', error);
  });

  const gracefulShutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`${signal} received. Shutting down gracefully...`);
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
  console.log('Starting subscription service...');
  registerProcessHandlers();
  initializeSubscriptions();
}

startApp();
