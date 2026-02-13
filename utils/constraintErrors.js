/**
 * Maps database constraint / PostgREST errors to user-friendly messages
 * so students see clear English instead of technical DB errors.
 */

const CONSTRAINT_MESSAGES = {
  // student_basic_details
  student_basic_details_phone_number_check:
    'Please enter a valid phone number (e.g. 1234567890). Use 10 digits only.',
  student_basic_details_phone_country_code_check:
    'Please enter a valid country code (e.g. +91 for India).',
  student_basic_details_college_email_check:
    'Please enter a valid college email address.',
  student_basic_details_personal_email_check:
    'Please enter a valid personal email address.',
  student_basic_details_current_year_check:
    'Year of study must be between 1 and 6.',
  student_basic_details_current_semester_check:
    'Semester must be between 1 and 12.',

  // student_education_history
  student_education_history_education_level_check:
    'Please select a valid education level (10TH, 12TH, DIPLOMA, GRADUATION, etc.).',
  student_education_history_result_type_check:
    'Result type must be PERCENTAGE or CGPA.',
  student_education_history_gap_type_check:
    'Please select a valid gap type.',

  // student_semester_academics
  student_semester_academics_semester_check:
    'Semester must be between 1 and 12.',

  // projects
  projects_visibility_check:
    'Visibility must be PRIVATE, PUBLIC, or PUBLIC_LINK.',

  // student_publications
  student_publications_author_count_check:
    'Author count must be at least 1.',

  // student_certifications (duplicate title + organization)
  student_certifications_title_organization_unique:
    'This certification already exists (same title and organization).',

  // student_disciplinary_records
  student_disciplinary_records_severity_check:
    'Severity must be MINOR, MAJOR, or CRITICAL.',

  // student_placement_violations
  student_placement_violations_penalty_type_check:
    'Penalty type must be WARNING, TEMP_BAN, or PERMANENT_BAN.',

  // programs
  programs_graduation_level_check:
    'Graduation level must be UG or PG.',

  // student_summer_internship
  student_summer_internship_job_role_not_null:
    'Job role is required.',
  student_summer_internship_organization_not_null:
    'Organization is required.',
};

/** PostgreSQL error codes */
const PG_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
};

/**
 * Returns a user-friendly message for known constraint errors, or the original message.
 * @param {object} err - Error from Supabase/PostgREST (has .message, possibly .code, .details)
 * @returns {string} Message safe to show to the user
 */
function getFriendlyMessage(err) {
  if (!err || typeof err.message !== 'string') return 'Something went wrong. Please try again.';
  const msg = err.message;
  const code = err.code;

  // Known constraint name mappings
  for (const [constraint, friendly] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (msg.includes(constraint)) return friendly;
  }

  // PostgreSQL error code mappings
  if (code === PG_CODES.UNIQUE_VIOLATION) {
    if (msg.includes('college_email') || msg.includes('college email')) {
      return 'This college email is already registered.';
    }
    if (msg.includes('usn')) return 'A student with this USN already exists.';
    if (msg.includes('student_certifications') || (msg.includes('title') && msg.includes('organization'))) {
      return CONSTRAINT_MESSAGES.student_certifications_title_organization_unique;
    }
    return 'This record already exists. Please avoid duplicates.';
  }
  if (code === PG_CODES.FOREIGN_KEY_VIOLATION) {
    if (msg.includes('school_id') || msg.includes('program_id')) return 'Invalid school or program selected.';
    if (msg.includes('major_id')) return 'Invalid major selected.';
    if (msg.includes('minor_id')) return 'Invalid minor selected.';
    if (msg.includes('specialization_id')) return 'Invalid specialization selected.';
    return 'Invalid reference. One of the selected options does not exist.';
  }
  if (code === PG_CODES.NOT_NULL_VIOLATION) {
    const col = (err.details || '').match(/column "([^"]+)"/)?.[1] || '';
    if (col) return `Please provide a value for ${col.replace(/_/g, ' ')}.`;
    return 'Required field is missing. Please fill all required fields.';
  }
  if (code === PG_CODES.CHECK_VIOLATION) {
    if (msg.includes('phone')) return CONSTRAINT_MESSAGES.student_basic_details_phone_number_check;
    if (msg.includes('email')) return 'Please enter a valid email address.';
  }

  // Generic check constraint
  if (msg.includes('violates check constraint')) {
    if (msg.includes('phone')) return CONSTRAINT_MESSAGES.student_basic_details_phone_number_check;
    if (msg.includes('email')) return 'Please enter a valid email address.';
  }

  // Invalid date (PostgreSQL date type expects YYYY-MM-DD)
  if (msg.includes('invalid input syntax for type date') || msg.includes('date/time field value out of range')) {
    return 'Please enter a valid date. Use the date picker or format YYYY-MM-DD (e.g. 2024-01-15). Year must be 4 digits.';
  }

  // Array/numeric parsing
  if (msg.includes('invalid input syntax for type')) {
    return 'Please enter a valid number or format.';
  }

  return msg;
}

module.exports = { getFriendlyMessage, CONSTRAINT_MESSAGES, PG_CODES };
