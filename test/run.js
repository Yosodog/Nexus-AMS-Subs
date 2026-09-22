const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const Module = require('module');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const subscriptionEnvelopeFixture = require(
    './fixtures/subscription-envelope/v1.json',
);

const CONFIG_ENV_KEYS = [
  'NODE_ENV',
  'PW_API_URL',
  'PW_API_TOKEN',
  'PUSHER_SOCKET_HOST',
  'PW_AUTH_URL',
  'NEXUS_API_URL',
  'NEXUS_API_TOKEN',
  'DELIVERY_DRIVER',
  'SUBS_REDIS_URL',
  'SUBS_REDIS_STREAM',
  'SUBS_REDIS_HMAC_SECRET',
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
  'PROCESS_HEALTH_FILE',
  'PROCESS_HEALTH_INTERVAL_MS',
  'PROCESS_HEALTH_STALE_AFTER_MS',
  'SHUTDOWN_TIMEOUT_MS',
  'BUILD_COMMIT',
  'NEXUS_RELEASE_ID',
];

// Local tests use the explicit development/test provenance path.
process.env.NODE_ENV = 'test';

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
process.env.DELIVERY_DRIVER = 'http';

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
  'src/healthcheck.js',
  'src/processHealthContract.js',
  'src/provenance.js',
  'src/services/apiService.js',
  'src/services/deliveryQueue.js',
  'src/services/deliveryTransport.js',
  'src/services/pusherService.js',
  'src/services/processHealth.js',
  'src/services/redisStreamService.js',
  'src/services/subscriptionEnvelope.js',
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
    const value = Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key]
      : key === 'NODE_ENV'
        ? 'test'
        : undefined;
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
    deliveryDriver: 'http',
    subsRedisUrl: 'redis://redis.example.test:6379/3',
    subsRedisStream: 'nexus:subscriptions:v1',
    subsRedisHmacSecret: 's'.repeat(32),
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
    processHealthFile: path.join(PROJECT_ROOT, 'data/process-health.json'),
    processHealthIntervalMs: 15000,
    processHealthStaleAfterMs: 45000,
    shutdownTimeoutMs: 60000,
    buildCommit: 'test-commit',
    releaseId: 'test-release',
    allowUnpinnedProvenance: true,
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
    consecutiveFailures: 0,
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

async function testTerminalDeliveryDeadLettersOnceWithClassification() {
  const deadLetters = [];
  let deliveryAttempts = 0;
  const terminalError = Object.assign(new Error('HTTP 422 validation failed'), {
    code: 'DELIVERY_TERMINAL_4XX',
    classification: 'terminal_4xx',
    retryable: false,
    status: 422,
  });

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
      deliveryAttempts += 1;
      throw terminalError;
    },
  });

  assert.strictEqual(queue.enqueue('nation', 'update', {id: 10}), true);
  await queue.drain();

  assert.strictEqual(deliveryAttempts, 1);
  assert.strictEqual(deadLetters.length, 1);
  assert.strictEqual(deadLetters[0].reason, 'terminal_4xx');
  assert.strictEqual(deadLetters[0].classification, 'terminal_4xx');
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
    DELIVERY_DRIVER: '',
    SUBS_REDIS_URL: '',
    SUBS_REDIS_STREAM: '',
    SUBS_REDIS_HMAC_SECRET: '',
    PROCESS_HEALTH_FILE: '',
    PROCESS_HEALTH_INTERVAL_MS: '0',
    PROCESS_HEALTH_STALE_AFTER_MS: 'not-a-number',
    SHUTDOWN_TIMEOUT_MS: '-5',
    BUILD_COMMIT: 'bad\ncommit',
    NEXUS_RELEASE_ID: 'release-2026.08.07',
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
    assert.strictEqual(config.deliveryDriver, 'http');
    assert.strictEqual(config.subsRedisStream, 'nexus:subscriptions:v1');
    assert.strictEqual(config.enableDeadLetters, false);
    assert.strictEqual(
        config.processHealthFile,
        path.resolve(process.cwd(), 'data/process-health.json'),
    );
    assert.strictEqual(config.processHealthIntervalMs, 15000);
    assert.strictEqual(config.processHealthStaleAfterMs, 45000);
    assert.strictEqual(config.shutdownTimeoutMs, 60000);
    assert.strictEqual(config.buildCommit, 'unknown');
    assert.strictEqual(config.releaseId, 'release-2026.08.07');
    assert.deepStrictEqual(config.snapshotModels, ['nation', 'alliance', 'war']);
    assert.strictEqual(Object.isFrozen(config), true);
  });
}

