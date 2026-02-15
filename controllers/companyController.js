const supabase = require('../config/supabaseClient');
const pool = require('../config/db');
const logger = require('../utils/logger');

/**
 * Helper: Get company_id from authenticated user (uses pool = same DB as auth).
 * user_login has company_id linked to companies.id
 */
async function getCompanyIdFromUser(req) {
  const userId = req.user?.id ?? req.user?.user_id;
  if (!userId) return null;

  try {
    const result = await pool.query(
      'SELECT company_id FROM user_login WHERE id = $1',
      [userId]
    );
    const row = result.rows[0];
    const raw = row?.company_id;
    return raw != null ? Number(raw) : null;
  } catch (err) {
    logger.warn('getCompanyIdFromUser error:', err?.message);
    return null;
  }
}

// ============== PROFILE ==============

/**
 * GET /company/profile
 * Get my company profile
 */
exports.getMyProfile = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    logger.error('getMyProfile error:', err);
    res.status(500).json({ error: 'Failed to fetch company profile' });
  }
};

/**
 * PATCH /company/profile
 * Update company profile (limited fields)
 */
exports.updateProfile = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { description, website, linkedin, address, company_logo_link } = req.body;

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    // Only allow updating specific fields
    if (description !== undefined) updateData.description = description;
    if (website !== undefined) updateData.website = website;
    if (linkedin !== undefined) updateData.linkedin = linkedin;
    if (address !== undefined) updateData.address = address;
    if (company_logo_link !== undefined) updateData.company_logo_link = company_logo_link;

    const { data, error } = await supabase
      .from('companies')
      .update(updateData)
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ data, message: 'Profile updated successfully' });
  } catch (err) {
    logger.error('updateProfile error:', err);
    res.status(500).json({ error: 'Failed to update company profile' });
  }
};

// ============== CONTACTS ==============

/**
 * GET /company/contacts
 * Get all contacts for my company
 */
exports.getContacts = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    logger.error('getContacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
};

/**
 * POST /company/contacts
 * Add a new contact
 */
