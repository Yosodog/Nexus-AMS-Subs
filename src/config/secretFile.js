const fs = require('fs');

/**
 * Resolve a secret from a root-owned credential file when the corresponding
 * *_FILE setting is present. The file setting is authoritative: falling back
 * to an environment value after a configured file cannot be read would make a
 * deployment silently use the wrong credential.
 *
 * @param {string} environmentKey
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string|undefined}
 */
function readSecret(environmentKey, environment = process.env) {
  const fileKey = `${environmentKey}_FILE`;
  const filePath = environment[fileKey];

  if (typeof filePath === 'string' && filePath.trim() !== '') {
    try {
      const value = fs.readFileSync(filePath, 'utf8').trim();

      if (value !== '') {
        return value;
      }
    } catch {
      // Treat an unreadable credential file as missing without echoing its
      // path or contents into logs. The caller reports only the key name.
    }

    return undefined;
  }

  const value = environment[environmentKey];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

module.exports = {readSecret};
