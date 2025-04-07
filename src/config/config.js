const path = require('path');
const fs = require('fs');

// Try loading from project root (working directory first)
let dotenvPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(dotenvPath)) {
  // fallback: go up 2 levels from config.js (src/config -> ../..)
  dotenvPath = path.resolve(__dirname, '../../.env');
}

require('dotenv').config({ path: dotenvPath });

module.exports = {
  pwApiUrl: process.env.PW_API_URL,
  pwApiToken: process.env.PW_API_TOKEN,
  pusherSocketHost: process.env.PUSHER_SOCKET_HOST,
  pwAuthUrl: process.env.PW_AUTH_URL,
  nexusApiUrl: process.env.NEXUS_API_URL,
  nexusApiToken: process.env.NEXUS_API_TOKEN,
};