exports.addContact = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { contact_name, email, phone_number, role_title, remarks } = req.body;

    if (!contact_name) {
      return res.status(400).json({ error: 'Contact name is required' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        company_id: companyId,
        contact_name,
        email: email || null,
        phone_number: phone_number || null,
        role_title: role_title || null,
        remarks: remarks || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ data, message: 'Contact added successfully' });
  } catch (err) {
    logger.error('addContact error:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
};

/**
 * PATCH /company/contacts/:id
 * Update a contact
 */
exports.updateContact = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { id } = req.params;
    const { contact_name, email, phone_number, role_title, remarks } = req.body;

    // Verify contact belongs to this company
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (contact_name !== undefined) updateData.contact_name = contact_name;
    if (email !== undefined) updateData.email = email;
    if (phone_number !== undefined) updateData.phone_number = phone_number;
    if (role_title !== undefined) updateData.role_title = role_title;
    if (remarks !== undefined) updateData.remarks = remarks;

    const { data, error } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ data, message: 'Contact updated successfully' });
  } catch (err) {
    logger.error('updateContact error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
};

/**
 * DELETE /company/contacts/:id
 * Delete a contact
 */
exports.deleteContact = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { id } = req.params;

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ message: 'Contact deleted successfully' });
  } catch (err) {
    logger.error('deleteContact error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
};

// ============== PLACEMENT DRIVES ==============

/**
 * GET /company/drives
 * Get all placement drives for my company (same shape as placement drives for table UI).
 */
/* Only select columns that exist on placements_drives (no eligibility_criteria in schema). */
const DRIVES_SELECT_WITH_COMPANY = `
  id, company_id, academic_year, year, job_type, type_of_hiring, job_description, job_location,
  ctc_structure, stipend_structure, process_rounds, number_of_openings,
  number_of_registrations, placement_status, last_date_to_registration,
  event_datetime, onboarded_date, tpo, company_remarks, created_at,
  company:companies (company_name)
`;
const DRIVES_SELECT_BASE = `
  id, company_id, academic_year, year, job_type, type_of_hiring, job_description, job_location,
  ctc_structure, stipend_structure, process_rounds, number_of_openings,
  number_of_registrations, placement_status, last_date_to_registration,
  event_datetime, onboarded_date, tpo, company_remarks, created_at
`;

exports.getDrives = async (req, res) => {
  let companyId;
  try {
    companyId = await getCompanyIdFromUser(req);
    if (companyId == null || companyId === '') {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }
    const cid = Number(companyId);

    // Prefer pool (same DB as auth) so company drives always match user_login.company_id
    let rows = [];
    try {
      const driveResult = await pool.query(
        `SELECT pd.id, pd.company_id, pd.academic_year, pd.year, pd.job_type, pd.type_of_hiring,
                pd.job_description, pd.job_location, pd.ctc_structure, pd.stipend_structure,
                pd.process_rounds, pd.number_of_openings, pd.number_of_registrations,
                pd.placement_status, pd.last_date_to_registration, pd.event_datetime,
                pd.onboarded_date, pd.tpo, pd.company_remarks, pd.created_at,
                c.company_name
         FROM placements_drives pd
         LEFT JOIN companies c ON c.id = pd.company_id
         WHERE pd.company_id = $1
         ORDER BY pd.created_at DESC`,
        [cid]
      );
      rows = (driveResult.rows || []).map((r) => {
        const { company_name, ...rest } = r;
        return { ...rest, company: company_name != null ? { company_name } : null };
      });
    } catch (poolErr) {
      logger.error('getDrives pool query error:', poolErr);
      return res.status(500).json({ error: 'Failed to fetch drives', message: poolErr?.message || 'Database error' });
    }
    const driveIds = (rows || []).map((d) => d.id).filter(Boolean);
    const usnsByDrive = {};
    if (driveIds.length > 0) {
      const processResult = await pool.query(
        'SELECT placement_drive_id, usn FROM student_placement_process WHERE placement_drive_id = ANY($1::bigint[]) AND usn IS NOT NULL AND TRIM(usn) != \'\'',
        [driveIds]
      );
      (processResult.rows || []).forEach((row) => {
        const id = row.placement_drive_id;
        if (!usnsByDrive[id]) usnsByDrive[id] = new Set();
        if (row.usn) usnsByDrive[id].add(row.usn);
      });
    }
    const allUsns = [...new Set(Object.values(usnsByDrive).flatMap((s) => [...s]))];
    let studentSchoolProgramMap = {};
    if (allUsns.length > 0) {
      const studentResult = await pool.query(
        'SELECT usn, school_id, program_id FROM student_basic_details WHERE usn = ANY($1::text[])',
        [allUsns]
      );
      studentSchoolProgramMap = (studentResult.rows || []).reduce((acc, s) => {
        acc[s.usn] = { school_id: s.school_id, program_id: s.program_id };
        return acc;
      }, {});
    }
    const schoolIds = new Set();
    const programIds = new Set();
    rows.forEach((d) => {
      const elig = d.eligibility_criteria || null;
      if (elig && Array.isArray(elig.allowed_school_ids)) elig.allowed_school_ids.forEach((id) => schoolIds.add(id));
      if (elig && Array.isArray(elig.allowed_program_ids)) elig.allowed_program_ids.forEach((id) => programIds.add(id));
    });
    Object.values(studentSchoolProgramMap).forEach(({ school_id, program_id }) => {
      if (school_id != null) schoolIds.add(school_id);
      if (program_id != null) programIds.add(program_id);
    });
    let schoolMap = {};
    let programMap = {};
    if (schoolIds.size) {
      const schoolResult = await pool.query('SELECT id, name FROM schools WHERE id = ANY($1::bigint[])', [[...schoolIds]]);
      schoolMap = (schoolResult.rows || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    }
    if (programIds.size) {
      const programResult = await pool.query('SELECT id, name, school_id FROM programs WHERE id = ANY($1::bigint[])', [[...programIds]]);
      programMap = (programResult.rows || []).reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
    }

    const drives = rows.map((d) => {
      const elig = d.eligibility_criteria || null;
      const sid = elig && Array.isArray(elig.allowed_school_ids) && elig.allowed_school_ids.length > 0
        ? elig.allowed_school_ids[0] : null;
      const pid = elig && Array.isArray(elig.allowed_program_ids) && elig.allowed_program_ids.length > 0
        ? elig.allowed_program_ids[0] : null;
      const driveUsns = usnsByDrive[d.id] ? [...usnsByDrive[d.id]] : [];
      const pairKeys = new Set();
      const schoolProgramPairs = [];
      driveUsns.forEach((usn) => {
        const sp = studentSchoolProgramMap[usn];
        if (!sp?.school_id || !sp?.program_id) return;
        const prog = programMap[sp.program_id];
        if (!prog || (typeof prog === 'object' && prog.school_id !== sp.school_id)) return;
        const schoolName = schoolMap[sp.school_id];
        const programName = typeof prog === 'object' ? prog.name : prog;
        if (!schoolName || !programName) return;
        const key = `${schoolName}|${programName}`;
        if (pairKeys.has(key)) return;
        pairKeys.add(key);
        schoolProgramPairs.push({ school: schoolName, program: programName });
      });
      const eligibility_display = schoolProgramPairs.map((p) => `${p.school} - ${p.program}`).join(', ');
      return {
        ...d,
        company_name: d.company?.company_name ?? null,
        school: sid ? schoolMap[sid] ?? null : null,
        program: pid ? (typeof programMap[pid] === 'object' ? programMap[pid]?.name : programMap[pid]) ?? null : null,
        registered_count: d.number_of_registrations ?? 0,
        school_program_pairs: schoolProgramPairs,
        eligibility_display: eligibility_display || null,
      };
    });

    res.json({ data: drives });
  } catch (err) {
    logger.error('getDrives error:', err);
    return res.status(500).json({
      error: 'Failed to fetch drives',
      message: err?.message || 'Server error',
      data: []
    });
  }
};

/**
 * GET /company/drives/:id
 * Get single drive details (with company_name for process page UI)
 */
exports.getDriveById = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from('placements_drives')
      .select(`
        *,
        company:companies (company_name)
      `)
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Drive not found' });
    }

    const drive = { ...data, company_name: data.company?.company_name ?? null };
    res.json({ data: drive });
  } catch (err) {
    logger.error('getDriveById error:', err);
    res.status(500).json({ error: 'Failed to fetch drive details' });
  }
};

