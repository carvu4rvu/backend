/**
 * Shared API error response helper.
 * All backend errors MUST use this format for consistent frontend handling.
 *
 * Format:
 * {
 *   success: false,
 *   errorCode: string,
 *   message: string,
 *   fieldErrors?: { [field_name]: string }
 * }
 */

/** Error codes for student profile API */
const ERROR_CODES = {
  VALIDATION: 'STUDENT_PROFILE_VALIDATION_ERROR',
  NOT_FOUND: 'STUDENT_PROFILE_NOT_FOUND',
  ACCESS_DENIED: 'STUDENT_PROFILE_ACCESS_DENIED',
  LOCKED: 'STUDENT_PROFILE_LOCKED',
  DUPLICATE: 'STUDENT_PROFILE_DUPLICATE',
  OPT_IN_ELIGIBILITY: 'STUDENT_OPT_IN_ELIGIBILITY',
  AUTH: 'AUTH_ERROR',
  SERVER: 'SERVER_ERROR',
};

/**
 * Sends a structured error response and returns it (for optional chaining).
 * Use with: return sendValidationError(res, '...', { field: 'msg' });
 *
 * @param {import('express').Response} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string} message - Human-readable message
 * @param {object} options - { errorCode?, fieldErrors? }
 * @returns {object} The response object for chaining
 */
function sendError(res, status, message, options = {}) {
  const { errorCode = ERROR_CODES.SERVER, fieldErrors } = options;
  const body = {
    success: false,
    errorCode,
    message: message || 'Something went wrong. Please try again.',
  };
  if (fieldErrors && typeof fieldErrors === 'object' && Object.keys(fieldErrors).length > 0) {
    body.fieldErrors = fieldErrors;
  }
  res.status(status).json(body);
  return res;
}

/**
 * Sends 400 validation error with optional fieldErrors.
 * @param {import('express').Response} res
 * @param {string} message
 * @param {Record<string, string>} [fieldErrors]
 */
function sendValidationError(res, message, fieldErrors = {}) {
  return sendError(res, 400, message, {
    errorCode: ERROR_CODES.VALIDATION,
    fieldErrors: Object.keys(fieldErrors).length ? fieldErrors : undefined,
  });
}

/**
 * Sends 404 not found.
 */
function sendNotFound(res, message = 'The requested resource was not found.') {
  return sendError(res, 404, message, { errorCode: ERROR_CODES.NOT_FOUND });
}

/**
 * Sends 403 access denied.
 */
function sendAccessDenied(res, message = "You don't have permission to perform this action.") {
  return sendError(res, 403, message, { errorCode: ERROR_CODES.ACCESS_DENIED });
}

/**
 * Sends 409 conflict (e.g., duplicate).
 */
function sendConflict(res, message, errorCode = ERROR_CODES.DUPLICATE) {
  return sendError(res, 409, message, { errorCode });
}

/**
 * Sends 423 locked (section locked after placement).
 */
function sendLocked(res, message = 'You cannot edit this record after placement approval.') {
  return sendError(res, 423, message, { errorCode: ERROR_CODES.LOCKED });
}

/**
 * Converts a caught error (DB, Supabase, etc.) to a user-friendly response.
 * Uses constraintErrors.getFriendlyMessage when available.
 *
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} [fallbackMessage]
 */
function sendCaughtError(res, err, fallbackMessage = 'Something went wrong. Please try again.') {
  const { getFriendlyMessage } = require('./constraintErrors');
  const message = getFriendlyMessage(err) || err?.message || fallbackMessage;
  const status = err?.code === '23505' ? 409 : 400; // 23505 = unique violation
  const errorCode = err?.code === '23505' ? ERROR_CODES.DUPLICATE : ERROR_CODES.VALIDATION;
  return sendError(res, status, message, { errorCode });
}

module.exports = {
  ERROR_CODES,
  sendError,
  sendValidationError,
  sendNotFound,
  sendAccessDenied,
  sendConflict,
  sendLocked,
  sendCaughtError,
};
