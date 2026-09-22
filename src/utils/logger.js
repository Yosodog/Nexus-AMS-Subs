const config = require('../config/config');
const fs = require('fs');

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const activeLevel =
  LEVELS[config.logLevel?.toLowerCase()] !== undefined
    ? config.logLevel.toLowerCase()
    : 'info';

function collectConfiguredSecrets() {
  const values = [
    config.pwApiToken,
    config.nexusApiToken,
    config.subsRedisHmacSecret,
  ];

  for (const key of [
    'PW_API_TOKEN',
    'NEXUS_API_TOKEN',
    'SUBS_REDIS_HMAC_SECRET',
  ]) {
    const filePath = process.env[`${key}_FILE`];
    if (!filePath) {
      continue;
    }

    try {
      values.push(fs.readFileSync(filePath, 'utf8').trim());
    } catch {
      // Configuration validation reports the missing file without logging it.
    }
  }

  return values.filter((value) => typeof value === 'string' && value.length > 0);
}

const configuredSecrets = collectConfiguredSecrets();

function serializeMetaValue(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[unserializable object]';
    }
  }

  return String(value);
}

function redactSecrets(value) {
  return configuredSecrets.reduce((result, secret) => {
    return result.replaceAll(secret, '[REDACTED]');
  }, value);
}

function formatMeta(meta) {
  if (meta === undefined) {
    return '';
  }

  if (meta instanceof Error) {
    return redactSecrets(serializeMetaValue(meta));
  }

  if (Array.isArray(meta)) {
    return redactSecrets(meta.map(serializeMetaValue).join(', '));
  }

  if (typeof meta === 'object') {
    const entries = Object.entries(meta);
    if (entries.length === 0) {
      return '';
    }
    return redactSecrets(entries
        .map(([key, value]) => `${key}=${serializeMetaValue(value)}`)
        .join(' '));
  }

  return redactSecrets(serializeMetaValue(meta));
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[activeLevel];
}

function log(level, message, meta) {
  const normalizedLevel = level.toLowerCase();
  if (!shouldLog(normalizedLevel)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const metaText = formatMeta(meta);
  const base = `${timestamp} ${normalizedLevel.toUpperCase().padEnd(5)} ${message}`;
  const line = metaText ? `${base} | ${metaText}` : base;
  process.stdout.write(`${line}\n`);
}

const logger = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};

module.exports = logger;