/**
 * GET /company/drives/:id/eligibility
 * Get drive eligibility criteria (read-only)
 */
exports.getDriveEligibility = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { id } = req.params;

    const { data, error } = await supabase
      .from('placements_drives')
      .select('eligibility_criteria')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Drive not found' });
    res.json({ data: data.eligibility_criteria || null });
  } catch (err) {
    logger.error('getDriveEligibility error:', err);
    res.status(500).json({ error: 'Failed to fetch eligibility criteria' });
  }
};

/**
 * GET /company/drives/:id/candidates
 * Get candidates in the pipeline for a drive
 */
exports.getDriveCandidates = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { id } = req.params;
    const { status, search } = req.query;

    // First verify the drive belongs to this company
    const { data: drive } = await supabase
      .from('placements_drives')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (!drive) {
      return res.status(404).json({ error: 'Drive not found' });
    }

    let query = supabase
      .from('student_placement_process')
      .select(`
        id, usn, is_eligible, registration_status, approved_status,
        oa_status, gd_status, technical_round_status, interview_status,
        hr_round_status, final_select_status, malpractice, remarks, attendance,
        created_at, updated_at,
        student_basic_details (
          usn, full_name, college_email,
          school_id, program_id, current_year, current_semester
        )
      `)
      .eq('placement_drive_id', id);

    // Filter by status if provided
    if (status === 'registered') {
      query = query.eq('registration_status', 'registered');
    } else if (status === 'selected') {
      query = query.eq('final_select_status', true);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    let candidates = data || [];
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      candidates = candidates.filter(c =>
        c.usn?.toLowerCase().includes(searchLower) ||
        c.student_basic_details?.full_name?.toLowerCase().includes(searchLower)
      );
    }

    // Attach school name for process table display
    const schoolIds = [...new Set(candidates.map(c => c.student_basic_details?.school_id).filter(Boolean))];
    let schoolMap = {};
    if (schoolIds.length > 0) {
      const { data: schools } = await supabase.from('schools').select('id, name').in('id', schoolIds);
      schoolMap = (schools || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    }
    candidates = candidates.map(c => {
      const schoolId = c.student_basic_details?.school_id;
      return {
        ...c,
        school: schoolId ? (schoolMap[schoolId] || null) : null,
      };
    });

    res.json({ data: candidates });
  } catch (err) {
    logger.error('getDriveCandidates error:', err);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
};

/**
 * PATCH /company/drives/:driveId/candidates/:usn
 * Update candidate status in pipeline
 */
