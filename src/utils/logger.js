const config = require('../config/config');

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

function formatMeta(meta) {
  if (meta === undefined) {
    return '';
  }

  if (meta instanceof Error) {
    return serializeMetaValue(meta);
  }

  if (Array.isArray(meta)) {
    return meta.map(serializeMetaValue).join(', ');
  }

  if (typeof meta === 'object') {
    const entries = Object.entries(meta);
    if (entries.length === 0) {
      return '';
    }
    return entries
        .map(([key, value]) => `${key}=${serializeMetaValue(value)}`)
        .join(' ');
  }

  return serializeMetaValue(meta);
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
