const { subscribeToNationUpdates } = require('./nationSubscriber');

function initializeSubscriptions() {
    subscribeToNationUpdates();
}

module.exports = { initializeSubscriptions };
