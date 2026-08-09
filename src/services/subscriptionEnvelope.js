const {createHmac} = require('crypto');

const SIGNED_FIELDS = Object.freeze([
  'message_id',
  'schema_version',
  'model',
  'action',
  'occurred_at',
  'key',
  'payload',
]);

const ENVELOPE_FIELDS = Object.freeze([...SIGNED_FIELDS, 'signature']);

function canonicalPayload(fields) {
  return SIGNED_FIELDS.map((field) => {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) {
      throw new Error(`Subscription stream message is missing [${field}].`);
    }

    const value = fields[field];

    if (typeof value !== 'string') {
      throw new TypeError(
          `Subscription stream field [${field}] must be a string.`,
      );
    }

    return `${field}:${Buffer.byteLength(value, 'utf8')}:${value}`;
  }).join('\n');
}

function signEnvelope(fields, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
        'SUBS_REDIS_HMAC_SECRET must be configured with at least 32 characters.',
    );
  }

  return createHmac('sha256', secret)
      .update(canonicalPayload(fields), 'utf8')
      .digest('hex');
}

function createSignedEnvelope(fields, secret) {
  const signature = signEnvelope(fields, secret);
  const signedFields = Object.fromEntries(
      SIGNED_FIELDS.map((field) => [field, fields[field]]),
  );

  return {
    ...signedFields,
    signature,
  };
}

module.exports = {
  ENVELOPE_FIELDS,
  SIGNED_FIELDS,
  canonicalPayload,
  createSignedEnvelope,
  signEnvelope,
};
