require('dotenv').config();

module.exports = {
    pwApiUrl: process.env.PW_API_URL,
    pwApiToken: process.env.PW_API_TOKEN,
    pusherSocketHost: process.env.PUSHER_SOCKET_HOST,
    pwAuthUrl: process.env.PW_AUTH_URL,
    nexusApiUrl: process.env.NEXUS_API_URL,
    nexusApiToken: process.env.NEXUS_API_TOKEN,
};
