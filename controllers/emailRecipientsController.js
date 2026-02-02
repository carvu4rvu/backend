const supabase = require('../config/supabaseClient');
const pool = require('../config/db');

/**
 * GET /api/placement/email-recipients
 * Query: category (students|parents|alumni|staff), plus category-specific filters.
 * Returns: { recipients: [{ id, name, email, category, ... }], total, page, limit, roles? }
 */

function toRecipient(row, category, extra = {}) {
  const base = { category, ...extra };
  if (category === 'students') {
    const email = row.college_email || row.personal_email || null;
    return { id: row.usn, name: row.full_name, email, emailType: row.college_email ? 'college' : 'personal', ...base };
  }
  if (category === 'parents') {
    return { id: `parent_${row.id}`, name: row.name, email: row.email || null, studentUsn: row.usn, ...base };
  }
  if (category === 'alumni') {
    return { id: `alumni_${row.id}`, name: row.full_name, email: row.personal_email || null, ...base };
  }
  if (category === 'staff') {
    return { id: `staff_${row.id}`, name: row.email_id || row.usn || `User ${row.id}`, email: row.email_id || null, role_name: row.role_name, ...base };
  }
  return base;
}

exports.getEmailRecipients = async (req, res) => {
  try {
    const category = (req.query.category || 'students').toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    if (!['students', 'parents', 'alumni', 'staff'].includes(category)) {
      return res.status(400).json({ message: 'Invalid category. Use students|parents|alumni|staff' });
    }

    if (category === 'students') {
      const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
      const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;
      const majorId = req.query.major_id ? parseInt(req.query.major_id, 10) : null;
      const minorId = req.query.minor_id ? parseInt(req.query.minor_id, 10) : null;
      const specializationId = req.query.specialization_id ? parseInt(req.query.specialization_id, 10) : null;
      const yearOfJoining = req.query.year_of_joining ? parseInt(req.query.year_of_joining, 10) : null;
      const currentYear = req.query.current_year ? parseInt(req.query.current_year, 10) : null;
      const currentSemester = req.query.current_semester ? parseInt(req.query.current_semester, 10) : null;
      const section = (req.query.section || '').trim() || null;
      const gender = (req.query.gender || '').trim() || null;
      const isActive = req.query.is_active;
      const isRegistered = req.query.is_registered;

      const selectFields = `usn, full_name, college_email, personal_email, school_id, program_id, major_id, minor_id, specialization_id, year_of_joining, current_year, current_semester, section, gender, is_active, is_registered, schools ( id, name, abbreviation ), programs ( id, name ), majors ( id, name ), minors ( id, name ), specializations ( id, name )`;
      let query = supabase
        .from('student_basic_details')
        .select(selectFields, { count: 'exact' });

      if (schoolId != null && !Number.isNaN(schoolId)) query = query.eq('school_id', schoolId);
      if (programId != null && !Number.isNaN(programId)) query = query.eq('program_id', programId);
      if (majorId != null && !Number.isNaN(majorId)) query = query.eq('major_id', majorId);
      if (minorId != null && !Number.isNaN(minorId)) query = query.eq('minor_id', minorId);
      if (specializationId != null && !Number.isNaN(specializationId)) query = query.eq('specialization_id', specializationId);
      if (yearOfJoining != null && !Number.isNaN(yearOfJoining)) query = query.eq('year_of_joining', yearOfJoining);
      if (currentYear != null && !Number.isNaN(currentYear)) query = query.eq('current_year', currentYear);
      if (currentSemester != null && !Number.isNaN(currentSemester)) query = query.eq('current_semester', currentSemester);
      if (section) query = query.eq('section', section);
      if (gender) query = query.eq('gender', gender);
      if (isActive !== undefined && isActive !== '') query = query.eq('is_active', isActive === 'true' || isActive === '1');
      if (isRegistered !== undefined && isRegistered !== '') query = query.eq('is_registered', isRegistered === 'true' || isRegistered === '1');
      if (search) query = query.or(`usn.ilike.%${search}%,full_name.ilike.%${search}%,college_email.ilike.%${search}%,personal_email.ilike.%${search}%`);

      query = query.order('full_name', { ascending: true }).range(offset, offset + limit - 1);
      const { data: rows, error, count } = await query;
      if (error) throw error;

      const recipients = (rows || []).map((r) => toRecipient(r, 'students')).filter((r) => r.email);
      const total = count != null ? count : recipients.length;
      return res.json({ recipients, total, page, limit, totalPages: Math.ceil((total || 0) / limit) });
    }

    if (category === 'parents') {
      const parentType = (req.query.parent_type || '').trim() || null;
      const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
      const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;

      let parentQuery = supabase
        .from('student_parent_details')
        .select('id, usn, parent_type, name, email, phone_number', { count: 'exact' });

      if (parentType) parentQuery = parentQuery.eq('parent_type', parentType);
      if (search) parentQuery = parentQuery.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

      const { data: parentRows, error: parentErr } = await parentQuery;
      if (parentErr) throw parentErr;

      let list = parentRows || [];
      if (schoolId != null && !Number.isNaN(schoolId)) {
        const { data: studentsInSchool } = await supabase.from('student_basic_details').select('usn').eq('school_id', schoolId);
        const usns = new Set((studentsInSchool || []).map((s) => s.usn));
        list = list.filter((p) => usns.has(p.usn));
      }
      if (programId != null && !Number.isNaN(programId)) {
        const { data: studentsInProgram } = await supabase.from('student_basic_details').select('usn').eq('program_id', programId);
        const usns = new Set((studentsInProgram || []).map((s) => s.usn));
        list = list.filter((p) => usns.has(p.usn));
      }

      const total = list.length;
      const paginated = list.slice(offset, offset + limit);
      const recipients = paginated.map((r) => toRecipient(r, 'parents')).filter((r) => r.email);
      return res.json({ recipients, total, page, limit, totalPages: Math.ceil((total || 0) / limit) });
    }

    if (category === 'alumni') {
      const graduationYear = req.query.graduation_year ? parseInt(req.query.graduation_year, 10) : null;
      const institutionName = (req.query.institution_name || '').trim() || null;

      let query = supabase
        .from('alumni')
        .select('id, full_name, personal_email, graduation_year, institution_name, student_id', { count: 'exact' });

      if (graduationYear != null && !Number.isNaN(graduationYear)) query = query.eq('graduation_year', graduationYear);
      if (institutionName) query = query.ilike('institution_name', `%${institutionName}%`);
      if (search) query = query.or(`full_name.ilike.%${search}%,personal_email.ilike.%${search}%,institution_name.ilike.%${search}%,student_id.ilike.%${search}%`);

      query = query.order('full_name', { ascending: true }).range(offset, offset + limit - 1);
      const { data: rows, error, count } = await query;
      if (error) throw error;

      const recipients = (rows || []).map((r) => toRecipient(r, 'alumni')).filter((r) => r.email);
      const total = count != null ? count : recipients.length;
      return res.json({ recipients, total, page, limit, totalPages: Math.ceil((total || 0) / limit) });
    }

    if (category === 'staff') {
      const roleId = req.query.role_id ? parseInt(req.query.role_id, 10) : null;
      const isActive = req.query.is_active;

      const where = [];
      const params = [];
      let idx = 1;
      if (roleId != null && !Number.isNaN(roleId)) {
        where.push(`ul.role_id = $${idx}`);
        params.push(roleId);
        idx++;
      }
      if (isActive !== undefined && isActive !== '') {
        where.push(`ul.is_active = $${idx}`);
        params.push(isActive === 'true' || isActive === '1');
        idx++;
      }
      if (search) {
        where.push(`(ul.usn ILIKE $${idx} OR ul.email_id ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM user_login ul JOIN roles r ON r.id = ul.role_id ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total ?? 0;

      params.push(limit, offset);
      const listResult = await pool.query(
        `SELECT ul.id, ul.usn, ul.email_id, ul.is_active, r.name AS role_name
         FROM user_login ul
         JOIN roles r ON r.id = ul.role_id
         ${whereClause}
         ORDER BY ul.email_id
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params
      );
      const rolesResult = await pool.query('SELECT id, name FROM roles ORDER BY name');
      const recipients = (listResult.rows || []).map((r) => toRecipient(r, 'staff')).filter((r) => r.email);
      return res.json({
        recipients,
        total,
        page,
        limit,
        totalPages: Math.ceil((total || 0) / limit),
        roles: rolesResult.rows || [],
      });
    }

    res.json({ recipients: [], total: 0, page: 1, limit, totalPages: 0 });
  } catch (err) {
    console.error('getEmailRecipients error:', err);
    res.status(500).json({ message: err.message || 'Server error fetching email recipients' });
  }
};
