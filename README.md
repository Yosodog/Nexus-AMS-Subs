# Nexus AMS Subs

Nexus AMS Subs is a Node.js application that listens to GraphQL subscriptions from the Politics & War API and forwards relevant updates to the Nexus AMS backend. This enables real-time synchronization of in-game nation, alliance, and war data with Nexus AMS, ensuring that alliance management and banking systems remain up to date.

## ⚠️ WARNING ⚠️
This repository is not ready for production. Use this project at your own risk. This project is currently in the pre-alpha stage.

## Nexus AMS Repository
This repository is only for the subscription side. For the Nexus AMS main repository, please go [here](https://github.com/Yosodog/Nexus-AMS).

## Features
- Subscribes to real-time updates from the Politics & War API.
- Listens for nation updates and forwards them to Nexus AMS.
- Uses **Pusher** for handling GraphQL subscriptions.
- Communicates with Nexus AMS via HTTP requests.
- Implements automatic reconnection logic for subscriptions.

## How It Works
1. **GraphQL Subscriptions**: The application subscribes to Politics & War's GraphQL API to receive real-time updates on nations, alliances, and wars, etc.
2. **Pusher Service**: Uses Pusher to manage and maintain active subscriptions.
3. **API Forwarding**: When an update/creation/deletion is received, the application sends an HTTP request to Nexus AMS with the updated data.
4. **Error Handling & Reconnection**: Automatically attempts to reconnect if a subscription is lost.
5. **Resilient Delivery**: Retries outbound deliveries and snapshot fetches with exponential backoff and actionable logging.

## Installation
### Prerequisites
- Node.js (>= 16.x)
- npm

### Clone the Repository
```bash
git clone https://github.com/Yosodog/Nexus-AMS-Subs.git
cd Nexus-AMS-Subs
```

### Install Dependencies
```bash
npm install
```

### Configuration
Create a `.env` file in the root directory and configure the following environment variables:

```
# Nexus AMS API
PW_API_URL=https://api.politicsandwar.com/subscriptions/v1/subscribe
PW_API_TOKEN=your_api_token
PUSHER_SOCKET_HOST=socket.politicsandwar.com
PW_AUTH_URL=https://api.politicsandwar.com/subscriptions/v1/auth
PUSHER_APP_KEY=a22734a47847a64386c8
PUSHER_CLUSTER=abc
NEXUS_API_URL=https://nexus_ams_url.com/api/v1/subs
NEXUS_API_TOKEN=your_nexus_api_token
PW_SNAPSHOT_URL=https://api.politicsandwar.com/subscriptions/v1/snapshot
ENABLE_SNAPSHOTS=true
SNAPSHOT_INTERVAL_MINUTES=60
SNAPSHOT_MODELS=nation
```

You can see an example with .env.example

### Running the Application
```bash
npm start
```

The application will initialize subscriptions and begin forwarding updates to Nexus AMS.

### Optional Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PUSHER_APP_KEY` | `a22734a47847a64386c8` | Override the default Pusher application key if Politics & War rotates credentials. |
| `PUSHER_CLUSTER` | `abc` | Set the cluster provided by the Politics & War API. |
| `PW_SNAPSHOT_URL` | `https://api.politicsandwar.com/subscriptions/v1/snapshot` | Alternate base URL for snapshot requests. |
| `ENABLE_SNAPSHOTS` | `true` | Disable scheduled snapshot retrievals by setting to `false`. |
| `SNAPSHOT_INTERVAL_MINUTES` | `60` | Minutes between snapshot refreshes. |
| `SNAPSHOT_MODELS` | `nation` | Comma-separated list of models to snapshot regularly. |


## Contributing
1. Fork the repository.
2. Create a new branch: `git checkout -b feature-branch-name`.
3. Make your changes and commit them: `git commit -m 'Description of changes'`.
4. Push to the branch: `git push origin feature-branch-name`.
5. Open a pull request.

## Bug Reports & Issues
If you encounter any bugs or have feature requests, please create an issue on [GitHub Issues](https://github.com/Yosodog/Nexus-AMS-Subs/issues).

Issues created here should ONLY be for the subscription project. Please use the Nexus AMS repo for issues relating to the actual application.

## License
This project is open-source and available under the GPL-3.0 License.

## Support
If you need assistance or you have questions about this project, please contact Yosodog on Discord. You can join BK's server [here](https://discord.com/invite/VrJFQMBH2R). You can also create an issue here on Github for questions relating to the project.