async function testConfigReadsCredentialFilesBeforeEnvironmentValues() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-subs-credentials-'));
  const pwTokenFile = path.join(tempDir, 'pw-api-token');
  const nexusTokenFile = path.join(tempDir, 'nexus-api-token');
  const hmacFile = path.join(tempDir, 'redis-hmac');

  await fs.writeFile(pwTokenFile, 'file-pw-token\n', {mode: 0o600});
  await fs.writeFile(nexusTokenFile, 'file-nexus-token\n', {mode: 0o600});
  await fs.writeFile(hmacFile, `${'h'.repeat(32)}\n`, {mode: 0o600});

  try {
    await withEnv({
      ...REQUIRED_ENV_DEFAULTS,
      PW_API_TOKEN: 'environment-pw-token',
      PW_API_TOKEN_FILE: pwTokenFile,
      NEXUS_API_TOKEN: 'environment-nexus-token',
      NEXUS_API_TOKEN_FILE: nexusTokenFile,
      SUBS_REDIS_HMAC_SECRET: 'e'.repeat(32),
      SUBS_REDIS_HMAC_SECRET_FILE: hmacFile,
      NODE_ENV: 'test',
      DELIVERY_DRIVER: 'http',
    }, async () => {
      const config = freshProjectRequire('src/config/config.js');

      assert.strictEqual(config.pwApiToken, 'file-pw-token');
      assert.strictEqual(config.nexusApiToken, 'file-nexus-token');
      assert.strictEqual(config.subsRedisHmacSecret, 'h'.repeat(32));
    });
  } finally {
    await fs.rm(tempDir, {recursive: true, force: true});
  }
}

async function testConfigAcceptsPinnedProductionProvenance() {
  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    NODE_ENV: 'production',
    DELIVERY_DRIVER: 'http',
    BUILD_COMMIT: '6956bf40295276a861b3b5796c85c5a8f161241b',
    NEXUS_RELEASE_ID: 'release-2026.08.08.1',
  }, async () => {
    const config = freshProjectRequire('src/config/config.js');

    assert.strictEqual(
        config.buildCommit,
        '6956bf40295276a861b3b5796c85c5a8f161241b',
    );
    assert.strictEqual(config.releaseId, 'release-2026.08.08.1');
    assert.strictEqual(config.allowUnpinnedProvenance, false);
  });
}

async function testConfigAllowsUnpinnedProvenanceOnlyInDevelopment() {
  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    NODE_ENV: 'development',
    DELIVERY_DRIVER: 'http',
    BUILD_COMMIT: '',
    NEXUS_RELEASE_ID: 'unknown',
  }, async () => {
    const config = freshProjectRequire('src/config/config.js');

    assert.strictEqual(config.buildCommit, 'unknown');
    assert.strictEqual(config.releaseId, 'unknown');
    assert.strictEqual(config.allowUnpinnedProvenance, true);
  });
}

async function testConfigRejectsUnpinnedProductionProvenance() {
  for (const [key, value] of [
    ['BUILD_COMMIT', undefined],
    ['BUILD_COMMIT', ''],
    ['BUILD_COMMIT', 'unknown'],
    ['BUILD_COMMIT', 'bad\ncommit'],
    ['NEXUS_RELEASE_ID', undefined],
    ['NEXUS_RELEASE_ID', ''],
    ['NEXUS_RELEASE_ID', 'unknown'],
    ['NEXUS_RELEASE_ID', 'bad\nrelease'],
  ]) {
    await withEnv({
      ...REQUIRED_ENV_DEFAULTS,
      NODE_ENV: 'production',
      DELIVERY_DRIVER: 'http',
      BUILD_COMMIT: '6956bf40295276a861b3b5796c85c5a8f161241b',
      NEXUS_RELEASE_ID: 'release-2026.08.08.1',
      [key]: value,
    }, async () => {
      assert.throws(
          () => freshProjectRequire('src/config/config.js'),
          new RegExp(`Pinned immutable provenance.*${key}`),
      );
    });
  }
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
    DELIVERY_DRIVER: 'http',
    SUBS_REDIS_URL: '',
    SUBS_REDIS_STREAM: '',
    SUBS_REDIS_HMAC_SECRET: '',
  }, async () => {
    assert.throws(
        () => freshProjectRequire('src/config/config.js'),
        /Missing required environment variables: pwApiUrl, pwApiToken, pusherSocketHost, pwAuthUrl, nexusApiUrl, nexusApiToken/,
    );
  });
}

