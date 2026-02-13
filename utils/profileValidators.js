/**
 * Shared profile validation helpers.
 * Use for backend validation — same rules as frontend for consistency.
 * Never trust client input; always re-validate on the server.
 */

const { isValidPhoneNumber, PHONE_LENGTH } = require('./phoneNormalizer');

/** Regex: valid email */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Regex: date YYYY-MM-DD */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Regex: country code +[1-4 digits] */
const COUNTRY_CODE_REGEX = /^\+[0-9]{1,4}$/;

/** Education levels (DB enum-like) */
const EDUCATION_LEVELS = ['10TH', '12TH', 'DIPLOMA', 'GRADUATION', 'POST_GRADUATION', 'OTHER', 'EDUCATION_GAP'];

/** Result types */
const RESULT_TYPES = ['PERCENTAGE', 'CGPA'];

/** Gap types */
const GAP_TYPES = ['12TH_TO_GRADUATION', 'DIPLOMA_TO_GRADUATION', 'GRADUATION_TO_POST_GRADUATION'];

/** Visibility */
const VISIBILITY_VALUES = ['PRIVATE', 'PUBLIC', 'PUBLIC_LINK'];

const currentYear = new Date().getFullYear();

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string} [message]
 * @property {string} [field]
 */

/**
 * Validates email format.
 * @param {string} value
 * @returns {ValidationResult}
 */
function validateEmail(value) {
  if (!value || typeof value !== 'string') return { valid: false, message: 'Please enter a valid email address.' };
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: 'Email is required.' };
  if (!EMAIL_REGEX.test(trimmed)) return { valid: false, message: 'Please enter a valid email address.' };
  return { valid: true };
}

/**
 * Validates college email (same format as personal; can add domain check if needed).
 */
function validateCollegeEmail(value) {
  return validateEmail(value);
}

/**
 * Validates phone number (10 digits).
 * @param {string} value
 * @returns {ValidationResult}
 */
function validatePhoneNumber(value) {
  if (value === null || value === undefined || value === '') return { valid: true }; // optional
  const str = String(value).trim();
  if (!str) return { valid: true };
  if (!isValidPhoneNumber(str)) {
    return { valid: false, message: `Please enter a valid phone number (e.g. 1234567890). Use ${PHONE_LENGTH} digits only.` };
  }
  return { valid: true };
}

/**
 * Validates country code format +[1-4 digits].
 */
function validateCountryCode(value) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const str = String(value).trim();
  if (!str) return { valid: true };
  const normalized = str.startsWith('+') ? str : `+${str}`;
  if (!COUNTRY_CODE_REGEX.test(normalized)) {
    return { valid: false, message: 'Please enter a valid country code (e.g. +91 for India).' };
  }
  return { valid: true };
}

/**
 * Validates date string YYYY-MM-DD, not in future.
 */
function validateDate(value, options = {}) {
  const { allowEmpty = true, allowFuture = false } = options;
  if (value === null || value === undefined || value === '') {
    return allowEmpty ? { valid: true } : { valid: false, message: 'Date is required.' };
  }
  const str = String(value).trim().split('T')[0];
  if (!DATE_REGEX.test(str)) {
    return { valid: false, message: 'Please enter a valid date (YYYY-MM-DD).' };
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) {
    return { valid: false, message: 'Please enter a valid date.' };
  }
  if (!allowFuture && date > new Date()) {
    return { valid: false, message: 'Date cannot be in the future.' };
  }
  return { valid: true };
}

/**
 * Validates date range: end >= start.
 */
function validateDateRange(start, end) {
  if (!start || !end) return { valid: true };
  const s = String(start).trim().split('T')[0];
  const e = String(end).trim().split('T')[0];
  if (!DATE_REGEX.test(s) || !DATE_REGEX.test(e)) return { valid: true };
  if (new Date(e) < new Date(s)) {
    return { valid: false, message: 'End date cannot be earlier than start date.' };
  }
  return { valid: true };
}

/**
 * Validates year (4 digits, reasonable range).
 */
