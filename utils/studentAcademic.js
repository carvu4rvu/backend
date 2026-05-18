/**
 * Compute current_year and current_semester from year_of_joining.
 * Academic cycle:
 * - First Semester starts in the second half (July - Dec).
 * - Odd Semesters (1, 3, 5, 7): July to December.
 * - Even Semesters (2, 4, 6, 8): January to June.
 *
 * Example:
 * Joined 2023:
 * - July 2023 - Dec 2023: Year 1, Sem 1 (Odd)
 * - Jan 2024 - June 2024: Year 1, Sem 2 (Even)
 * - July 2024 - Dec 2024: Year 2, Sem 3 (Odd)
 * - Jan 2025 - June 2025: Year 2, Sem 4 (Even)
 * - July 2025 - Dec 2025: Year 3, Sem 5 (Odd) <-- Current status as of May 2026 (Wait, if May 2026, it should be Sem 6)
 *
 * @param {number} yearOfJoining - Year student joined (e.g. 2023)
 * @param {number} [programDuration=4] - Max years (e.g. 4 for UG, 2 for PG)
 * @returns {{ current_year: number, current_semester: number }}
 */
function computeCurrentYearSemester(yearOfJoining, programDuration = 4) {
  if (yearOfJoining == null || Number.isNaN(Number(yearOfJoining))) {
    return { current_year: 1, current_semester: 1 };
  }
  const yoj = Number(yearOfJoining);
  const duration = Math.max(1, Math.min(6, Number(programDuration) || 4));
  
  // Use today's date from environment: 2026-05-14
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Number of years passed since joining
  // If we are in the first half of the year (Jan-Jun), we are in the second half of the academic year
  // If we are in the second half (Jul-Dec), we are in the first half of a new academic year
  
  let yearsPassed = currentYear - yoj;
  let current_semester;

  if (currentMonth >= 7) {
    // July to December: New academic year starts (Odd sem)
    // Semesters: 1, 3, 5, 7...
    current_semester = (yearsPassed * 2) + 1;
  } else {
    // January to June: Second half of academic year (Even sem)
    // Semesters: 2, 4, 6, 8...
    current_semester = (yearsPassed * 2);
  }

  // Ensure current_year aligns with the semester (1-2 -> Year 1, 3-4 -> Year 2, etc.)
  let current_year = Math.ceil(current_semester / 2);

  // Cap at duration
  const maxSem = duration * 2;
  if (current_semester > maxSem) {
    current_semester = maxSem;
    current_year = duration;
  }
  if (current_semester < 1) {
    current_semester = 1;
    current_year = 1;
  }

  return { current_year, current_semester };
}

module.exports = { computeCurrentYearSemester };