async function testConfigRequiresOnlyActiveDeliveryTransport() {
  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    DELIVERY_DRIVER: 'redis-stream',
    NEXUS_API_URL: '',
    NEXUS_API_TOKEN: '',
    SUBS_REDIS_URL: 'rediss://redis.example.test:6380/3',
    SUBS_REDIS_STREAM: 'custom:subscriptions',
    SUBS_REDIS_HMAC_SECRET: 's'.repeat(32),
  }, async () => {
    const config = freshProjectRequire('src/config/config.js');

    assert.strictEqual(config.deliveryDriver, 'redis-stream');
    assert.strictEqual(config.subsRedisUrl, 'rediss://redis.example.test:6380/3');
    assert.strictEqual(config.subsRedisStream, 'custom:subscriptions');
    assert.strictEqual(config.subsRedisHmacSecret, 's'.repeat(32));
  });

  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    DELIVERY_DRIVER: 'redis-stream',
    NEXUS_API_URL: '',
    NEXUS_API_TOKEN: '',
    SUBS_REDIS_URL: '',
    SUBS_REDIS_STREAM: '',
    SUBS_REDIS_HMAC_SECRET: 's'.repeat(32),
  }, async () => {
    assert.throws(
        () => freshProjectRequire('src/config/config.js'),
        /Missing required environment variables: subsRedisUrl/,
    );
  });

  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    DELIVERY_DRIVER: 'redis-stream',
    NEXUS_API_URL: '',
    NEXUS_API_TOKEN: '',
    SUBS_REDIS_URL: 'redis://redis.example.test:6379/3',
    SUBS_REDIS_STREAM: 'nexus:subscriptions:v1',
    SUBS_REDIS_HMAC_SECRET: '',
  }, async () => {
    assert.throws(
        () => freshProjectRequire('src/config/config.js'),
        /Missing required environment variables: subsRedisHmacSecret/,
    );
  });

  await withEnv({
    ...REQUIRED_ENV_DEFAULTS,
    DELIVERY_DRIVER: 'redis-stream',
    NEXUS_API_URL: '',
    NEXUS_API_TOKEN: '',
    SUBS_REDIS_URL: 'redis://redis.example.test:6379/3',
    SUBS_REDIS_STREAM: 'nexus:subscriptions:v1',
    SUBS_REDIS_HMAC_SECRET: 'too-short',
  }, async () => {
    assert.throws(
        () => freshProjectRequire('src/config/config.js'),
        /SUBS_REDIS_HMAC_SECRET must be configured with at least 32 characters/,
    );
  });
}

async function testSubscriptionEnvelopeMatchesNexusCanonicalHmacContract() {
  const {
    canonicalPayload,
    createSignedEnvelope,
    ENVELOPE_FIELDS,
    SIGNED_FIELDS,
  } = freshProjectRequire('src/services/subscriptionEnvelope.js');
  const {envelope, hmac_key: hmacKey, canonical_payload: canonical} =
    subscriptionEnvelopeFixture;
  const fields = Object.fromEntries(
      SIGNED_FIELDS.map((field) => [field, envelope[field]]),
  );

  assert.ok(hmacKey.length >= 32);
  assert.deepStrictEqual(SIGNED_FIELDS, [
    'message_id',
    'schema_version',
    'model',
    'event',
    'source',
    'received_at',
    'payload',
  ]);
  assert.deepStrictEqual(ENVELOPE_FIELDS, [...SIGNED_FIELDS, 'signature']);
  assert.strictEqual(canonicalPayload(fields), canonical);
  assert.deepStrictEqual(createSignedEnvelope(fields, hmacKey), envelope);
}

async function testSubscriptionEnvelopeRejectsSignatureMismatch() {
  const {
    createSignedEnvelope,
    signEnvelope,
  } = freshProjectRequire('src/services/subscriptionEnvelope.js');
  const {envelope, hmac_key: hmacKey} = subscriptionEnvelopeFixture;
  const tamperedFields = {
    ...envelope,
    payload: JSON.stringify({id: 4242, name: 'Tampered Nation'}),
  };
  delete tamperedFields.signature;

  assert.notStrictEqual(signEnvelope(tamperedFields, hmacKey), envelope.signature);
  assert.notStrictEqual(
      createSignedEnvelope(tamperedFields, hmacKey).signature,
      envelope.signature,
  );
}

async function testRedisStreamServicePublishesVersionedMessage() {
  const handlers = {};
  const published = [];
  let connected = 0;
  let closed = 0;
  const mockClient = {
    isReady: false,
    isOpen: false,
    on(event, handler) {
      handlers[event] = handler;
      return this;
    },
    async connect() {
      connected += 1;
      this.isReady = true;
      this.isOpen = true;
    },
    async xAdd(stream, id, fields) {
      published.push({stream, id, fields});
      return '1234-0';
    },
    async close() {
      closed += 1;
      this.isReady = false;
      this.isOpen = false;
    },
  };

  await withMockedModules({
    redis: {createClient: () => mockClient},
    '../config/config': createMockConfig({
      deliveryDriver: 'redis-stream',
      subsRedisStream: 'nexus:test:subscriptions',
      subsRedisHmacSecret: subscriptionEnvelopeFixture.hmac_key,
    }),
    '../utils/logger': silentLogger,
  }, async () => {
    const {publishUpdate, shutdownRedisStream} =
      freshProjectRequire('src/services/redisStreamService.js');

    const expectedEnvelope = subscriptionEnvelopeFixture.envelope;
    const payload = JSON.parse(expectedEnvelope.payload);
    const streamId = await publishUpdate(
        expectedEnvelope.model,
        expectedEnvelope.event,
        payload,
        {
          messageId: expectedEnvelope.message_id,
          source: expectedEnvelope.source,
          receivedAt: expectedEnvelope.received_at,
        },
    );

    assert.strictEqual(streamId, '1234-0');
    assert.strictEqual(connected, 1);
    assert.deepStrictEqual(published, [{
      stream: 'nexus:test:subscriptions',
      id: '*',
      fields: expectedEnvelope,
    }]);
    assert.deepStrictEqual(
        JSON.parse(published[0].fields.payload),
        payload,
    );

    await shutdownRedisStream();
    assert.strictEqual(closed, 1);
  });
}

