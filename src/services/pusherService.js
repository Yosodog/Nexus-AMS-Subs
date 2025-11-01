const Pusher = require('pusher-js');
const config = require('../config/config');

let pusherInstance;

const getPusherInstance = () => {
  if (!pusherInstance) {
    pusherInstance = new Pusher(config.pusherAppKey, {
      wsHost: config.pusherSocketHost,
      authEndpoint: config.pwAuthUrl,
      disableStats: true,
      cluster: config.pusherCluster,
      forceTLS: true,
      enabledTransports: ['ws', 'wss'],
      auth: {
        headers: {
          Authorization: `Bearer ${config.pwApiToken}`,
        },
      },
    });

    pusherInstance.connection.bind('connected', () => {
      console.log('Connected to Pusher.');
    });

    pusherInstance.connection.bind('disconnected', () => {
      console.warn('Disconnected from Pusher. Reconnecting in 10 seconds...');
      setTimeout(() => {
        console.log('Attempting to reconnect to Pusher...');
        pusherInstance.connect();
      }, 10000);
    });

    pusherInstance.connection.bind('error', (event) => {
      console.error('Pusher connection error:', event);
    });
  }

  return pusherInstance;
};

const subscribeToChannel = (channelName) => {
  const pusher = getPusherInstance();
  const channel = pusher.subscribe(channelName);

  return channel;
};

const unsubscribeFromChannel = (channelName) => {
  const pusher = getPusherInstance();

  if (pusher.channel(channelName)) {
    pusher.unsubscribe(channelName);
  }
};

const shutdownPusher = () => {
  if (pusherInstance) {
    pusherInstance.disconnect();
    pusherInstance = undefined;
  }
};

module.exports = {
  getPusherInstance,
  subscribeToChannel,
  unsubscribeFromChannel,
  shutdownPusher,
};
