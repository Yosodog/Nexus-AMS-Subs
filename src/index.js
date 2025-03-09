const {initializeSubscriptions} = require('./models/subscriptionHandler');

function startApp() {
  console.log('Starting subscription service...');
  initializeSubscriptions();
}

startApp();