exports.updateCandidateStatus = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { driveId, usn } = req.params;
    const {
      oa_status, gd_status, technical_round_status,
      interview_status, hr_round_status, final_select_status,
      approved_status, malpractice, remarks, attendance
    } = req.body;

    // Verify the drive belongs to this company
    const { data: drive } = await supabase
      .from('placements_drives')
      .select('id')
      .eq('id', driveId)
      .eq('company_id', companyId)
      .single();

    if (!drive) {
      return res.status(404).json({ error: 'Drive not found' });
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (oa_status !== undefined) updateData.oa_status = oa_status;
    if (gd_status !== undefined) updateData.gd_status = gd_status;
    if (technical_round_status !== undefined) updateData.technical_round_status = technical_round_status;
    if (interview_status !== undefined) updateData.interview_status = interview_status;
    if (hr_round_status !== undefined) updateData.hr_round_status = hr_round_status;
    if (final_select_status !== undefined) updateData.final_select_status = final_select_status;
    if (approved_status !== undefined) updateData.approved_status = approved_status;
    if (malpractice !== undefined) updateData.malpractice = malpractice;
    if (remarks !== undefined) updateData.remarks = remarks;
    if (attendance !== undefined) updateData.attendance = attendance;

    const { data, error } = await supabase
      .from('student_placement_process')
      .update(updateData)
      .eq('placement_drive_id', driveId)
      .eq('usn', usn)
      .select()
      .single();

    if (error) throw error;
    res.json({ data, message: 'Candidate status updated' });
  } catch (err) {
    logger.error('updateCandidateStatus error:', err);
    res.status(500).json({ error: 'Failed to update candidate status' });
  }
};

// ============== STUDENT PROFILE (Company-Safe View) ==============

/**
 * GET /company/students/:usn
 * Get student profile (company-safe view)
 * Excludes: disciplinary records, parent details, personal email/phone, violations
 */