async function testRedisStreamServiceRetainsMessageIdAcrossRetries() {
  const published = [];
  let connected = 0;
  let attempts = 0;
  const mockClient = {
    isReady: false,
    isOpen: false,
    on() {
      return this;
    },
    async connect() {
      connected += 1;
      this.isReady = true;
      this.isOpen = true;
    },
    async xAdd(stream, id, fields) {
      attempts += 1;
      published.push({stream, id, fields});

      if (attempts === 1) {
        throw new Error('transient Redis failure');
      }

      return '1234-1';
    },
    async close() {
      this.isReady = false;
      this.isOpen = false;
    },
  };
  const originalSetTimeout = global.setTimeout;

  global.setTimeout = (callback) => {
    callback();
    return {unref() {}};
  };

  try {
    await withMockedModules({
      redis: {createClient: () => mockClient},
      '../config/config': createMockConfig({deliveryDriver: 'redis-stream'}),
      '../utils/logger': silentLogger,
    }, async () => {
      const {publishUpdate} =
        freshProjectRequire('src/services/redisStreamService.js');

      const streamId = await publishUpdate('war', 'update', {id: 77}, {
        messageId: 'message-retried',
        source: 'single',
        receivedAt: '2026-07-19T18:30:00.000Z',
      });

      assert.strictEqual(streamId, '1234-1');
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.strictEqual(connected, 1);
  assert.strictEqual(published.length, 2);
  assert.strictEqual(published[0].fields.message_id, 'message-retried');
  assert.deepStrictEqual(published[1].fields, published[0].fields);
}

async function testRedisStreamServiceUsesOpenReconnectingClient() {
  let connected = 0;
  const mockClient = {
    isReady: false,
    isOpen: true,
    on() {
      return this;
    },
    async connect() {
      connected += 1;
    },
    async xAdd() {
      return '1234-2';
    },
    async close() {
      this.isOpen = false;
    },
  };

  await withMockedModules({
    redis: {createClient: () => mockClient},
    '../config/config': createMockConfig({deliveryDriver: 'redis-stream'}),
    '../utils/logger': silentLogger,
  }, async () => {
    const {publishUpdate} =
      freshProjectRequire('src/services/redisStreamService.js');

    assert.strictEqual(
        await publishUpdate('city', 'update', {id: 88}, {
          messageId: 'message-reconnecting',
          source: 'single',
          receivedAt: '2026-07-19T18:30:00.000Z',
        }),
        '1234-2',
    );
  });

  assert.strictEqual(connected, 0);
}

async function testDeliveryTransportSelectsRedisWithoutHttpFallback() {
  const calls = [];

  await withMockedModules({
    '../config/config': createMockConfig({deliveryDriver: 'redis-stream'}),
    './apiService': {
      sendUpdate: async () => calls.push('http'),
    },
    './redisStreamService': {
      publishUpdate: async (...args) => calls.push(['redis', ...args]),
      shutdownRedisStream: async () => calls.push('shutdown'),
    },
  }, async () => {
    const {deliverUpdate, shutdownDeliveryTransport} =
      freshProjectRequire('src/services/deliveryTransport.js');

    await deliverUpdate('city', 'update', {id: 55}, {messageId: 'message-55'});
    await shutdownDeliveryTransport();
  });

  assert.deepStrictEqual(calls, [
    ['redis', 'city', 'update', {id: 55}, {messageId: 'message-55'}],
    'shutdown',
  ]);
}

async function testFormatAxiosErrorHandlesImportantShapes() {
  const {formatAxiosError} = freshProjectRequire('src/utils/error.js');

  assert.strictEqual(formatAxiosError(), 'Unknown error');
  assert.strictEqual(
      formatAxiosError({
        response: {
          status: 500,
          statusText: 'Server Error',
          data: '<html><head><title>Bad Gateway</title></head><body>nope</body></html>',
          headers: {'content-type': 'text/html'},
        },
      }),
      'HTTP 500 Server Error - response body omitted',
  );
  assert.doesNotMatch(
      formatAxiosError({
        response: {
          status: 422,
          statusText: 'Unprocessable Entity',
          data: {token: 'response-token', payload: [{id: 1}]},
        },
      }),
      /response-token|payload/,
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

async function testApiServiceDoesNotRetryTerminalHttp4xx() {
  const responseFailure = {
    response: {
      status: 400,
      statusText: 'Bad Request',
      data: {
        token: 'response-token',
        records: [{id: 123, secret: 'response-secret'}],
      },
    },
  };
  let attempts = 0;
  let thrownError;
  const logs = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, metadata) => logs.push({message, metadata}),
  };
  const axiosMock = {
    create: () => ({
      post: async () => {
        attempts += 1;
        throw responseFailure;
      },
    }),
  };

  await withFakeTimers({runTimeouts: true}, async ({timeouts}) => {
    await withMockedModules({
      axios: axiosMock,
      '../config/config': createMockConfig(),
      '../utils/logger': logger,
    }, async () => {
      const {sendUpdate} = freshProjectRequire('src/services/apiService.js');

      try {
        await sendUpdate(
            'nation',
            'update',
            {id: 123, token: 'payload-token'},
            {messageId: 'message-terminal-400'},
        );
      } catch (error) {
        thrownError = error;
      }
    });

    assert.strictEqual(attempts, 1);
    assert.deepStrictEqual(timeouts, []);
    assert.strictEqual(thrownError.code, 'DELIVERY_TERMINAL_4XX');
    assert.strictEqual(thrownError.classification, 'terminal_4xx');
    assert.strictEqual(thrownError.retryable, false);
    assert.strictEqual(thrownError.status, 400);
    assert.strictEqual(thrownError.cause, responseFailure);

    const serializedLogs = JSON.stringify(logs);
    assert.doesNotMatch(serializedLogs, /response-token|response-secret|payload-token/);
  });
}

async function testApiServiceRetriesTransientHttpFailures() {
  const failures = [
    ['network failure', new Error('Nexus is down')],
    ['timeout', Object.assign(new Error('timeout'), {code: 'ECONNABORTED'})],
    ['request timeout', {response: {status: 408, statusText: 'Request Timeout'}}],
    ['rate limit', {response: {status: 429, statusText: 'Too Many Requests'} }],
    ['server failure', {response: {status: 503, statusText: 'Service Unavailable'} }],
  ];

  for (const [label, failure] of failures) {
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
          await sendUpdate('war', 'update', {id: 456});
        } catch (error) {
          thrownError = error;
        }
      });

      assert.strictEqual(attempts, 3, label);
      assert.deepStrictEqual(timeouts, [2000, 4000], label);
      assert.strictEqual(thrownError.classification, 'retry_exhausted', label);
    });
  }
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

