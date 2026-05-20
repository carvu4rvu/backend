const pool = require('../config/db');

let savepointSeq = 0;

/**
 * Run a delete inside a SAVEPOINT so a missing table / optional FK does not abort the whole transaction.
 */
async function safeDelete(client, sql, params) {
  const name = `sp_del_${++savepointSeq}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    console.warn(`[studentDeletion] ${e.message}`);
  }
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function deleteFromTableByUsn(client, table, usns) {
  if (!(await tableExists(client, table))) return;
  await safeDelete(client, `DELETE FROM ${table} WHERE usn = ANY($1)`, [usns]);
}

async function deleteProjectsForUsns(client, usns) {
  if (!(await tableExists(client, 'projects'))) return;

  const { rows } = await client.query('SELECT id FROM projects WHERE owner_usn = ANY($1)', [usns]);
  const projectIds = rows.map((r) => r.id);
  if (!projectIds.length) return;

  await safeDelete(
    client,
    'DELETE FROM project_asset_variants WHERE asset_id IN (SELECT id FROM project_assets WHERE project_id = ANY($1))',
    [projectIds]
  );
  await safeDelete(client, 'DELETE FROM project_assets WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_favorites WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_likes WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_reviews WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_share_links WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_views WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM project_metrics WHERE project_id = ANY($1)', [projectIds]);
  await safeDelete(client, 'DELETE FROM projects WHERE id = ANY($1)', [projectIds]);
}

async function deleteAlumniForUsns(client, usns) {
  if (!(await tableExists(client, 'alumni'))) return;

  const { rows } = await client.query(
    'SELECT id, personal_email FROM alumni WHERE student_id = ANY($1)',
    [usns]
  );
  if (!rows.length) return;

  const alumniIds = rows.map((r) => r.id);
  await safeDelete(client, 'DELETE FROM hr_recommendations WHERE alumni_id = ANY($1)', [alumniIds]);
  await safeDelete(client, 'DELETE FROM alumni WHERE student_id = ANY($1)', [usns]);

  const roleRes = await client.query("SELECT id FROM roles WHERE name = 'alumni'");
  const alumniRoleId = roleRes.rows[0]?.id;
  if (!alumniRoleId) return;

  const emails = [...new Set(
    rows
      .map((r) => r.personal_email)
      .filter(Boolean)
      .map((e) => String(e).trim().toLowerCase())
  )];
  if (emails.length) {
    await safeDelete(
      client,
      'DELETE FROM user_login WHERE role_id = $1 AND lower(email_id) = ANY($2::text[])',
      [alumniRoleId, emails]
    );
  }
}

async function deletePlacementDataForUsns(client, usns) {
  await safeDelete(client, 'DELETE FROM offers WHERE student_id = ANY($1)', [usns]);
  await safeDelete(client, 'DELETE FROM placement WHERE student_id = ANY($1)', [usns]);
  await deleteFromTableByUsn(client, 'capstone', usns);
}

async function deleteNotificationNodesForUsns(client, usns) {
  const { rows } = await client.query('SELECT id FROM user_login WHERE usn = ANY($1)', [usns]);
  const userIds = rows.map((r) => r.id);
  if (!userIds.length) return;
  if (!(await tableExists(client, 'notification_nodes'))) return;
  await safeDelete(client, 'DELETE FROM notification_nodes WHERE user_id = ANY($1)', [userIds]);
}

/**
 * Delete all records for the given USNs across student-related tables.
 */
async function deleteStudentsByUsns(client, usns) {
  if (!usns.length) return;

  await deletePlacementDataForUsns(client, usns);
  await deleteAlumniForUsns(client, usns);
  await deleteProjectsForUsns(client, usns);

  if (await tableExists(client, 'student_course_wise_academics')) {
    await safeDelete(
      client,
      `DELETE FROM student_course_wise_academics
       WHERE semester_record_id IN (
         SELECT id FROM student_semester_records WHERE usn = ANY($1)
       )`,
      [usns]
    );
  }

  const tablesToDeleteByUsn = [
    'student_semester_records',
    'student_semester_academics',
    'student_placement_process',
    'student_internships',
    'student_trainings',
    'student_certifications',
    'student_publications',
    'student_extra_curricular_activities',
    'student_other_experiences',
    'student_parent_details',
    'student_summer_immersion',
    'student_summer_internship',
    'semester_unlock_requests',
    'student_education_gaps',
    'student_education_history',
    'student_disciplinary_records',
    'student_placement_violations',
    'student_profile_details',
    'student_edit_control',
    'alumni_conversion_log',
    'student_projects',
    'notifications',
  ];

  for (const table of tablesToDeleteByUsn) {
    await deleteFromTableByUsn(client, table, usns);
  }

  await deleteNotificationNodesForUsns(client, usns);
  await client.query('DELETE FROM user_login WHERE usn = ANY($1)', [usns]);
  await client.query('DELETE FROM student_basic_details WHERE usn = ANY($1)', [usns]);
}

/**
 * Thoroughly deletes students and all their associated data based on a criteria.
 * @param {object} client - The database client (from pool.connect())
 * @param {string} criteriaQuery - The WHERE clause for student_basic_details (e.g., "school_id = $1")
 * @param {any[]} params - The parameters for the criteria query
 */
async function deleteStudentsByCriteria(client, criteriaQuery, params) {
  const usnRes = await client.query(
    `SELECT usn FROM student_basic_details WHERE ${criteriaQuery}`,
    params
  );
  const usns = usnRes.rows.map((r) => r.usn);
  await deleteStudentsByUsns(client, usns);
}

/**
 * Delete a single student and all related records.
 * @throws Error with statusCode 404 when student not found
 */
async function deleteStudentByUsn(client, usn) {
  const normalized = String(usn || '').trim().toUpperCase();
  if (!normalized) {
    const err = new Error('USN is required');
    err.statusCode = 400;
    throw err;
  }

  const check = await client.query('SELECT usn FROM student_basic_details WHERE usn = $1', [normalized]);
  if (!check.rows.length) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  await deleteStudentsByUsns(client, [normalized]);
  return { usn: normalized };
}

module.exports = { deleteStudentsByCriteria, deleteStudentByUsn };
