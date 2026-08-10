const fs = require('fs/promises');
const path = require('path');
const {
  DELIVERY_FAILURE_THRESHOLD,
  HEALTH_SCHEMA_VERSION,
  SERVICE_NAME,
} = require('./processHealthContract');
const {
  isDevelopmentEnvironment,
  isPinnedProvenance,
} = require('./provenance');

const DEFAULT_STALE_AFTER_MS = 45000;
const FUTURE_TOLERANCE_MS = 30000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasSustainedDeliveryFailures(snapshot) {
  const consecutiveFailures = Number(
      snapshot?.delivery?.queue?.consecutiveFailures,
  );
  return Number.isInteger(consecutiveFailures) &&
    consecutiveFailures >= DELIVERY_FAILURE_THRESHOLD;
}

function validateHealthSnapshot(snapshot, options = {}) {
  const now = options.now ?? Date.now();
  const allowUnpinnedProvenance =
    typeof options.allowUnpinnedProvenance === 'boolean'
      ? options.allowUnpinnedProvenance
      : isDevelopmentEnvironment(options.nodeEnv);
  const staleAfterMs = positiveInteger(
      options.staleAfterMs ?? snapshot?.stale_after_ms,
      DEFAULT_STALE_AFTER_MS,
  );

  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return {healthy: false, reason: 'invalid_snapshot'};
  }

  if (
    snapshot.schema_version !== HEALTH_SCHEMA_VERSION ||
    snapshot.service !== SERVICE_NAME
  ) {
    return {healthy: false, reason: 'unsupported_contract'};
  }

  if (snapshot.status !== 'ready' && snapshot.status !== 'degraded') {
    return {healthy: false, reason: 'not_ready'};
  }

  if (
    typeof snapshot.build?.version !== 'string' ||
    typeof snapshot.build?.commit !== 'string' ||
    typeof snapshot.build?.release !== 'string'
  ) {
    return {healthy: false, reason: 'missing_build_metadata'};
  }

  if (
    !allowUnpinnedProvenance &&
    (!isPinnedProvenance(snapshot.build.commit) ||
      !isPinnedProvenance(snapshot.build.release))
  ) {
    return {healthy: false, reason: 'unpinned_build_metadata'};
  }

  const heartbeatAt = Date.parse(snapshot.heartbeat_at);
  if (!Number.isFinite(heartbeatAt)) {
    return {healthy: false, reason: 'invalid_heartbeat'};
  }

  if (heartbeatAt > now + FUTURE_TOLERANCE_MS) {
    return {healthy: false, reason: 'future_heartbeat'};
  }

  if (now - heartbeatAt > staleAfterMs) {
    return {healthy: false, reason: 'stale_heartbeat'};
  }

  if (hasSustainedDeliveryFailures(snapshot)) {
    return {healthy: false, reason: 'delivery_failures'};
  }

  if (snapshot.status !== 'ready') {
    return {healthy: false, reason: 'not_ready'};
  }

  return {healthy: true, reason: 'ready'};
}

async function runHealthcheck(options = {}) {
  const healthFile = options.healthFile || process.env.PROCESS_HEALTH_FILE ||
    path.resolve(process.cwd(), 'data/process-health.json');

  try {
    const contents = await fs.readFile(healthFile, 'utf8');
    const snapshot = JSON.parse(contents);
    const validationOptions = {
      now: options.now,
      staleAfterMs: options.staleAfterMs ||
        process.env.PROCESS_HEALTH_STALE_AFTER_MS,
    };

    if (typeof options.allowUnpinnedProvenance === 'boolean') {
      validationOptions.allowUnpinnedProvenance =
        options.allowUnpinnedProvenance;
    }
    if (options.nodeEnv !== undefined) {
      validationOptions.nodeEnv = options.nodeEnv;
    }

    return validateHealthSnapshot(snapshot, validationOptions);
  } catch {
    return {healthy: false, reason: 'unavailable'};
  }
}

if (require.main === module) {
  runHealthcheck().then((result) => {
    if (result.healthy) {
      process.stdout.write('healthy\n');
      return;
    }

    process.stderr.write(`unhealthy: ${result.reason}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  validateHealthSnapshot,
  runHealthcheck,
};