async function testProcessHealthPublishesSanitizedLifecycle() {
  const snapshots = [];
  let heartbeat;
  let intervalDelay;
  let timerCleared = false;
  let timerUnrefed = false;
  let timestamp = Date.parse('2026-08-07T05:00:00.000Z');
  const timer = {
    unref: () => {
      timerUnrefed = true;
    },
  };
  const healthConfig = createMockConfig({
    pwApiToken: 'must-not-appear',
    nexusApiToken: 'also-must-not-appear',
    subsRedisUrl: 'rediss://credential@redis.example.test:6380/3',
  });
  const {createProcessHealth} = freshProjectRequire(
      'src/services/processHealth.js',
  );
  const health = createProcessHealth({
    config: healthConfig,
    now: () => {
      const value = new Date(timestamp);
      timestamp += 1000;
      return value;
    },
    getDeliveryQueueStats: () => ({
      active: 1,
      accepted: 2,
      completed: 1,
      failed: 0,
      dropped: 0,
      pending: 0,
      maxQueueSize: 1000,
      concurrency: 3,
    }),
    writeSnapshot: async (healthFile, snapshot) => {
      assert.strictEqual(healthFile, healthConfig.processHealthFile);
      snapshots.push(snapshot);
    },
    setIntervalFn: (handler, delay) => {
      heartbeat = handler;
      intervalDelay = delay;
      return timer;
    },
    clearIntervalFn: (receivedTimer) => {
      assert.strictEqual(receivedTimer, timer);
      timerCleared = true;
    },
    logger: silentLogger,
  });

  await health.start();
  await health.markReady();
  await heartbeat();
  await health.markStopping('SIGTERM');
  await health.stop({
    signal: 'SIGTERM',
    drained: true,
    transportClosed: true,
  });

  assert.strictEqual(intervalDelay, 15000);
  assert.strictEqual(timerUnrefed, true);
  assert.strictEqual(timerCleared, true);
  assert.deepStrictEqual(
      snapshots.map((snapshot) => snapshot.status),
      ['starting', 'ready', 'ready', 'stopping', 'stopped'],
  );
  assert.deepStrictEqual(snapshots.at(-1).shutdown, {
    signal: 'SIGTERM',
    drained: true,
    transport_closed: true,
  });
  assert.deepStrictEqual(snapshots[1].build, {
    version: '1.0.0',
    commit: 'test-commit',
    release: 'test-release',
  });
  assert.deepStrictEqual({
    contract_version: snapshots[1].contract_version,
    component_id: snapshots[1].component_id,
    runtime_state: snapshots[1].runtime_state,
    health_state: snapshots[1].health_state,
    reachable: snapshots[1].reachable,
    installed: snapshots[1].installed,
    enabled: snapshots[1].enabled,
    configuration_ready: snapshots[1].configuration_ready,
    version: snapshots[1].version,
    release_id: snapshots[1].release_id,
  }, {
    contract_version: 1,
    component_id: 'nexus-subs',
    runtime_state: 'ready',
    health_state: 'healthy',
    reachable: true,
    installed: true,
    enabled: true,
    configuration_ready: true,
    version: '1.0.0',
    release_id: 'test-release',
  });
  assert.strictEqual(snapshots[1].delivery.driver, 'http');
  assert.strictEqual(snapshots[1].delivery.queue.accepted, 2);

  const serialized = JSON.stringify(snapshots);
  assert.doesNotMatch(serialized, /must-not-appear/);
  assert.doesNotMatch(serialized, /credential@redis/);
}

