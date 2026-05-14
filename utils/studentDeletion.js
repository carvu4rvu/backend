const pool = require('../config/db');

/**
 * Thoroughly deletes students and all their associated data based on a criteria.
 * @param {object} client - The database client (from pool.connect())
 * @param {string} criteriaQuery - The WHERE clause for student_basic_details (e.g., "school_id = $1")
 * @param {any[]} params - The parameters for the criteria query
 */
async function deleteStudentsByCriteria(client, criteriaQuery, params) {
  // 1. Get all USNs matching the criteria
  const usnRes = await client.query(
    `SELECT usn FROM student_basic_details WHERE ${criteriaQuery}`,
    params
  );
  const usns = usnRes.rows.map(r => r.usn);
  if (usns.length === 0) return;

  // 2. Delete from child tables that reference USN or semester_record_id
  
  // Delete course-wise academics (references semester records)
  await client.query(`
    DELETE FROM student_course_wise_academics 
    WHERE semester_record_id IN (
      SELECT id FROM student_semester_records WHERE usn = ANY($1)
    )
  `, [usns]);

  const tablesToDeleteByUsn = [
    'student_semester_records',
    'student_placement_process',
    'offers',
    'student_projects',
    'student_internships',
    'student_trainings',
    'student_certifications',
    'student_publications',
    'student_extra_curricular_activities',
    'student_other_experiences',
    'student_parent_details',
    'semester_unlock_requests',
    'notifications',
    'notification_nodes',
    'student_education_gaps',
    'student_education_history',
    'student_disciplinary_records',
    'student_placement_violations',
    'student_profile_details',
    'student_edit_control',
    'alumni_conversion_log'
  ];

  for (const table of tablesToDeleteByUsn) {
    // Check if table exists first to avoid errors if schema changes
    try {
      await client.query(`DELETE FROM ${table} WHERE usn = ANY($1)`, [usns]);
    } catch (e) {
      console.warn(`Could not delete from ${table}: ${e.message}`);
    }
  }

  // Delete project-related data
  const projectRes = await client.query('SELECT id FROM projects WHERE usn = ANY($1)', [usns]);
  const projectIds = projectRes.rows.map(r => r.id);
  if (projectIds.length > 0) {
    const projectChildTables = [
      'project_likes', 'project_favorites', 'project_views', 'project_reviews',
      'project_share_links', 'project_assets', 'project_asset_variants', 'project_metrics'
    ];
    for (const table of projectChildTables) {
      await client.query(`DELETE FROM ${table} WHERE project_id = ANY($1)`, [projectIds]);
    }
    await client.query('DELETE FROM projects WHERE id = ANY($1)', [projectIds]);
  }

  // 3. Delete from user_login
  await client.query('DELETE FROM user_login WHERE usn = ANY($1)', [usns]);

  // 4. Delete from student_basic_details
  await client.query('DELETE FROM student_basic_details WHERE usn = ANY($1)', [usns]);
}

module.exports = { deleteStudentsByCriteria };
