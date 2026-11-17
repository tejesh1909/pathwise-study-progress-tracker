const { RuleError } = require('../../shared/rules');

const STATUS = { VALIDATION: 400, FORBIDDEN: 403, NOT_FOUND: 404, LOCKED: 409, CONFLICT: 409 };

/** Wraps an async route handler so rejected promises reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof RuleError) {
    return res.status(STATUS[err.code] || 400).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err && err.name === 'CastError') return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body', code: 'VALIDATION' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side', code: 'SERVER_ERROR' });
}

module.exports = { ah, errorHandler };