async function testProcessHealthDegradesAndRecoversAfterDeliveryFailures() {
  const snapshots = [];
  let heartbeat;
  let timestamp = Date.parse('2026-08-07T05:00:00.000Z');
  const deliveryStats = {
    active: 0,
    accepted: 3,
    completed: 0,
    failed: 3,
    dropped: 0,
    pending: 0,
    maxQueueSize: 1000,
    concurrency: 3,
    consecutiveFailures: 0,
  };
  const {DELIVERY_FAILURE_THRESHOLD} = freshProjectRequire(
      'src/processHealthContract.js',
  );
  const {createProcessHealth} = freshProjectRequire(
      'src/services/processHealth.js',
  );
  const health = createProcessHealth({
    config: createMockConfig({
      pwApiToken: 'health-pw-token',
      nexusApiToken: 'health-nexus-token',
    }),
    now: () => new Date(timestamp += 1000),
    getDeliveryQueueStats: () => ({...deliveryStats}),
    writeSnapshot: async (healthFile, snapshot) => snapshots.push(snapshot),
    setIntervalFn: (handler) => {
      heartbeat = handler;
      return {unref: () => {}};
    },
    logger: silentLogger,
  });

  await health.start();
  await health.markReady();

  deliveryStats.consecutiveFailures = DELIVERY_FAILURE_THRESHOLD;
  await heartbeat();
  const degradedSnapshot = snapshots.at(-1);
  assert.strictEqual(degradedSnapshot.status, 'degraded');
  assert.strictEqual(
      degradedSnapshot.delivery.queue.consecutiveFailures,
      DELIVERY_FAILURE_THRESHOLD,
  );

  const {validateHealthSnapshot} = freshProjectRequire('src/healthcheck.js');
  assert.deepStrictEqual(
      validateHealthSnapshot(degradedSnapshot, {
        now: Date.parse(degradedSnapshot.heartbeat_at) + 1000,
      }),
      {healthy: false, reason: 'delivery_failures'},
  );

  const serialized = JSON.stringify(degradedSnapshot);
  assert.doesNotMatch(serialized, /health-pw-token|health-nexus-token|payload/);

  deliveryStats.consecutiveFailures = 0;
  deliveryStats.completed = 1;
  await heartbeat();
  const recoveredSnapshot = snapshots.at(-1);
  assert.strictEqual(recoveredSnapshot.status, 'ready');
  assert.deepStrictEqual(
      validateHealthSnapshot(recoveredSnapshot, {
        now: Date.parse(recoveredSnapshot.heartbeat_at) + 1000,
      }),
      {healthy: true, reason: 'ready'},
  );
}

async function testProcessHealthRejectsUnpinnedProvenanceBeforeReadiness() {
  const {createProcessHealth} = freshProjectRequire(
      'src/services/processHealth.js',
  );
  const invalidConfig = createMockConfig({
    buildCommit: 'unknown',
    releaseId: '',
    allowUnpinnedProvenance: false,
  });

  const createHealth = () => createProcessHealth({
    config: invalidConfig,
    writeSnapshot: async () => {
      throw new Error('unreachable');
    },
    logger: silentLogger,
  });

  await assert.rejects(
      () => createHealth().start(),
      /Pinned immutable provenance.*BUILD_COMMIT.*NEXUS_RELEASE_ID/,
  );
  await assert.rejects(
      () => createHealth().markReady(),
      /Pinned immutable provenance.*BUILD_COMMIT.*NEXUS_RELEASE_ID/,
  );
}

