const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Module = require('module');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const CONFIG_ENV_KEYS = [
  'PW_API_URL',
  'PW_API_TOKEN',
  'PUSHER_SOCKET_HOST',
  'PW_AUTH_URL',
  'NEXUS_API_URL',
  'NEXUS_API_TOKEN',
  'PUSHER_APP_KEY',
  'PUSHER_CLUSTER',
  'PW_SNAPSHOT_URL',
  'ENABLE_SNAPSHOTS',
  'SNAPSHOT_INTERVAL_MINUTES',
  'SNAPSHOT_MODELS',
  'LOG_LEVEL',
  'DELIVERY_QUEUE_CONCURRENCY',
  'DELIVERY_QUEUE_MAX_SIZE',
  'ENABLE_DEAD_LETTERS',
  'DEAD_LETTER_FILE',
];

const REQUIRED_ENV_DEFAULTS = {
  PW_API_URL: 'https://example.test/subscribe',
  PW_API_TOKEN: 'pw-token',
  PUSHER_SOCKET_HOST: 'socket.example.test',
  PW_AUTH_URL: 'https://example.test/auth',
  NEXUS_API_URL: 'https://nexus.example.test/api/v1/subs',
  NEXUS_API_TOKEN: 'nexus-token',
};

Object.entries(REQUIRED_ENV_DEFAULTS).forEach(([key, value]) => {
  process.env[key] = process.env[key] || value;
});
process.env.ENABLE_SNAPSHOTS = 'false';
process.env.ENABLE_DEAD_LETTERS = 'false';

const {createDeliveryQueue} = require('../src/services/deliveryQueue');

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const MOCK_SENSITIVE_MODULES = [
  'src/config/config.js',
  'src/index.js',
  'src/models/subscriber.js',
  'src/models/subscriptionHandler.js',
  'src/services/apiService.js',
  'src/services/deliveryQueue.js',
  'src/services/pusherService.js',
  'src/utils/logger.js',
];

function projectModulePath(relativePath) {
  return path.join(PROJECT_ROOT, relativePath);
}

function clearProjectModule(relativePath) {
  try {
    delete require.cache[require.resolve(projectModulePath(relativePath))];
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
}

function freshProjectRequire(relativePath) {
  clearProjectModule(relativePath);
  return require(projectModulePath(relativePath));
}

async function withEnv(overrides, testFn) {
  const previous = {};
  const keys = new Set([...CONFIG_ENV_KEYS, ...Object.keys(overrides)]);

  keys.forEach((key) => {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  clearProjectModule('src/config/config.js');

  try {
    return await testFn();
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    });
    clearProjectModule('src/config/config.js');
  }
}

async function withMockedModules(mocks, testFn) {
  const originalLoad = Module._load;

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await testFn();
  } finally {
    Module._load = originalLoad;
    MOCK_SENSITIVE_MODULES.forEach(clearProjectModule);
  }
}

async function withFakeTimers(options, testFn) {
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const timeouts = [];
  const intervals = [];

  global.setTimeout = (handler, delay, ...args) => {
    timeouts.push(delay);
    if (options.runTimeouts) {
      handler(...args);
    }
    return {type: 'timeout', delay};
  };

  global.setInterval = (handler, delay, ...args) => {
    intervals.push(delay);
    if (options.runIntervals) {
      handler(...args);
    }
    return {type: 'interval', delay};
  };

  global.clearInterval = () => {};

  try {
    return await testFn({timeouts, intervals});
  } finally {
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

function createGate() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });

  return {promise, resolve};
}

function createMockConfig(overrides = {}) {
  return {
    pwApiUrl: 'https://pw.example.test/subscribe',
    pwApiToken: 'pw-token',
    pusherSocketHost: 'socket.example.test',
    pwAuthUrl: 'https://pw.example.test/auth',
    nexusApiUrl: 'https://nexus.example.test/api/v1/subs',
    nexusApiToken: 'nexus-token',
    pusherAppKey: 'pusher-key',
    pusherCluster: 'abc',
    pwSnapshotUrl: 'https://pw.example.test/snapshot',
    enableSnapshots: false,
    snapshotIntervalMinutes: 60,
    logLevel: 'info',
    deliveryQueueConcurrency: 3,
    deliveryQueueMaxSize: 1000,
    enableDeadLetters: false,
    deadLetterFile: path.join(PROJECT_ROOT, 'data/dead-letter-events.jsonl'),
    snapshotModels: ['nation'],
    ...overrides,
  };
}

