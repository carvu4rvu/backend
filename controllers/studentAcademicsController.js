const pool = require('../config/db');

// Grade → grade_points mapping based on 10-point scale
const GRADE_POINTS_MAP = {
  O: 10,
  'A+': 9,
  A: 8,
  B: 7,
  C: 6,
  P: 5,
  F: 0,
};

function normalizeGrade(gradeRaw) {
  if (!gradeRaw) return null;
  const g = String(gradeRaw).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS_MAP, g) ? g : null;
}

function computeSgpaFromCourses(courses = []) {
  let totalCredits = 0;
  let weighted = 0;

  for (const c of courses) {
    const credits = Number(c.credits) || 0;
    const gp = Number(c.grade_points);
    if (!credits || Number.isNaN(gp)) continue;
    totalCredits += credits;
    weighted += credits * gp;
  }

  if (!totalCredits) return { sgpa: null, totalCredits: 0, earnedCredits: 0, activeBacklogs: 0 };

  const sgpa = parseFloat((weighted / totalCredits).toFixed(2));
  const earnedCredits = courses.reduce(
    (sum, c) => sum + ((normalizeGrade(c.grade) === 'F' ? 0 : Number(c.credits) || 0)),
    0
  );
  const activeBacklogs = courses.reduce(
    (sum, c) => sum + (normalizeGrade(c.grade) === 'F' ? 1 : 0),
    0
  );

  return { sgpa, totalCredits, earnedCredits, activeBacklogs };
}

async function recomputeCgpaForStudent(client, usn) {
  const { rows } = await client.query(
    `
      SELECT c.credits, c.grade_points
      FROM public.student_course_wise_academics c
      JOIN public.student_semester_records s
        ON c.semester_record_id = s.id
      WHERE s.usn = $1
    `,
    [usn]
  );

  if (!rows.length) {
    await client.query(
      `UPDATE public.student_semester_records SET cgpa = NULL WHERE usn = $1`,
      [usn]
    );
    return null;
  }

  const { sgpa: cgpa } = computeSgpaFromCourses(rows);
  await client.query(
    `UPDATE public.student_semester_records SET cgpa = $2 WHERE usn = $1`,
    [usn, cgpa]
  );
  return cgpa;
}

/**
 * GET /student/profile/:usn/academic-semesters
 * Returns all semester records for a student with nested course lists.
 */
exports.getAcademicSemesters = async (req, res) => {
  const client = await pool.connect();
  try {
    const { usn } = req.params;
    if (!usn) {
      return res.status(400).json({ error: 'USN is required.' });
    }

    const semResult = await client.query(
      `
        SELECT id,
               usn,
               academic_year,
               semester,
               result_file,
               sgpa,
               cgpa,
               total_credits,
               earned_credits,
               cleared_backlogs,
               active_backlogs
        FROM public.student_semester_records
        WHERE usn = $1
        ORDER BY academic_year ASC, semester ASC, id ASC
      `,
      [usn.toUpperCase()]
    );

    const semesters = semResult.rows;
    if (!semesters.length) {
      return res.json({ semesters: [] });
    }

    const ids = semesters.map((s) => s.id);
    const courseResult = await client.query(
      `
        SELECT semester_record_id,
               course_code,
               course_title,
               credits,
               grade,
               grade_points,
               attempt_number,
               is_backlog,
               is_cleared,
               remarks
        FROM public.student_course_wise_academics
        WHERE semester_record_id = ANY($1::bigint[])
        ORDER BY semester_record_id ASC, course_code ASC
      `,
      [ids]
    );

    const coursesBySemId = courseResult.rows.reduce((acc, row) => {
      if (!acc[row.semester_record_id]) acc[row.semester_record_id] = [];
      acc[row.semester_record_id].push(row);
      return acc;
    }, {});

    const withCourses = semesters.map((s) => ({
      ...s,
      courses: coursesBySemId[s.id] || [],
    }));

    return res.json({ semesters: withCourses });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('getAcademicSemesters error:', error);
    return res.status(500).json({ error: 'Failed to fetch academic semesters.' });
  } finally {
    client.release();
  }
};

/**
 * POST /student/profile/:usn/academic-semesters
 * Creates or updates a single semester with course-wise details.
 * Body:
 * {
 *   academic_year: number,
 *   semester: number,
 *   courses: [{ course_code, course_title, credits, grade, grade_points? }]
 * }
 */
