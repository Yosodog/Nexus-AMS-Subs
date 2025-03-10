const axios = require('axios');
const config = require('../config/config');

const apiService = {
  async sendUpdate(model, event, data) {
    try {
      await axios.post(
          `${config.nexusApiUrl}/${model}/${event}`,
          data,
          {
            headers: {
              Authorization: `Bearer ${config.nexusApiToken}`,
            },
          },
      );
      console.log(`Successfully sent ${event} for ${model}`);
    } catch (error) {
      console.error(`Failed to send ${event} for ${model}:`, error.message);
    }
  },
};

module.exports = apiService;
