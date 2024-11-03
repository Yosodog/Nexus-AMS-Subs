const Pusher = require('pusher-js');
const config = require('../config/config');

const initializePusher = (channelName) => {
    const pusher = new Pusher("a22734a47847a64386c8", {
        wsHost: config.pusherSocketHost,
        authEndpoint: config.pwAuthUrl,
        disableStats: true,
        cluster: 'abc'
    });

    // Use the provided channelName to subscribe
    const channel = pusher.subscribe(channelName);

    channel.bind('pusher:subscription_succeeded', () => {
        console.log(`Successfully subscribed to channel: ${channelName}`);
    });

    channel.bind('pusher:subscription_error', (status) => {
        console.error(`Failed to subscribe to channel: ${channelName}, status: ${status}`);
    });

    pusher.connection.bind('disconnected', () => {
        console.warn(`Disconnected from Pusher. Reconnecting in 10 seconds for channel: ${channelName}...`);
        setTimeout(() => {
            console.log(`Reconnecting to channel: ${channelName}`);
            pusher.connect();
        }, 10000);
    });

    return channel;
};

module.exports = { initializePusher };