exports.getStudentProfile = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { usn } = req.params;

    // Basic details (including mandatory fields for company view)
    const { data: student, error: studentError } = await supabase
      .from('student_basic_details')
      .select(`
        usn, full_name, college_email,
        school_id, program_id, major_id, specialization_id,
        year_of_joining, current_year, current_semester,
        profile_image, gender, date_of_birth,
        personal_email, phone_country_code, phone_number
      `)
      .eq('usn', usn)
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Profile details (resume for company view)
    const { data: profile } = await supabase
      .from('student_profile_details')
      .select('brief_summary, key_expertise, career_objective, resume_file')
      .eq('usn', usn)
      .single();

    // Latest semester academics (current aggregate & live backlogs)
    const { data: semesterRows } = await supabase
      .from('student_semester_academics')
      .select('academic_year, semester, result_in_sgpa, live_backlogs')
      .eq('usn', usn)
      .order('academic_year', { ascending: false })
      .order('semester', { ascending: false })
      .limit(1);

    // Public projects only (projects table)
    const projRes = await pool.query(
      `SELECT p.id, p.title, p.short_description, p.description, p.category, p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.priority
       FROM projects p
       WHERE p.owner_usn = $1 AND p.visibility = 'PUBLIC' AND p.project_status = 'approved'
       ORDER BY p.priority ASC NULLS LAST`,
      [usn]
    );
    const projRows = projRes.rows || [];
    const projIds = projRows.map((p) => p.id);
    let projectSnapsByProj = {};
    if (projIds.length > 0) {
      const assetRes = await pool.query(
        'SELECT project_id, original_url FROM project_assets WHERE project_id = ANY($1::bigint[]) AND asset_role IN (\'GALLERY\', \'COVER\') ORDER BY project_id, position',
        [projIds]
      );
      (assetRes.rows || []).forEach((a) => {
        if (!projectSnapsByProj[a.project_id]) projectSnapsByProj[a.project_id] = [];
        projectSnapsByProj[a.project_id].push(a.original_url);
      });
    }
    const projects = projRows.map((p) => ({
      id: p.id,
      title: p.title,
      one_line_description: p.short_description,
      full_description: p.description,
      genre: p.category,
      priority: p.priority,
      project_snaps: projectSnapsByProj[p.id] || [],
      hosted_link: p.hosted_url,
      github_repo: p.github_url,
      technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      mentor_name: p.mentor_name,
    }));

    // Internships
    const { data: internships } = await supabase
      .from('student_internships')
      .select('*')
      .eq('usn', usn)
      .order('start_date', { ascending: false });

    // Summer internships
    const { data: summerInternships } = await supabase
      .from('student_summer_internship')
      .select('*')
      .eq('usn', usn)
      .order('start_date', { ascending: false });

    // Capstone
    const { data: capstone } = await supabase
      .from('capstone')
      .select('*')
      .eq('usn', usn);

    // Education history
    const { data: education } = await supabase
      .from('student_education_history')
      .select('*')
      .eq('usn', usn)
      .order('end_year', { ascending: false });

    // Certifications
    const { data: certifications } = await supabase
      .from('student_certifications')
      .select('*')
      .eq('usn', usn)
      .order('issue_date', { ascending: false });

    // Lookup tables for names
    const [schoolsRes, programsRes, majorsRes, specializationsRes] = await Promise.all([
      supabase.from('schools').select('id, name'),
      supabase.from('programs').select('id, name'),
      supabase.from('majors').select('id, name'),
      supabase.from('specializations').select('id, name'),
    ]);

    const schools = Object.fromEntries((schoolsRes.data || []).map(s => [s.id, s.name]));
    const programs = Object.fromEntries((programsRes.data || []).map(p => [p.id, p.name]));
    const majors = Object.fromEntries((majorsRes.data || []).map(m => [m.id, m.name]));
    const specializations = Object.fromEntries((specializationsRes.data || []).map(s => [s.id, s.name]));

    const eduList = education || [];
    const tenthEdu = eduList.find(e => (e.education_level || '').toUpperCase() === '10TH');
    const twelfthEdu = eduList.find(e => (e.education_level || '').toUpperCase() === '12TH');
    const diplomaEdu = eduList.find(e => (e.education_level || '').toUpperCase() === 'DIPLOMA');
    const latestAcad = Array.isArray(semesterRows) && semesterRows.length > 0 ? semesterRows[0] : null;

    const formatDob = (d) => {
      if (!d) return null;
      const date = new Date(d);
      if (isNaN(date.getTime())) return null;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };

    const officialPhone = [student.phone_country_code, student.phone_number].filter(Boolean).join(' ').trim() || null;
    const personalEmails = student.personal_email ? [student.personal_email] : [];

    res.json({
      data: {
        ...student,
        school_name: schools[student.school_id] || null,
        program_name: programs[student.program_id] || null,
        major_name: majors[student.major_id] || null,
        specialization_name: specializations[student.specialization_id] || null,
        profile: profile || null,
        projects: projects || [],
        internships: internships || [],
        summer_internships: summerInternships || [],
        capstone: capstone || [],
        education: education || [],
        certifications: certifications || [],
        official_email: student.college_email || null,
        personal_emails: personalEmails,
        official_phone: officialPhone,
        date_of_birth_formatted: formatDob(student.date_of_birth),
        tenth_aggregate_marks: tenthEdu?.result != null ? String(tenthEdu.result) + (tenthEdu.result_type ? ` ${tenthEdu.result_type}` : '') : null,
        twelfth_aggregate_marks: twelfthEdu?.result != null ? String(twelfthEdu.result) + (twelfthEdu.result_type ? ` ${twelfthEdu.result_type}` : '') : null,
        diploma_aggregate_marks: diplomaEdu?.result != null ? String(diplomaEdu.result) + (diplomaEdu.result_type ? ` ${diplomaEdu.result_type}` : '') : null,
        current_aggregate_marks: latestAcad?.result_in_sgpa != null ? String(latestAcad.result_in_sgpa) : null,
        current_live_backlogs: latestAcad?.live_backlogs != null ? parseInt(latestAcad.live_backlogs, 10) : null,
      }
    });
  } catch (err) {
    logger.error('getStudentProfile error:', err);
    res.status(500).json({ error: 'Failed to fetch student profile' });
  }
};

// ============== OFFERS ==============

/**
 * GET /company/offers
 * Get all offers for my company
 */