async function testProcessHealthFileAndHealthcheckContract() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-subs-health-'));
  const healthFile = path.join(tempDir, 'nested', 'process-health.json');
  const heartbeatAt = '2026-08-07T05:00:00.000Z';
  const snapshot = {
    schema_version: 1,
    service: 'nexus-ams-subs',
    status: 'ready',
    heartbeat_at: heartbeatAt,
    stale_after_ms: 45000,
    build: {
      version: '1.0.0',
      commit: 'abc123',
      release: 'release-1',
    },
  };
  const {writeHealthSnapshot} = freshProjectRequire(
      'src/services/processHealth.js',
  );
  const {
    runHealthcheck,
    validateHealthSnapshot,
  } = freshProjectRequire('src/healthcheck.js');

  await writeHealthSnapshot(healthFile, snapshot);

  const stored = JSON.parse(await fs.readFile(healthFile, 'utf8'));
  const mode = (await fs.stat(healthFile)).mode & 0o777;
  assert.deepStrictEqual(stored, snapshot);
  assert.strictEqual(mode, 0o600);
  assert.deepStrictEqual(
      validateHealthSnapshot(snapshot, {
        now: Date.parse(heartbeatAt) + 10000,
      }),
      {healthy: true, reason: 'ready'},
  );
  assert.deepStrictEqual(
      await runHealthcheck({
        healthFile,
        now: Date.parse(heartbeatAt) + 10000,
      }),
      {healthy: true, reason: 'ready'},
  );
  assert.deepStrictEqual(
      validateHealthSnapshot(snapshot, {
        now: Date.parse(heartbeatAt) + 60000,
      }),
      {healthy: false, reason: 'stale_heartbeat'},
  );
  assert.deepStrictEqual(
      validateHealthSnapshot({...snapshot, status: 'stopping'}, {
        now: Date.parse(heartbeatAt),
      }),
      {healthy: false, reason: 'not_ready'},
  );
  assert.deepStrictEqual(
      validateHealthSnapshot({...snapshot, heartbeat_at: 'invalid'}),
      {healthy: false, reason: 'invalid_heartbeat'},
  );
  assert.deepStrictEqual(
      validateHealthSnapshot({
        ...snapshot,
        build: {...snapshot.build, commit: 'unknown'},
      }, {
        now: Date.parse(heartbeatAt) + 10000,
        allowUnpinnedProvenance: false,
      }),
      {healthy: false, reason: 'unpinned_build_metadata'},
  );
  assert.deepStrictEqual(
      validateHealthSnapshot({
        ...snapshot,
        build: {...snapshot.build, release: ''},
      }, {
        now: Date.parse(heartbeatAt) + 10000,
        allowUnpinnedProvenance: false,
      }),
      {healthy: false, reason: 'unpinned_build_metadata'},
  );
  await writeHealthSnapshot(healthFile, {
    ...snapshot,
    build: {...snapshot.build, commit: 'unknown'},
  });
  await withEnv({NODE_ENV: 'production'}, async () => {
    const {runHealthcheck} = freshProjectRequire('src/healthcheck.js');

    assert.deepStrictEqual(
        await runHealthcheck({
          healthFile,
          now: Date.parse(heartbeatAt) + 10000,
        }),
        {healthy: false, reason: 'unpinned_build_metadata'},
    );
  });

  await fs.rm(tempDir, {recursive: true, force: true});
}