exports.upsertAcademicSemester = async (req, res) => {
  const client = await pool.connect();
  try {
    const { usn } = req.params;
    const { academic_year, semester, courses, result_file: resultFileFromBody } = req.body || {};

    if (!usn) {
      return res.status(400).json({ error: 'USN is required.' });
    }
    const year = parseInt(academic_year, 10);
    const sem = parseInt(semester, 10);

    if (!year || !Number.isFinite(year)) {
      return res.status(400).json({ error: 'Valid academic_year is required.' });
    }
    if (!sem || !Number.isFinite(sem) || sem < 1 || sem > 8) {
      return res.status(400).json({ error: 'Valid semester (1-8) is required.' });
    }
    if (!Array.isArray(courses) || courses.length === 0) {
      return res
        .status(400)
        .json({ error: 'At least one course is required.' });
    }
    const resultFileValue = typeof resultFileFromBody === 'string' && resultFileFromBody.trim()
      ? resultFileFromBody.trim()
      : null;

    // Basic normalization & validation of courses
    const normalizedCourses = [];
    const seenCodes = new Set();
    for (const raw of courses) {
      if (!raw) continue;
      const code = String(raw.course_code || '').trim().toUpperCase();
      const title = String(raw.course_title || '').trim();
      const creditsNum = Number(raw.credits);
      let normalizedGrade = normalizeGrade(raw.grade);
      let gradePoints = raw.grade_points != null ? Number(raw.grade_points) : null;

      if (!code || !title || !creditsNum || Number.isNaN(creditsNum) || creditsNum <= 0) {
        return res.status(400).json({
          error:
            'Each course must have course_code, course_title and positive credits.',
        });
      }

      if (seenCodes.has(code)) {
        return res.status(400).json({
          error: 'Duplicate course code found for this semester. Each course must be unique.',
          detail: { course_code: code },
        });
      }
      seenCodes.add(code);

      // Derive grade from points or points from grade if one of them is missing
      if (!normalizedGrade && gradePoints != null && !Number.isNaN(gradePoints)) {
        const matchGrade = Object.entries(GRADE_POINTS_MAP).find(
          ([, pts]) => Number(pts) === gradePoints
        );
        if (matchGrade) {
          normalizedGrade = matchGrade[0];
        }
      }

      if (gradePoints == null || Number.isNaN(gradePoints)) {
        if (normalizedGrade) {
          gradePoints = GRADE_POINTS_MAP[normalizedGrade];
        }
      }

      if (!normalizedGrade || gradePoints == null || Number.isNaN(gradePoints)) {
        return res.status(400).json({
          error:
            'Each course must have valid grade points (0, 5, 6, 7, 8, 9, 10) or a valid grade (O, A+, A, B, C, P, F).',
        });
      }

      normalizedCourses.push({
        course_code: code,
        course_title: title,
        credits: creditsNum,
        grade: normalizedGrade,
        grade_points: gradePoints,
      });
    }

    if (!normalizedCourses.length) {
      return res
        .status(400)
        .json({ error: 'No valid courses provided.' });
    }

    await client.query('BEGIN');

    // Ensure student exists (optional but safer)
    const studentResult = await client.query(
      `
        SELECT usn
        FROM public.student_basic_details
        WHERE usn = $1
      `,
      [usn.toUpperCase()]
    );
    if (studentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No student found with the given USN in database.',
      });
    }

    const {
      sgpa,
      totalCredits,
      earnedCredits,
      activeBacklogs,
    } = computeSgpaFromCourses(normalizedCourses);

    // Find existing semester record for this usn/year/sem. Upsert: update if exists, insert if not.
    const existingSem = await client.query(
      `
        SELECT id, result_file
        FROM public.student_semester_records
        WHERE usn = $1 AND academic_year = $2 AND semester = $3
        LIMIT 1
      `,
      [usn.toUpperCase(), year, sem]
    );

    const isUpdate = existingSem.rowCount > 0;
    if (!isUpdate && !resultFileValue) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(400).json({
        error: 'Result marksheet image is required for new semester. Please upload the semester result / marksheet image.',
      });
    }

    let semesterRecordId;
    const resultFileToSet = resultFileValue || (isUpdate ? existingSem.rows[0].result_file : null);

    if (isUpdate) {
      semesterRecordId = existingSem.rows[0].id;
      await client.query(
        `
          UPDATE public.student_semester_records
          SET result_file = $2,
              sgpa = $3,
              total_credits = $4,
              earned_credits = $5,
              active_backlogs = $6,
              updated_at = now()
          WHERE id = $1
        `,
        [
          semesterRecordId,
          resultFileToSet,
          sgpa,
          totalCredits,
          earnedCredits,
          activeBacklogs,
        ]
      );
    } else {
      const insertSem = await client.query(
        `
          INSERT INTO public.student_semester_records (
            usn,
            academic_year,
            semester,
            result_file,
            sgpa,
            total_credits,
            earned_credits,
            active_backlogs,
            cleared_backlogs
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
          RETURNING id
        `,
        [
          usn.toUpperCase(),
          year,
          sem,
          resultFileToSet,
          sgpa,
          totalCredits,
          earnedCredits,
          activeBacklogs,
        ]
      );
      semesterRecordId = insertSem.rows[0].id;
    }

    // Replace course-wise rows for this semester
    await client.query(
      `DELETE FROM public.student_course_wise_academics WHERE semester_record_id = $1`,
      [semesterRecordId]
    );

    const courseInsertText = `
      INSERT INTO public.student_course_wise_academics (
        semester_record_id,
        course_code,
        course_title,
        credits,
        grade,
        grade_points,
        attempt_number,
        is_backlog,
        is_cleared
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `;

    for (const c of normalizedCourses) {
      const isFailed = normalizeGrade(c.grade) === 'F';
      await client.query(courseInsertText, [
        semesterRecordId,
        c.course_code,
        c.course_title,
        c.credits,
        c.grade,
        c.grade_points,
        1,
        isFailed,
        !isFailed,
      ]);
    }

    const cgpa = await recomputeCgpaForStudent(client, usn.toUpperCase());

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Semester saved successfully.',
      semester_record_id: semesterRecordId,
      sgpa,
      cgpa,
      total_credits: totalCredits,
      earned_credits: earnedCredits,
      active_backlogs: activeBacklogs,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // eslint-disable-next-line no-console
    console.error('upsertAcademicSemester error:', error);
    return res.status(500).json({ error: 'Failed to save semester.' });
  } finally {
    client.release();
  }
};