exports.getOffers = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { data, error } = await supabase
      .from('offers')
      .select(`
        id, student_id, job_type, academic_year, remarks, is_accepted, created_at,
        student_basic_details (usn, full_name, college_email, current_year)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    logger.error('getOffers error:', err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
};

// ============== EVENTS ==============

/**
 * GET /company/events
 * Returns only events that were sent to companies via notifications (same logic as alumni events).
 * Notifications where target_type = 'ROLE' and target_role like 'company', or target_type = 'ALL', with an event link.
 */
exports.getEvents = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const notifRes = await pool.query(
      `SELECT n.link FROM notifications n
       WHERE n.is_active = true AND n.link IS NOT NULL AND TRIM(n.link) != ''
         AND ( (n.target_type = 'ROLE' AND (n.target_role ILIKE '%company%' OR LOWER(TRIM(n.target_role)) = 'company'))
               OR n.target_type = 'ALL' )`
    );
    const eventIds = new Set();
    for (const row of notifRes.rows || []) {
      const link = row.link || '';
      const m = link.match(/event[s]?[\/\-](\d+)/i) || link.match(/[?&]event[=_ ]?(\d+)/i);
      if (m) eventIds.add(parseInt(m[1], 10));
    }
    const ids = [...eventIds];
    if (ids.length === 0) {
      return res.json({ data: [] });
    }

    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .in('id', ids)
      .order('event_datetime', { ascending: false });

    if (error) throw error;

    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const withImageUrls = (events || []).map((ev) => ({
      ...ev,
      image_url: baseUrl && ev.id
        ? `${baseUrl}/storage/v1/object/public/system-assets/events/${ev.id}.jpg`
        : null,
    }));
    res.json({ data: withImageUrls });
  } catch (err) {
    logger.error('getEvents error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

// ============== STUDENT PROJECTS (only students who registered to company's drives) ==============

/**
 * GET /company/projects
 * Approved projects from students who have registered to any of this company's placement drives.
 */
exports.getProjects = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const driveIdsRes = await pool.query(
      'SELECT id FROM placements_drives WHERE company_id = $1',
      [companyId]
    );
    const driveIds = (driveIdsRes.rows || []).map((r) => r.id);
    if (driveIds.length === 0) {
      return res.json([]);
    }

    const usnsRes = await pool.query(
      `SELECT DISTINCT usn FROM student_placement_process
       WHERE placement_drive_id = ANY($1::bigint[]) AND usn IS NOT NULL AND TRIM(usn) != ''`,
      [driveIds]
    );
    const usns = (usnsRes.rows || []).map((r) => r.usn);
    if (usns.length === 0) {
      return res.json([]);
    }

    const projRes = await pool.query(
      `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
        p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.published_at, p.visibility
       FROM projects p
       LEFT JOIN project_metrics m ON m.project_id = p.id
       WHERE LOWER(TRIM(p.project_status::text)) = 'approved'
         AND p.owner_usn = ANY($1::text[])
       ORDER BY COALESCE(m.likes, 0) DESC, COALESCE(m.views, 0) DESC
       LIMIT 100`,
      [usns]
    );
    const rows = projRes.rows || [];
    const projectIds = rows.map((r) => r.id);
    if (projectIds.length === 0) {
      return res.json([]);
    }

    let assetsByProj = {};
    let likedSet = new Set();
    let favoritedSet = new Set();
    const [assetRes, likeRes, favRes] = await Promise.all([
      pool.query(
        `SELECT project_id, original_url, position
         FROM project_assets
         WHERE project_id = ANY($1::bigint[]) AND asset_role IN ('COVER','GALLERY')
         ORDER BY project_id, position`,
        [projectIds]
      ),
      pool.query(
        'SELECT project_id FROM project_likes WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
        [projectIds, userId]
      ),
      pool.query(
        'SELECT project_id FROM project_favorites WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
        [projectIds, userId]
      ),
    ]);
    (assetRes.rows || []).forEach((a) => {
      if (!assetsByProj[a.project_id]) assetsByProj[a.project_id] = [];
      assetsByProj[a.project_id].push(a.original_url);
    });
    (likeRes.rows || []).forEach((r) => likedSet.add(r.project_id));
    (favRes.rows || []).forEach((r) => favoritedSet.add(r.project_id));

    const metricRes = await pool.query(
      'SELECT project_id, views, likes, favorites FROM project_metrics WHERE project_id = ANY($1::bigint[])',
      [projectIds]
    );
    const metricMap = {};
    (metricRes.rows || []).forEach((m) => { metricMap[m.project_id] = m; });

    const list = rows.map((p) => {
      const m = metricMap[p.id] || {};
      return {
        id: p.id,
        owner_usn: p.owner_usn,
        usn: p.owner_usn,
        title: p.title,
        short_description: p.short_description,
        one_line_description: p.short_description,
        description: p.description,
        full_description: p.description,
        category: p.category,
        genre: p.category,
        hosted_url: p.hosted_url,
        hosted_link: p.hosted_url,
        github_url: p.github_url,
        github_repo: p.github_url,
        mentor_name: p.mentor_name,
        tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        published_at: p.published_at,
        project_snaps: assetsByProj[p.id] || [],
        cover_url: (assetsByProj[p.id] && assetsByProj[p.id][0]) || null,
        views_count: m.views ?? 0,
        likes_count: m.likes ?? 0,
        favorites_count: m.favorites ?? 0,
        is_liked: likedSet.has(p.id),
        is_favorited: favoritedSet.has(p.id),
      };
    });

    res.json(list);
  } catch (err) {
    logger.error('getProjects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
};

/**
 * GET /company/projects/:projectId
 * Single project detail; only allowed if owner has registered to one of this company's drives.
 */
exports.getProjectById = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const projectId = parseInt(req.params.projectId, 10);
    if (Number.isNaN(projectId)) {
      return res.status(400).json({ error: 'Invalid project id' });
    }

    const driveIdsRes = await pool.query(
      'SELECT id FROM placements_drives WHERE company_id = $1',
      [companyId]
    );
    const driveIds = (driveIdsRes.rows || []).map((r) => r.id);
    const usnsRes = await pool.query(
      `SELECT DISTINCT usn FROM student_placement_process
       WHERE placement_drive_id = ANY($1::bigint[]) AND usn IS NOT NULL AND TRIM(usn) != ''`,
      [driveIds.length ? driveIds : [-1]]
    );
    const allowedUsns = new Set((usnsRes.rows || []).map((r) => r.usn));

    const projRes = await pool.query(
      `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
        p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.published_at, p.project_status, p.created_at
       FROM projects p
       WHERE p.id = $1 AND LOWER(TRIM(p.project_status::text)) = 'approved'`,
      [projectId]
    );
    const p = projRes.rows?.[0];
    if (!p || !allowedUsns.has(p.owner_usn)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const [assetRes, likeRes, favRes, metricRes, reviewsRes] = await Promise.all([
      pool.query(
        `SELECT project_id, original_url, position FROM project_assets
         WHERE project_id = $1 AND asset_role IN ('COVER','GALLERY') ORDER BY position`,
        [projectId]
      ),
      pool.query('SELECT 1 FROM project_likes WHERE project_id = $1 AND user_id = $2', [projectId, userId]),
      pool.query('SELECT 1 FROM project_favorites WHERE project_id = $1 AND user_id = $2', [projectId, userId]),
      pool.query('SELECT views, likes, favorites FROM project_metrics WHERE project_id = $1', [projectId]),
      pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, r.reviewer_id
         FROM project_reviews r WHERE r.project_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [projectId]
      ),
    ]);
    const assets = (assetRes.rows || []).map((a) => a.original_url);
    const metric = metricRes.rows?.[0] || {};
    const reviews = reviewsRes.rows || [];

    const project = {
      id: p.id,
      owner_usn: p.owner_usn,
      usn: p.owner_usn,
      title: p.title,
      short_description: p.short_description,
      one_line_description: p.short_description,
      description: p.description,
      full_description: p.description,
      category: p.category,
      genre: p.category,
      hosted_url: p.hosted_url,
      hosted_link: p.hosted_url,
      github_url: p.github_url,
      github_repo: p.github_url,
      mentor_name: p.mentor_name,
      tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      published_at: p.published_at,
      created_at: p.created_at,
      project_status: p.project_status,
      project_snaps: assets,
      cover_url: assets[0] || null,
      views_count: metric.views ?? 0,
      likes_count: metric.likes ?? 0,
      favorites_count: metric.favorites ?? 0,
      is_liked: (likeRes.rows || []).length > 0,
      is_favorited: (favRes.rows || []).length > 0,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        created_at: r.created_at,
        reviewer_id: r.reviewer_id,
      })),
    };
    res.json(project);
  } catch (err) {
    logger.error('getProjectById error:', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
};

// ============== NOTIFICATIONS ==============

/**
 * GET /company/notifications
 * List notifications for the logged-in company user (from notification_nodes).
 */
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await pool.query(
      `SELECT nn.id, nn.notification_id, nn.is_read, nn.is_archived, nn.is_starred, nn.created_at,
              n.title, n.message, n.link, n.notification_type
       FROM notification_nodes nn
       JOIN notifications n ON n.id = nn.notification_id
       WHERE nn.user_id = $1 AND n.is_active = true
       ORDER BY nn.created_at DESC
       LIMIT 100`,
      [userId]
    );

    const data = (result.rows || []).map((row) => ({
      id: row.id,
      notificationId: row.notification_id,
      title: row.title,
      message: row.message,
      link: row.link,
      notificationType: row.notification_type || 'General',
      isRead: !!row.is_read,
      isArchived: !!row.is_archived,
      isStarred: !!row.is_starred,
      createdAt: row.created_at,
    }));

    res.json({ data });
  } catch (err) {
    logger.error('getNotifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

/**
 * GET /company/notifications/unread-count
 */
exports.getNotificationsUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notification_nodes nn
       INNER JOIN notifications n ON n.id = nn.notification_id
       WHERE nn.user_id = $1 AND n.is_active = true AND (nn.is_read IS NULL OR nn.is_read = false)
         AND (nn.is_archived = false OR nn.is_archived IS NULL)`,
      [userId]
    );
    const count = result.rows?.[0]?.count ?? 0;
    res.json({ data: { unreadCount: count } });
  } catch (err) {
    logger.error('getNotificationsUnreadCount error:', err);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

/**
 * PATCH /company/notifications/:nodeId
 * Update notification node (mark read, archive, star).
 */
exports.updateNotificationNode = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { nodeId } = req.params;
    const { is_read, is_archived, is_starred } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const updates = [];
    const values = [];
    let i = 1;
    if (typeof is_read === 'boolean') {
      updates.push(`is_read = $${i++}`);
      values.push(is_read);
    }
    if (typeof is_archived === 'boolean') {
      updates.push(`is_archived = $${i++}`);
      values.push(is_archived);
    }
    if (typeof is_starred === 'boolean') {
      updates.push(`is_starred = $${i++}`);
      values.push(is_starred);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid update fields' });
    }
    values.push(nodeId, userId);
    const nodeIdIdx = i++;
    const userIdIdx = i;
    const result = await pool.query(
      `UPDATE notification_nodes SET ${updates.join(', ')} WHERE id = $${nodeIdIdx} AND user_id = $${userIdIdx}
       RETURNING id, is_read, is_archived, is_starred`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error('updateNotificationNode error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

// ============== DASHBOARD ==============

/**
 * GET /company/dashboard
 * Get dashboard stats
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    // Get company info
    const { data: company } = await supabase
      .from('companies')
      .select('company_name, company_logo_link, company_type')
      .eq('id', companyId)
      .single();

    // Get drives (include job_type for chart labels)
    const { data: drives } = await supabase
      .from('placements_drives')
      .select('id, placement_status, number_of_registrations, job_type, academic_year')
      .eq('company_id', companyId)
      .order('id', { ascending: false });

    const activeDrives = (drives || []).filter(d =>
      d.placement_status && !['completed', 'cancelled'].includes(d.placement_status.toLowerCase())
    );

    const totalRegistrations = (drives || []).reduce((sum, d) => sum + (d.number_of_registrations || 0), 0);

    // Chart: registrations per drive (bar)
    const chart_drives_registrations = (drives || []).slice(0, 10).map((d, i) => ({
      label: (d.job_type || d.academic_year || `Drive ${i + 1}`).toString().slice(0, 20),
      registrations: d.number_of_registrations || 0,
    }));

    // Get offers
    const { data: offers } = await supabase
      .from('offers')
      .select('id, is_accepted')
      .eq('company_id', companyId);

    const totalOffers = (offers || []).length;
    const acceptedOffers = (offers || []).filter(o => o.is_accepted === true).length;
    const pendingOffers = totalOffers - acceptedOffers;

    // Chart: offers breakdown (doughnut)
    const chart_offers = { accepted: acceptedOffers, pending: pendingOffers };

    // Chart: drives by status (for doughnut)
    const driveStatusCounts = { active: activeDrives.length, completed: (drives || []).length - activeDrives.length };

    // Recent activity: recent registrations
    const driveIds = (drives || []).map(d => d.id);
    let recentActivity = [];
    
    if (driveIds.length > 0) {
      const { data: recentRegistrations } = await supabase
        .from('student_placement_process')
        .select(`
          id, usn, registration_status, created_at,
          student_basic_details (full_name)
        `)
        .in('placement_drive_id', driveIds)
        .eq('registration_status', 'registered')
        .order('created_at', { ascending: false })
        .limit(10);

      recentActivity = (recentRegistrations || []).map(r => ({
        type: 'registration',
        student_name: r.student_basic_details?.full_name || r.usn,
        usn: r.usn,
        timestamp: r.created_at,
      }));
    }

    res.json({
      data: {
        company,
        stats: {
          active_drives: activeDrives.length,
          total_drives: (drives || []).length,
          total_registrations: totalRegistrations,
          total_offers: totalOffers,
          accepted_offers: acceptedOffers,
        },
        recent_activity: recentActivity,
        chart_drives_registrations: chart_drives_registrations,
        chart_offers: chart_offers,
        chart_drives_status: driveStatusCounts,
      }
    });
  } catch (err) {
    logger.error('getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
};
