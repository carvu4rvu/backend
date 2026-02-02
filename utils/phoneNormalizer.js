/**
 * Normalizes phone input. Enforces exactly 10 digits for phone_number (student_basic_details).
 * DB constraint: phone_number must be exactly 10 digits when provided.
 */

const PHONE_LENGTH = 10;
const DIGITS_ONLY = /[0-9]/g;
const WITH_COUNTRY_CODE = /^(\+?)([0-9]{1,4})[\s-]+([0-9\s-]+)$/;

/** Returns true if s is exactly 10 digits. */
function isValidPhoneNumber(s) {
  if (!s || typeof s !== 'string') return false;
  const digits = (s.match(DIGITS_ONLY) || []).join('');
  return digits.length === PHONE_LENGTH;
}

/**
 * Parses combined input like "+91 8792160487". Returns phone_number only when exactly 10 digits.
 */
function parsePhoneCombined(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { phone_country_code: null, phone_number: null };

  const match = WITH_COUNTRY_CODE.exec(s);
  if (match) {
    const rest = (match[3].match(DIGITS_ONLY) || []).join('');
    if (rest.length === PHONE_LENGTH) {
      return {
        phone_country_code: `+${match[2]}`,
        phone_number: rest,
      };
    }
    return { phone_country_code: null, phone_number: null };
  }

  const digitsOnly = (s.match(DIGITS_ONLY) || []).join('');
  if (digitsOnly.length === PHONE_LENGTH) {
    return { phone_country_code: null, phone_number: digitsOnly };
  }
  return { phone_country_code: null, phone_number: null };
}

/**
 * Normalizes phone_country_code and phone_number for DB.
 * Returns phone_number only when exactly 10 digits; otherwise undefined (invalid).
 */
function normalizePhoneForDb(phone_country_code, phone_number) {
  const codeIn = typeof phone_country_code === 'string' ? phone_country_code.trim() : '';
  const numIn = typeof phone_number === 'string' ? phone_number.trim() : '';

  if (!numIn && !codeIn) return { phone_country_code: undefined, phone_number: undefined };

  if (numIn && /^\+?[0-9]{1,4}[\s-]/.test(numIn)) {
    const parsed = parsePhoneCombined(numIn);
    if (parsed.phone_number) {
      return {
        phone_country_code: parsed.phone_country_code ?? undefined,
        phone_number: parsed.phone_number,
      };
    }
    return { phone_country_code: undefined, phone_number: undefined };
  }

  const digitsOnly = (numIn.match(DIGITS_ONLY) || []).join('');
  const code = codeIn ? (codeIn.startsWith('+') ? codeIn : `+${codeIn}`) : undefined;
  if (digitsOnly.length !== PHONE_LENGTH) {
    return { phone_country_code: code || undefined, phone_number: undefined };
  }
  return {
    phone_country_code: code || undefined,
    phone_number: digitsOnly,
  };
}

module.exports = { normalizePhoneForDb, parsePhoneCombined, isValidPhoneNumber, PHONE_LENGTH };
