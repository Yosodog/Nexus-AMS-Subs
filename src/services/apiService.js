const axios = require('axios');
const config = require('../config/config');

const apiService = {
  async sendUpdate(model, data) {
    try {
      await axios.post(
          `${config.nexusApiUrl}/${model}/update`,
          data,
          {
            headers: {
              Authorization: `Bearer ${config.nexusApiToken}`,
            },
          },
      );
      console.log(`Successfully sent update for ${model}`);
    } catch (error) {
      console.error(`Failed to send update for ${model}:`, error.message);
    }
  },
};

module.exports = apiService;
