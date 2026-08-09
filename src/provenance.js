const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const UNKNOWN_PROVENANCE = 'unknown';

function normalizeEnvironment(value = process.env.NODE_ENV) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isDevelopmentEnvironment(value = process.env.NODE_ENV) {
  return ['development', 'test'].includes(normalizeEnvironment(value));
}

function normalizeIdentifier(value, fallback = UNKNOWN_PROVENANCE) {
  const normalized = typeof value === 'string' ? value.trim() : '';

  return IDENTIFIER_PATTERN.test(normalized) &&
    normalized.toLowerCase() !== UNKNOWN_PROVENANCE
    ? normalized
    : fallback;
}

function isPinnedProvenance(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';

  return normalized.length > 0 &&
    normalized.toLowerCase() !== UNKNOWN_PROVENANCE &&
    IDENTIFIER_PATTERN.test(normalized);
}

function assertPinnedProvenance(
    {buildCommit, releaseId},
    {allowUnpinned = false} = {},
) {
  if (allowUnpinned) {
    return;
  }

  const missing = [];
  if (!isPinnedProvenance(buildCommit)) {
    missing.push('BUILD_COMMIT');
  }
  if (!isPinnedProvenance(releaseId)) {
    missing.push('NEXUS_RELEASE_ID');
  }

  if (missing.length > 0) {
    throw new Error(
        `Pinned immutable provenance is required outside development/test: ${missing.join(', ')}.`,
    );
  }
}

module.exports = {
  assertPinnedProvenance,
  isDevelopmentEnvironment,
  isPinnedProvenance,
  normalizeEnvironment,
  normalizeIdentifier,
};
