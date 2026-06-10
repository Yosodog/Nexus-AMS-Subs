const assert = require('assert');

process.env.PW_API_URL = process.env.PW_API_URL || 'https://example.test/subscribe';
process.env.PW_API_TOKEN = process.env.PW_API_TOKEN || 'pw-token';
process.env.PUSHER_SOCKET_HOST = process.env.PUSHER_SOCKET_HOST || 'socket.example.test';
process.env.PW_AUTH_URL = process.env.PW_AUTH_URL || 'https://example.test/auth';
process.env.NEXUS_API_URL = process.env.NEXUS_API_URL || 'https://nexus.example.test/api/v1/subs';
process.env.NEXUS_API_TOKEN = process.env.NEXUS_API_TOKEN || 'nexus-token';
process.env.ENABLE_SNAPSHOTS = 'false';
process.env.ENABLE_DEAD_LETTERS = 'false';

const {createDeliveryQueue} = require('../src/services/deliveryQueue');

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createGate() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });

  return {promise, resolve};
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

async function testIndexImportDoesNotStartApp() {
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
