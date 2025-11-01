const Pusher = require('pusher-js');
const config = require('../config/config');

let pusherInstance;

const getPusherInstance = () => {
  if (!pusherInstance) {
    pusherInstance = new Pusher('a22734a47847a64386c8', {
      wsHost: config.pusherSocketHost,
      authEndpoint: config.pwAuthUrl,
      disableStats: true,
      cluster: 'abc',
    });

    pusherInstance.connection.bind('disconnected', () => {
      console.warn('Disconnected from Pusher. Reconnecting in 10 seconds...');
      setTimeout(() => {
        console.log('Attempting to reconnect to Pusher...');
        pusherInstance.connect();
      }, 10000);
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

module.exports = {getPusherInstance, subscribeToChannel, unsubscribeFromChannel};
