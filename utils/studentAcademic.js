/**
 * Compute current_year and current_semester from year_of_joining.
 * Academic year: July–June (July = start of next academic year).
 * current_year = academic year number (1, 2, 3, 4 for UG; 1, 2 for PG).
 * current_semester = 2 per year (Jan–Jun = sem 1 of year, Jul–Dec = sem 2).
 *
 * @param {number} yearOfJoining - Year student joined (e.g. 2022)
 * @param {number} [programDuration=4] - Max years (e.g. 4 for UG, 2 for PG)
 * @returns {{ current_year: number, current_semester: number }}
 */
function computeCurrentYearSemester(yearOfJoining, programDuration = 4) {
  if (yearOfJoining == null || Number.isNaN(Number(yearOfJoining))) {
    return { current_year: 1, current_semester: 1 };
  }
  const yoj = Number(yearOfJoining);
  const duration = Math.max(1, Math.min(6, Number(programDuration) || 4));
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Academic year end: if Jul–Dec we're in year X-(X+1), so "academic year" = currentYear+1; else currentYear
  const academicYearEnd = currentMonth >= 7 ? currentYear + 1 : currentYear;
  let current_year = Math.max(1, Math.min(duration, academicYearEnd - yoj));

  // Semester: 2 per year. Jan–Jun = 1st sem of year, Jul–Dec = 2nd sem
  const semInYear = currentMonth >= 7 ? 2 : 1;
  let current_semester = (current_year - 1) * 2 + semInYear;
  const maxSem = duration * 2;
  current_semester = Math.max(1, Math.min(maxSem, current_semester));

  return { current_year, current_semester };
}

module.exports = { computeCurrentYearSemester };