function validateYear(value, options = {}) {
  const { min = 1900, max = currentYear } = options;
  if (value === null || value === undefined || value === '') {
    return options.allowEmpty ? { valid: true } : { valid: false, message: 'Year is required.' };
  }
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n)) return { valid: false, message: 'Please enter a valid year.' };
  if (n < min || n > max) return { valid: false, message: `Year must be between ${min} and ${max}.` };
  return { valid: true };
}

/**
 * Validates semester (1-12).
 */
function validateSemester(value) {
  if (value === null || value === undefined || value === '') {
    return { valid: false, message: 'Semester is required.' };
  }
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 1 || n > 12) {
    return { valid: false, message: 'Semester must be between 1 and 12.' };
  }
  return { valid: true };
}

/**
 * Validates SGPA (0-10, max 2 decimals).
 */
function validateSgpa(value) {
  if (value === null || value === undefined || value === '') {
    return { valid: false, message: 'SGPA is required.' };
  }
  const n = parseFloat(String(value));
  if (Number.isNaN(n) || n < 0 || n > 10) {
    return { valid: false, message: 'SGPA must be between 0 and 10.' };
  }
  // Check max 2 decimal places
  const str = String(value).trim();
  if (str.includes('.')) {
    const decimals = str.split('.')[1];
    if (decimals && decimals.length > 2) {
      return { valid: false, message: 'SGPA can have at most 2 decimal places.' };
    }
  }
  return { valid: true };
}

/**
 * Validates percentage (0-100).
 */
function validatePercentage(value) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const n = parseFloat(String(value));
  if (Number.isNaN(n) || n < 0 || n > 100) {
    return { valid: false, message: 'Percentage must be between 0 and 100.' };
  }
  return { valid: true };
}

/**
 * Validates gap duration (0-99 months).
 */
function validateGapDuration(value, fieldName = 'Gap duration') {
  if (value === null || value === undefined || value === '') return { valid: true };
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 0 || n > 99) {
    return { valid: false, message: `${fieldName} must be between 0 and 99 months.` };
  }
  return { valid: true };
}

/**
 * Validates non-negative integer (0-99).
 */
function validateNonNegativeInt(value, fieldName = 'Value', maxVal = null) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 0) {
    return { valid: false, message: `${fieldName} must be 0 or greater.` };
  }
  if (maxVal !== null && n > maxVal) {
    return { valid: false, message: `${fieldName} cannot exceed ${maxVal}.` };
  }
  return { valid: true };
}

/**
 * Validates positive integer (> 0).
 */
function validatePositiveInt(value, fieldName = 'Value') {
  if (value === null || value === undefined || value === '') return { valid: true };
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 1) {
    return { valid: false, message: `${fieldName} must be 1 or greater.` };
  }
  return { valid: true };
}

/**
 * Validates full name (letters, spaces, hyphens, apostrophes only - no numbers).
 * @param {string} value
 * @param {string} fieldName
 * @returns {ValidationResult}
 */