async function testGracefulShutdownReportsDrainOutcome() {
  const {
    performGracefulShutdown,
    safeErrorCode,
  } = freshProjectRequire('src/index.js');
  assert.strictEqual(safeErrorCode({code: 'ECONNRESET'}, 'FALLBACK'), 'ECONNRESET');
  assert.strictEqual(
      safeErrorCode({code: 'secret\nvalue'}, 'FALLBACK'),
      'FALLBACK',
  );
  const successfulHealthCalls = [];
  const successfulOrder = [];
  const successfulExitCodes = [];

  await performGracefulShutdown('SIGTERM', {
    health: {
      markStopping: async (signal) => successfulHealthCalls.push([
        'stopping',
        signal,
      ]),
      stop: async (result) => successfulHealthCalls.push(['stopped', result]),
    },
    logger: silentLogger,
    shutdownPusher: () => successfulOrder.push('pusher'),
    drainDeliveryQueue: async () => successfulOrder.push('drain'),
    shutdownDeliveryTransport: async () => successfulOrder.push('transport'),
    exit: (code) => successfulExitCodes.push(code),
    timeoutMs: 100,
  });

  assert.deepStrictEqual(successfulOrder, ['pusher', 'drain', 'transport']);
  assert.deepStrictEqual(successfulExitCodes, [0]);
  assert.deepStrictEqual(successfulHealthCalls, [
    ['stopping', 'SIGTERM'],
    ['stopped', {
      signal: 'SIGTERM',
      drained: true,
      transportClosed: true,
    }],
  ]);

  const timedOutHealthCalls = [];
  const timedOutExitCodes = [];
  await performGracefulShutdown('SIGINT', {
    health: {
      markStopping: async () => {},
      stop: async (result) => timedOutHealthCalls.push(result),
    },
    logger: silentLogger,
    shutdownPusher: () => {},
    drainDeliveryQueue: () => new Promise(() => {}),
    shutdownDeliveryTransport: async () => {},
    exit: (code) => timedOutExitCodes.push(code),
    timeoutMs: 100,
    setTimeoutFn: (handler) => {
      handler();
      return 'timer';
    },
    clearTimeoutFn: () => {},
  });

  assert.deepStrictEqual(timedOutExitCodes, [1]);
  assert.deepStrictEqual(timedOutHealthCalls, [{
    signal: 'SIGINT',
    drained: false,
    transportClosed: true,
  }]);

  const transportFailureLogs = [];
  const transportFailureHealthCalls = [];
  const transportFailureExitCodes = [];
  await performGracefulShutdown('SIGTERM', {
    health: {
      markStopping: async () => {},
      stop: async (result) => transportFailureHealthCalls.push(result),
    },
    logger: {
      ...silentLogger,
      error: (message, metadata) => {
        transportFailureLogs.push({message, metadata});
      },
    },
    shutdownPusher: () => {},
    drainDeliveryQueue: async () => {},
    shutdownDeliveryTransport: async () => {
      const error = new Error('rediss://secret@redis.example.test');
      error.code = 'ECONNRESET';
      throw error;
    },
    exit: (code) => transportFailureExitCodes.push(code),
    timeoutMs: 100,
  });

  assert.deepStrictEqual(transportFailureExitCodes, [1]);
  assert.deepStrictEqual(transportFailureHealthCalls, [{
    signal: 'SIGTERM',
    drained: true,
    transportClosed: false,
  }]);
  assert.deepStrictEqual(transportFailureLogs, [{
    message: 'Failed to close delivery transport during shutdown',
    metadata: {code: 'ECONNRESET'},
  }]);
  assert.doesNotMatch(JSON.stringify(transportFailureLogs), /secret@redis/);
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
    ['terminal deliveries dead-letter once with classification', testTerminalDeliveryDeadLettersOnceWithClassification],
    ['delivery queue writes JSONL dead-letter file', testDeliveryQueueWritesDeadLetterFile],
    ['config parses defaults and keeps snapshots disabled', testConfigParsesDefaultsAndKeepsSnapshotsDisabled],
    ['config reads credential files before environment values', testConfigReadsCredentialFilesBeforeEnvironmentValues],
    ['config accepts pinned production provenance', testConfigAcceptsPinnedProductionProvenance],
    ['config allows unpinned provenance only in development', testConfigAllowsUnpinnedProvenanceOnlyInDevelopment],
    ['config rejects unpinned production provenance', testConfigRejectsUnpinnedProductionProvenance],
    ['config rejects missing required env', testConfigRejectsMissingRequiredEnv],
    ['config requires only active delivery transport', testConfigRequiresOnlyActiveDeliveryTransport],
    ['subscription envelope matches Nexus canonical HMAC contract', testSubscriptionEnvelopeMatchesNexusCanonicalHmacContract],
    ['subscription envelope rejects signature mismatch', testSubscriptionEnvelopeRejectsSignatureMismatch],
    ['axios error formatter handles important shapes', testFormatAxiosErrorHandlesImportantShapes],
    ['api service sends update with configured client', testApiServiceSendsUpdateWithConfiguredClient],
    ['api service retries and throws terminal error', testApiServiceRetriesAndThrowsTerminalError],
    ['api service does not retry terminal HTTP 4xx', testApiServiceDoesNotRetryTerminalHttp4xx],
    ['api service retries transient HTTP failures', testApiServiceRetriesTransientHttpFailures],
    ['redis stream service publishes versioned message', testRedisStreamServicePublishesVersionedMessage],
    ['redis stream service retains message IDs across retries', testRedisStreamServiceRetainsMessageIdAcrossRetries],
    ['redis stream service uses an open reconnecting client', testRedisStreamServiceUsesOpenReconnectingClient],
    ['delivery transport selects redis without HTTP fallback', testDeliveryTransportSelectsRedisWithoutHttpFallback],
    ['subscriber binds pusher events and queues payloads', testSubscriberBindsPusherEventsAndQueuesPayloads],
    ['subscriber subscription error unsubscribes and schedules retry', testSubscriberSubscriptionErrorUnsubscribesAndSchedulesRetry],
    ['initialize subscriptions covers all events and leaves snapshots disabled', testInitializeSubscriptionsSubscribesAllEventsAndDoesNotScheduleSnapshots],
    ['pusher service configures singleton and shutdown', testPusherServiceConfiguresSingletonAndShutdown],
    ['pusher service supports named pusher export', testPusherServiceSupportsNamedPusherExport],
    ['process health publishes sanitized lifecycle', testProcessHealthPublishesSanitizedLifecycle],
    ['process health degrades and recovers after delivery failures', testProcessHealthDegradesAndRecoversAfterDeliveryFailures],
    ['process health rejects unpinned provenance before readiness', testProcessHealthRejectsUnpinnedProvenanceBeforeReadiness],
    ['process health file satisfies healthcheck contract', testProcessHealthFileAndHealthcheckContract],
    ['graceful shutdown reports delivery drain outcome', testGracefulShutdownReportsDrainOutcome],
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
