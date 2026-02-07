const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * Helper: Get company_id from authenticated user
 * user_login has company_id linked to companies.id
 */
async function getCompanyIdFromUser(req) {
  const userId = req.user?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('user_login')
    .select('company_id')
    .eq('id', userId)
    .single();

  return data?.company_id || null;
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
exports.getDrives = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    const { data, error } = await supabase
      .from('placements_drives')
      .select(`
        id, academic_year, year, job_type, type_of_hiring, job_description, job_location,
        ctc_structure, stipend_structure, process_rounds, number_of_openings,
        number_of_registrations, placement_status, last_date_to_registration,
        event_datetime, onboarded_date, tpo, company_remarks, created_at,
        company:companies (company_name)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const driveIds = rows.map((d) => d.id).filter(Boolean);

    let eligibilityByDrive = {};
    if (driveIds.length > 0) {
      const { data: eligibilityRows } = await supabase
        .from('placement_drive_eligibility')
        .select('*')
        .in('placement_drive_id', driveIds);
      (eligibilityRows || []).forEach((e) => { eligibilityByDrive[e.placement_drive_id] = e; });
    }
    const schoolIds = new Set();
    const programIds = new Set();
    rows.forEach((d) => {
      const elig = eligibilityByDrive[d.id];
      if (elig && Array.isArray(elig.allowed_school_ids)) elig.allowed_school_ids.forEach((id) => schoolIds.add(id));
      if (elig && Array.isArray(elig.allowed_program_ids)) elig.allowed_program_ids.forEach((id) => programIds.add(id));
    });
    let schoolMap = {};
    let programMap = {};
    if (schoolIds.size) {
      const { data: schools } = await supabase.from('schools').select('id, name').in('id', [...schoolIds]);
      schoolMap = (schools || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    }
    if (programIds.size) {
      const { data: programs } = await supabase.from('programs').select('id, name').in('id', [...programIds]);
      programMap = (programs || []).reduce((acc, p) => { acc[p.id] = p.name; return acc; }, {});
    }

    const drives = rows.map((d) => {
      const elig = eligibilityByDrive[d.id];
      const sid = elig && Array.isArray(elig.allowed_school_ids) && elig.allowed_school_ids.length > 0
        ? elig.allowed_school_ids[0] : null;
      const pid = elig && Array.isArray(elig.allowed_program_ids) && elig.allowed_program_ids.length > 0
        ? elig.allowed_program_ids[0] : null;
      return {
        ...d,
        company_name: d.company?.company_name ?? null,
        school: sid ? schoolMap[sid] ?? null : null,
        program: pid ? programMap[pid] ?? null : null,
        registered_count: d.number_of_registrations ?? 0,
      };
    });

    res.json({ data: drives });
  } catch (err) {
    logger.error('getDrives error:', err);
    res.status(500).json({ error: 'Failed to fetch placement drives' });
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

    const { data, error } = await supabase
      .from('placement_drive_eligibility')
      .select('*')
      .eq('placement_drive_id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ data: data || null });
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

    // Apply search filter if provided
    let candidates = data || [];
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase();
      candidates = candidates.filter(c => 
        c.usn?.toLowerCase().includes(searchLower) ||
        c.student_basic_details?.full_name?.toLowerCase().includes(searchLower)
      );
    }

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

    // Public projects only
    const { data: projects } = await supabase
      .from('student_projects')
      .select(`
        id, title, one_line_description, full_description, genre,
        self_rating, admin_rating, priority, project_snaps,
        hosted_link, github_repo, technologies, mentor_name
      `)
      .eq('usn', usn)
      .eq('visibility', 'PUBLIC')
      .eq('is_approved', true)
      .order('priority', { ascending: true });

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
 * Get company-relevant events
 */
exports.getEvents = async (req, res) => {
  try {
    const companyId = await getCompanyIdFromUser(req);
    if (!companyId) {
      return res.status(403).json({ error: 'Company not linked to this account' });
    }

    // Get events (pre-placement talks, interview days, etc.)
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('event_datetime', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ data });
  } catch (err) {
    logger.error('getEvents error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
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