async function testQueueLimitsConcurrency() {
  let active = 0;
  let maxActive = 0;
  const delivered = [];

  const queue = createDeliveryQueue({
    config: {
      deliveryQueueConcurrency: 2,
      deliveryQueueMaxSize: 10,
      enableDeadLetters: false,
    },
    logger: silentLogger,
    deliver: async (model, event, data) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      delivered.push(`${model}:${event}:${data.id}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    },
  });

  [1, 2, 3, 4].forEach((id) => {
    assert.strictEqual(
        queue.enqueue('nation', 'update', {id}, {source: 'test'}),
        true,
    );
  });

  await queue.drain();

  assert.strictEqual(maxActive, 2);
  assert.deepStrictEqual(delivered.sort(), [
    'nation:update:1',
    'nation:update:2',
    'nation:update:3',
    'nation:update:4',
  ]);
  assert.deepStrictEqual(queue.getStats(), {
    active: 0,
    accepted: 4,
    completed: 4,
    failed: 0,
    dropped: 0,
    pending: 0,
    maxQueueSize: 10,
    concurrency: 2,
  });
}

async function testQueueOverflowRecordsDeadLetter() {
  const releaseDelivery = createGate();
  const deliveryStarted = createGate();
  const deadLetters = [];

  const queue = createDeliveryQueue({
    config: {
      deliveryQueueConcurrency: 1,
      deliveryQueueMaxSize: 1,
      enableDeadLetters: true,
      deadLetterFile: 'unused.jsonl',
    },
    logger: silentLogger,
    writeDeadLetter: async (record) => {
      deadLetters.push(record);
    },
    deliver: async () => {
      deliveryStarted.resolve();
      await releaseDelivery.promise;
    },
  });

  assert.strictEqual(queue.enqueue('nation', 'update', {id: 1}), true);
  await deliveryStarted.promise;
  assert.strictEqual(queue.enqueue('nation', 'update', {id: 2}), true);
  assert.strictEqual(queue.enqueue('nation', 'update', {id: 3}), false);

  releaseDelivery.resolve();
  await queue.drain();

  assert.strictEqual(queue.getStats().dropped, 1);
  assert.strictEqual(deadLetters.length, 1);
  assert.strictEqual(deadLetters[0].reason, 'queue_full');
  assert.deepStrictEqual(deadLetters[0].payload, {id: 3});
}

async function testFailedDeliveryRecordsDeadLetter() {
  const deadLetters = [];

  const queue = createDeliveryQueue({
    config: {
      deliveryQueueConcurrency: 1,
      deliveryQueueMaxSize: 5,
      enableDeadLetters: true,
      deadLetterFile: 'unused.jsonl',
    },
    logger: silentLogger,
    writeDeadLetter: async (record) => {
      deadLetters.push(record);
    },
    deliver: async () => {
      throw new Error('Nexus unavailable');
    },
  });

  assert.strictEqual(queue.enqueue('nation', 'delete', {id: 10}), true);
  await queue.drain();

  assert.strictEqual(queue.getStats().failed, 1);
  assert.strictEqual(deadLetters.length, 1);
  assert.strictEqual(deadLetters[0].reason, 'delivery_failed');
  assert.match(deadLetters[0].error, /Nexus unavailable/);
}

async function testDeliveryQueueWritesDeadLetterFile() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-ams-subs-'));
  const deadLetterFile = path.join(tempDir, 'dead-letters', 'events.jsonl');

  const queue = createDeliveryQueue({
    config: {
      deliveryQueueConcurrency: 1,
      deliveryQueueMaxSize: 5,
      enableDeadLetters: true,
      deadLetterFile,
    },
    logger: silentLogger,
    deliver: async () => {
      throw new Error('write me down');
    },
  });

  assert.strictEqual(queue.enqueue('war', 'update', {id: 42}, {source: 'test'}), true);
  await queue.drain();

  const fileContents = await fs.readFile(deadLetterFile, 'utf8');
  const records = fileContents.trim().split('\n').map((line) => JSON.parse(line));

  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].reason, 'delivery_failed');
  assert.strictEqual(records[0].model, 'war');
  assert.strictEqual(records[0].event, 'update');
  assert.deepStrictEqual(records[0].payload, {id: 42});
}

async function testConfigParsesDefaultsAndKeepsSnapshotsDisabled() {
  await withEnv({
    PW_API_URL: 'https://pw.example.test/subscribe///',
    PW_API_TOKEN: 'pw-token',
    PUSHER_SOCKET_HOST: 'socket.example.test',
    PW_AUTH_URL: 'https://pw.example.test/auth',
    NEXUS_API_URL: 'https://nexus.example.test/api/v1/subs///',
    NEXUS_API_TOKEN: 'nexus-token',
    PUSHER_APP_KEY: '',
    PUSHER_CLUSTER: '',
    PW_SNAPSHOT_URL: 'https://pw.example.test/snapshot///',
    ENABLE_SNAPSHOTS: 'true',
    SNAPSHOT_INTERVAL_MINUTES: '0',
    SNAPSHOT_MODELS: ' nation, alliance,, war ',
    LOG_LEVEL: 'DEBUG',
    DELIVERY_QUEUE_CONCURRENCY: 'not-a-number',
    DELIVERY_QUEUE_MAX_SIZE: '-5',
    ENABLE_DEAD_LETTERS: 'false',
    DEAD_LETTER_FILE: '',
  }, async () => {
    const config = freshProjectRequire('src/config/config.js');

    assert.strictEqual(config.pwApiUrl, 'https://pw.example.test/subscribe');
    assert.strictEqual(config.nexusApiUrl, 'https://nexus.example.test/api/v1/subs');
    assert.strictEqual(config.pwSnapshotUrl, 'https://pw.example.test/snapshot');
    assert.strictEqual(config.pusherAppKey, 'a22734a47847a64386c8');
    assert.strictEqual(config.pusherCluster, 'abc');
    assert.strictEqual(config.enableSnapshots, false);
    assert.strictEqual(config.snapshotIntervalMinutes, 60);
    assert.strictEqual(config.logLevel, 'debug');
    assert.strictEqual(config.deliveryQueueConcurrency, 3);
    assert.strictEqual(config.deliveryQueueMaxSize, 1000);
    assert.strictEqual(config.enableDeadLetters, false);
    assert.deepStrictEqual(config.snapshotModels, ['nation', 'alliance', 'war']);
    assert.strictEqual(Object.isFrozen(config), true);
  });
}

async function testConfigRejectsMissingRequiredEnv() {
  await withEnv({
    PW_API_URL: '',
    PW_API_TOKEN: '',
    PUSHER_SOCKET_HOST: '',
    PW_AUTH_URL: '',
    NEXUS_API_URL: '',
    NEXUS_API_TOKEN: '',
    PUSHER_APP_KEY: '',
    PUSHER_CLUSTER: '',
    PW_SNAPSHOT_URL: '',
    ENABLE_SNAPSHOTS: '',
    SNAPSHOT_INTERVAL_MINUTES: '',
    SNAPSHOT_MODELS: '',
    LOG_LEVEL: '',
    DELIVERY_QUEUE_CONCURRENCY: '',
    DELIVERY_QUEUE_MAX_SIZE: '',
    ENABLE_DEAD_LETTERS: '',
    DEAD_LETTER_FILE: '',
  }, async () => {
    assert.throws(
        () => freshProjectRequire('src/config/config.js'),
        /Missing required environment variables: pwApiUrl, pwApiToken, pusherSocketHost, pwAuthUrl, nexusApiUrl, nexusApiToken/,
    );
  });
}

async function testFormatAxiosErrorHandlesImportantShapes() {
  const {formatAxiosError} = freshProjectRequire('src/utils/error.js');

  assert.strictEqual(formatAxiosError(), 'Unknown error');
  assert.match(
      formatAxiosError({
        response: {
          status: 500,
          statusText: 'Server Error',
          data: '<html><head><title>Bad Gateway</title></head><body>nope</body></html>',
          headers: {'content-type': 'text/html'},
        },
      }),
      /HTTP 500 Server Error - HTML response \(title="Bad Gateway"\) length=\d+/,
  );
  assert.strictEqual(
      formatAxiosError({request: {}}),
      'No response received from remote server',
  );
  assert.strictEqual(formatAxiosError(new Error('plain failure')), 'plain failure');
}

async function testApiServiceSendsUpdateWithConfiguredClient() {
  let createOptions;
  const posts = [];
  const axiosMock = {
    create: (options) => {
      createOptions = options;
      return {
        post: async (endpoint, data) => {
          posts.push({endpoint, data});
        },
      };
    },
  };

  await withMockedModules({
    axios: axiosMock,
    '../config/config': createMockConfig({
      nexusApiUrl: 'https://nexus.example.test/subs',
      nexusApiToken: 'secret-token',
    }),
    '../utils/logger': silentLogger,
  }, async () => {
    const {sendUpdate} = freshProjectRequire('src/services/apiService.js');

    await sendUpdate('nation', 'update', {id: 123});

    assert.deepStrictEqual(createOptions, {
      baseURL: 'https://nexus.example.test/subs',
      timeout: 10000,
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
    });
    assert.deepStrictEqual(posts, [
      {endpoint: '/nation/update', data: {id: 123}},
    ]);
  });
}

async function testApiServiceRetriesAndThrowsTerminalError() {
  const failure = new Error('Nexus is down');
  let attempts = 0;
  let thrownError;
  const axiosMock = {
    create: () => ({
      post: async () => {
        attempts += 1;
        throw failure;
      },
    }),
  };

  await withFakeTimers({runTimeouts: true}, async ({timeouts}) => {
    await withMockedModules({
      axios: axiosMock,
      '../config/config': createMockConfig(),
      '../utils/logger': silentLogger,
    }, async () => {
      const {sendUpdate} = freshProjectRequire('src/services/apiService.js');

      try {
        await sendUpdate('nation', 'delete', {id: 456});
      } catch (error) {
        thrownError = error;
      }
    });

    assert.strictEqual(attempts, 3);
    assert.deepStrictEqual(timeouts, [2000, 4000]);
    assert.match(thrownError.message, /Failed to deliver nation:delete after 3 attempts/);
    assert.strictEqual(thrownError.cause, failure);
  });
}

async function testSubscriberBindsPusherEventsAndQueuesPayloads() {
  const bindings = {};
  const enqueued = [];
  const axiosCalls = [];
  let subscribedChannelName;
  const channel = {
    bind: (eventName, handler) => {
      bindings[eventName] = handler;
    },
    unbind: () => {},
  };

  await withMockedModules({
    axios: {
      get: async (url, options) => {
        axiosCalls.push({url, options});
        return {data: {channel: 'private-nation-update'}};
      },
    },
    '../services/pusherService': {
      subscribeToChannel: (channelName) => {
        subscribedChannelName = channelName;
        return channel;
      },
      unsubscribeFromChannel: () => {},
    },
    '../services/deliveryQueue': {
      enqueueUpdate: (model, event, payload, metadata) => {
        enqueued.push({model, event, payload, metadata});
        return true;
      },
    },
    '../config/config': createMockConfig({
      pwApiUrl: 'https://pw.example.test/subscribe',
      pwApiToken: 'pw-secret',
    }),
    '../utils/logger': silentLogger,
  }, async () => {
    const {subscribe} = freshProjectRequire('src/models/subscriber.js');

    await subscribe('nation', 'update');

    assert.deepStrictEqual(axiosCalls, [
      {
        url: 'https://pw.example.test/subscribe/nation/update?api_key=pw-secret',
        options: {timeout: 10000},
      },
    ]);
    assert.strictEqual(subscribedChannelName, 'private-nation-update');
    assert.strictEqual(typeof bindings.NATION_UPDATE, 'function');
    assert.strictEqual(typeof bindings.BULK_NATION_UPDATE, 'function');
    assert.strictEqual(typeof bindings['pusher:subscription_succeeded'], 'function');
    assert.strictEqual(typeof bindings['pusher:subscription_error'], 'function');

    bindings.NATION_UPDATE({id: 1});
    bindings.BULK_NATION_UPDATE([{id: 2}]);

    assert.deepStrictEqual(enqueued, [
      {
        model: 'nation',
        event: 'update',
        payload: {id: 1},
        metadata: {source: 'single'},
      },
      {
        model: 'nation',
        event: 'update',
        payload: [{id: 2}],
        metadata: {source: 'bulk'},
      },
    ]);
  });
}

async function testSubscriberSubscriptionErrorUnsubscribesAndSchedulesRetry() {
  const bindings = {};
  const unboundEvents = [];
  const unsubscribedChannels = [];
  let axiosCalls = 0;
  const channel = {
    bind: (eventName, handler) => {
      bindings[eventName] = handler;
    },
    unbind: (eventName) => {
      unboundEvents.push(eventName);
    },
  };

  await withFakeTimers({runTimeouts: false}, async ({timeouts}) => {
    await withMockedModules({
      axios: {
        get: async () => {
          axiosCalls += 1;
          return {data: {channel: `private-nation-delete-${axiosCalls}`}};
        },
      },
      '../services/pusherService': {
        subscribeToChannel: () => channel,
        unsubscribeFromChannel: (channelName) => {
          unsubscribedChannels.push(channelName);
        },
      },
      '../services/deliveryQueue': {
        enqueueUpdate: () => true,
      },
      '../config/config': createMockConfig(),
      '../utils/logger': silentLogger,
    }, async () => {
      const {subscribe} = freshProjectRequire('src/models/subscriber.js');

      await subscribe('nation', 'delete');
      bindings['pusher:subscription_error']({status: 403});
    });

    assert.strictEqual(axiosCalls, 1);
    assert.deepStrictEqual(unsubscribedChannels, ['private-nation-delete-1']);
    assert.deepStrictEqual(unboundEvents, [
      'pusher:subscription_succeeded',
      'pusher:subscription_error',
      'NATION_DELETE',
      'BULK_NATION_DELETE',
    ]);
    assert.deepStrictEqual(timeouts, [3000]);
  });
}

async function testInitializeSubscriptionsSubscribesAllEventsAndDoesNotScheduleSnapshots() {
  const subscribeCalls = [];
  let snapshotFetches = 0;
  let sentSnapshots = 0;

  await withFakeTimers({runTimeouts: false, runIntervals: false}, async ({intervals}) => {
    await withMockedModules({
      axios: {
        get: async () => {
          snapshotFetches += 1;
          throw new Error('Snapshots should be disabled');
        },
      },
      '../services/apiService': {
        sendUpdate: async () => {
          sentSnapshots += 1;
        },
      },
      '../config/config': createMockConfig({
        enableSnapshots: false,
        snapshotModels: ['nation', 'alliance'],
        snapshotIntervalMinutes: 1,
      }),
      './subscriber': {
        subscribe: (model, event) => {
          subscribeCalls.push(`${model}:${event}`);
          return Promise.resolve();
        },
      },
      '../utils/logger': silentLogger,
    }, async () => {
      const {initializeSubscriptions} =
        freshProjectRequire('src/models/subscriptionHandler.js');

      initializeSubscriptions();
    });

    assert.deepStrictEqual(subscribeCalls, [
      'nation:create',
      'nation:update',
      'nation:delete',
      'alliance:create',
      'alliance:update',
      'alliance:delete',
      'city:create',
      'city:update',
      'city:delete',
      'war:create',
      'war:update',
      'war:delete',
      'warattack:create',
      'account:create',
      'account:update',
      'account:delete',
    ]);
    assert.deepStrictEqual(intervals, []);
    assert.strictEqual(snapshotFetches, 0);
    assert.strictEqual(sentSnapshots, 0);
  });
}

async function testPusherServiceConfiguresSingletonAndShutdown() {
  const constructed = [];

  class MockPusher {
    constructor(key, options) {
      this.key = key;
      this.options = options;
      this.connectionHandlers = {};
      this.channels = new Map();
      this.connected = false;
      this.disconnected = false;
      this.unsubscribed = [];
      this.connection = {
        bind: (eventName, handler) => {
          this.connectionHandlers[eventName] = handler;
        },
      };
      constructed.push(this);
    }

    subscribe(channelName) {
      const channel = {name: channelName};
      this.channels.set(channelName, channel);
      return channel;
    }

    channel(channelName) {
      return this.channels.get(channelName);
    }

    unsubscribe(channelName) {
      this.unsubscribed.push(channelName);
      this.channels.delete(channelName);
    }

    connect() {
      this.connected = true;
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  await withFakeTimers({runTimeouts: true}, async ({timeouts}) => {
    await withMockedModules({
      'pusher-js': MockPusher,
      '../config/config': createMockConfig({
        pusherAppKey: 'custom-key',
        pusherSocketHost: 'socket.example.test',
        pwAuthUrl: 'https://pw.example.test/auth',
        pusherCluster: 'test-cluster',
        pwApiToken: 'pw-token',
      }),
      '../utils/logger': silentLogger,
    }, async () => {
      const pusherService = freshProjectRequire('src/services/pusherService.js');

      const first = pusherService.getPusherInstance();
      const second = pusherService.getPusherInstance();
      const channel = pusherService.subscribeToChannel('private-test');

      assert.strictEqual(first, second);
      assert.strictEqual(channel.name, 'private-test');
      assert.strictEqual(constructed.length, 1);
      assert.strictEqual(first.key, 'custom-key');
      assert.deepStrictEqual(first.options, {
        wsHost: 'socket.example.test',
        authEndpoint: 'https://pw.example.test/auth',
        disableStats: true,
        cluster: 'test-cluster',
        forceTLS: true,
        enabledTransports: ['ws', 'wss'],
        auth: {
          headers: {
            Authorization: 'Bearer pw-token',
          },
        },
      });

      pusherService.unsubscribeFromChannel('private-test');
      assert.deepStrictEqual(first.unsubscribed, ['private-test']);

      first.connectionHandlers.disconnected();
      assert.deepStrictEqual(timeouts, [10000]);
      assert.strictEqual(first.connected, true);

      pusherService.shutdownPusher();
      assert.strictEqual(first.disconnected, true);

      const third = pusherService.getPusherInstance();
      assert.notStrictEqual(third, first);
      assert.strictEqual(constructed.length, 2);
      pusherService.shutdownPusher();
    });
  });
}

async function testPusherServiceSupportsNamedPusherExport() {
  const constructed = [];

  class MockPusher {
    constructor(key, options) {
      this.key = key;
      this.options = options;
      this.connection = {
        bind: () => {},
      };
      this.disconnected = false;
      constructed.push(this);
    }

    disconnect() {
      this.disconnected = true;
    }
  }

  await withMockedModules({
    'pusher-js': {Pusher: MockPusher},
    '../config/config': createMockConfig({
      pusherAppKey: 'named-export-key',
      pusherSocketHost: 'socket.example.test',
      pwAuthUrl: 'https://pw.example.test/auth',
      pusherCluster: 'test-cluster',
      pwApiToken: 'pw-token',
    }),
    '../utils/logger': silentLogger,
  }, async () => {
    const pusherService = freshProjectRequire('src/services/pusherService.js');

    const instance = pusherService.getPusherInstance();

    assert.strictEqual(constructed.length, 1);
    assert.strictEqual(instance.key, 'named-export-key');
    assert.strictEqual(instance.options.wsHost, 'socket.example.test');

    pusherService.shutdownPusher();
    assert.strictEqual(instance.disconnected, true);
  });
}

async function testIndexImportDoesNotStartApp() {
  clearProjectModule('src/index.js');
  clearProjectModule('src/models/subscriptionHandler.js');
  const beforeSigintListeners = process.listenerCount('SIGINT');
  const app = require('../src/index');
  const afterSigintListeners = process.listenerCount('SIGINT');

  assert.strictEqual(typeof app.startApp, 'function');
  assert.strictEqual(typeof app.registerProcessHandlers, 'function');
  assert.strictEqual(afterSigintListeners, beforeSigintListeners);
}

async function run() {
  const tests = [
    ['delivery queue limits concurrency', testQueueLimitsConcurrency],
    ['delivery queue dead-letters overflow', testQueueOverflowRecordsDeadLetter],
    ['delivery queue dead-letters failed sends', testFailedDeliveryRecordsDeadLetter],
    ['delivery queue writes JSONL dead-letter file', testDeliveryQueueWritesDeadLetterFile],
    ['config parses defaults and keeps snapshots disabled', testConfigParsesDefaultsAndKeepsSnapshotsDisabled],
    ['config rejects missing required env', testConfigRejectsMissingRequiredEnv],
    ['axios error formatter handles important shapes', testFormatAxiosErrorHandlesImportantShapes],
    ['api service sends update with configured client', testApiServiceSendsUpdateWithConfiguredClient],
    ['api service retries and throws terminal error', testApiServiceRetriesAndThrowsTerminalError],
    ['subscriber binds pusher events and queues payloads', testSubscriberBindsPusherEventsAndQueuesPayloads],
    ['subscriber subscription error unsubscribes and schedules retry', testSubscriberSubscriptionErrorUnsubscribesAndSchedulesRetry],
    ['initialize subscriptions covers all events and leaves snapshots disabled', testInitializeSubscriptionsSubscribesAllEventsAndDoesNotScheduleSnapshots],
    ['pusher service configures singleton and shutdown', testPusherServiceConfiguresSingletonAndShutdown],
    ['pusher service supports named pusher export', testPusherServiceSupportsNamedPusherExport],
    ['index import does not start app', testIndexImportDoesNotStartApp],
  ];

  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