function validateFullName(value, fieldName = 'Full name') {
  if (!value || typeof value !== 'string') {
    return { valid: false, message: `${fieldName} is required.` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, message: `${fieldName} is required.` };
  }
  if (trimmed.length < 2) {
    return { valid: false, message: `${fieldName} must be at least 2 characters.` };
  }
  // Check for numbers
  if (/\d/.test(trimmed)) {
    return { valid: false, message: `${fieldName} cannot contain numbers.` };
  }
  // Check for invalid special characters (allow letters, spaces, hyphens, apostrophes, periods)
  if (!/^[a-zA-Z\s'\-\.]+$/.test(trimmed)) {
    return { valid: false, message: `${fieldName} can only contain letters, spaces, hyphens, and apostrophes.` };
  }
  return { valid: true };
}

/**
 * Validates required string (min length).
 */
function validateRequiredString(value, fieldName, minLen = 1) {
  if (!value || typeof value !== 'string') {
    return { valid: false, message: `${fieldName} is required.` };
  }
  if (value.trim().length < minLen) {
    return { valid: false, message: `${fieldName} must be at least ${minLen} character(s).` };
  }
  return { valid: true };
}

/**
 * Validates enum value.
 */
function validateEnum(value, allowed, fieldName = 'Field') {
  if (value === null || value === undefined || value === '') return { valid: true };
  const normalized = String(value).toUpperCase().trim();
  const allowedUpper = allowed.map(a => String(a).toUpperCase());
  if (!allowedUpper.includes(normalized)) {
    return { valid: false, message: `Invalid ${fieldName}. Must be one of: ${allowed.join(', ')}.` };
  }
  return { valid: true };
}

/**
 * Validates education level.
 */
function validateEducationLevel(value) {
  return validateEnum(value, EDUCATION_LEVELS, 'education level');
}

/**
 * Validates result type.
 */
function validateResultType(value) {
  return validateEnum(value, RESULT_TYPES, 'result type');
}

/**
 * Validates visibility.
 */
function validateVisibility(value) {
  return validateEnum(value, VISIBILITY_VALUES, 'visibility');
}

/** Valid blood groups */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * Validates blood group (max 3 characters, must be valid blood type).
 * @param {string} value
 * @returns {ValidationResult}
 */
function validateBloodGroup(value) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const str = String(value).trim().toUpperCase();
  if (str.length > 3) {
    return { valid: false, message: 'Blood group must be at most 3 characters.' };
  }
  if (!BLOOD_GROUPS.includes(str)) {
    return { valid: false, message: 'Please enter a valid blood group (A+, A-, B+, B-, AB+, AB-, O+, O-).' };
  }
  return { valid: true };
}

/**
 * Validates section (single letter A-Z).
 * @param {string} value
 * @returns {ValidationResult}
 */
function validateSection(value) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const str = String(value).trim().toUpperCase();
  if (str.length > 1) {
    return { valid: false, message: 'Section must be a single letter (e.g., A, B, C).' };
  }
  if (!/^[A-Z]$/.test(str)) {
    return { valid: false, message: 'Section must be a single letter (A-Z).' };
  }
  return { valid: true };
}

/**
 * Validates occupation/text fields. Optional; if present must be a string and not purely numeric.
 * @param {string} value
 * @param {string} fieldName
 */
function validateOccupation(value, fieldName = 'Occupation') {
  if (value === null || value === undefined || value === '') return { valid: true };
  if (typeof value !== 'string') return { valid: false, message: `${fieldName} must be text.` };
  const trimmed = value.trim();
  if (!trimmed) return { valid: true };
  if (/^\d+$/.test(trimmed)) return { valid: false, message: `${fieldName} cannot be purely numeric.` };
  if (trimmed.length > 100) return { valid: false, message: `${fieldName} is too long.` };
  return { valid: true };
}

/**
 * Validates URL (http/https) when present. Empty/undefined is valid (optional field).
 * @param {string} value
 * @returns {ValidationResult}
 */
function validateUrl(value) {
  if (value === null || value === undefined || value === '') return { valid: true };
  const str = String(value).trim();
  if (!str) return { valid: true };
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { valid: false, message: 'Please enter a valid URL (http or https).' };
    }
    return { valid: true };
  } catch {
    return { valid: false, message: 'Please enter a valid URL.' };
  }
}

/**
 * Runs multiple validators; returns first failure or { valid: true }.
 * @param {Array<() => ValidationResult>} fns
 * @returns {ValidationResult}
 */
function runValidators(...fns) {
  for (const fn of fns) {
    const r = typeof fn === 'function' ? fn() : fn;
    if (r && !r.valid) return r;
  }
  return { valid: true };
}

module.exports = {
  validateEmail,
  validateCollegeEmail,
  validatePhoneNumber,
  validateCountryCode,
  validateDate,
  validateDateRange,
  validateYear,
  validateSemester,
  validateSgpa,
  validatePercentage,
  validateGapDuration,
  validateNonNegativeInt,
  validatePositiveInt,
  validateFullName,
  validateRequiredString,
  validateEnum,
  validateEducationLevel,
  validateResultType,
  validateVisibility,
  validateBloodGroup,
  validateSection,
  validateOccupation,
  validateUrl,
  runValidators,
  EMAIL_REGEX,
  DATE_REGEX,
  EDUCATION_LEVELS,
  RESULT_TYPES,
  GAP_TYPES,
  VISIBILITY_VALUES,
  BLOOD_GROUPS,
};
