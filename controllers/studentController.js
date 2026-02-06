const supabase = require('../config/supabaseClient');
const { getFriendlyMessage } = require('../utils/constraintErrors');
const { normalizePhoneForDb } = require('../utils/phoneNormalizer');

const PHONE_VALIDATION_MSG = 'Please enter a valid phone number (e.g. 1234567890). Use 10 digits only.';

/** Parse provisional_result_upload_links from DB (text) to array for API/frontend */
function parseProvisionalLinks(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val];
  return [];
}

exports.getProfile = async (req, res) => {
  try {
    const { usn } = req.params;
    
    // Fetch basic details
    const { data: basicDetails, error: basicError } = await supabase
      .from('student_basic_details')
      .select('*')
      .eq('usn', usn)
      .single();

    if (basicError && basicError.code !== 'PGRST116') { // PGRST116 is "Row not found"
        throw basicError;
    }

    if (!basicDetails) {
        return res.status(404).json({ message: "Student not found" });
    }

    // Fetch all other sections in parallel
    const [
        { data: education },
        { data: educationGaps },
        { data: academics },
        { data: projects },
        { data: internships },
        { data: trainings },
        { data: certifications },
        { data: publications },
        { data: extraCurricular },
        { data: otherExperiences },
        { data: parents },
        { data: career },
        { data: summerImmersion },
        { data: summerInternship },
        { data: capstone }
    ] = await Promise.all([
        supabase.from('student_education_history').select('*').eq('usn', usn),
        supabase.from('student_education_gaps').select('*').eq('usn', usn),
        supabase.from('student_semester_academics').select('*').eq('usn', usn).order('semester', { ascending: true }),
        supabase.from('student_projects').select('*').eq('usn', usn),
        supabase.from('student_internships').select('*').eq('usn', usn),
        supabase.from('student_trainings').select('*').eq('usn', usn),
        supabase.from('student_certifications').select('*').eq('usn', usn),
        supabase.from('student_publications').select('*').eq('usn', usn),
        supabase.from('student_extra_curricular_activities').select('*').eq('usn', usn),
        supabase.from('student_other_experiences').select('*').eq('usn', usn),
        supabase.from('student_parent_details').select('*').eq('usn', usn),
        supabase.from('student_profile_details').select('*').eq('usn', usn).single(),
        supabase.from('student_summer_immersion').select('*').eq('usn', usn),
        supabase.from('student_summer_internship').select('*').eq('usn', usn),
        supabase.from('capstone').select('*').eq('usn', usn).single()
    ]);

    // Construct response matching frontend expectations
    const profile = {
        usn: basicDetails.usn,
        firstName: basicDetails.full_name,
        personal: {
            ...basicDetails,
            firstName: basicDetails.full_name,
            schoolId: basicDetails.school_id,
            programId: basicDetails.program_id,
            majorId: basicDetails.major_id,
            minorId: basicDetails.minor_id,
            specializationId: basicDetails.specialization_id,
            yearOfJoining: basicDetails.year_of_joining,
            currentYear: basicDetails.current_year,
            currentSemester: basicDetails.current_semester,
            section: basicDetails.section
        },
        contact: {
            collegeEmail: basicDetails.college_email,
            personalEmail: basicDetails.personal_email,
            phoneCountryCode: basicDetails.phone_country_code,
            phoneNumber: basicDetails.phone_number
        },
        education: {
          education_history: education || [],
          education_gaps: educationGaps || []
        },
        // Academics page is deprecated; keep academics array for dashboard calculations only.
        academics: (academics || []).map(row => ({
          ...row,
          provisional_result_upload_links: parseProvisionalLinks(row.provisional_result_upload_links)
        })),
        projects: projects || [],
        internships: internships || [],
        trainings: trainings || [],
        certifications: certifications || [],
        publications: publications || [],
        extraCurricular: extraCurricular || [],
        otherExperiences: otherExperiences || [],
        family: parents || [],
        career: career || {},
        resume_file: career?.resume_file || null,
        summerImmersion: summerImmersion || [],
        summerInternship: summerInternship || [],
        capstone: capstone || {}
    };

    res.json(profile);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getProfileSection = async (req, res) => {
  try {
    const { usn, section } = req.params;
    let result = null;

    // Map aliases
    let effectiveSection = section;
    const sectionMap = {
        'academics': 'academic_performance',
        'family': 'parent_details',
        'extra-curricular': 'extra_curricular',
        'other-experiences': 'other_experiences',
        'career': 'career_overview'
    };
    if (sectionMap[section]) effectiveSection = sectionMap[section];

    switch (effectiveSection) {
        case 'personal':
            const { data: personal, error: pError } = await supabase
                .from('student_basic_details')
                .select('*')
                .eq('usn', usn)
                .single();
            if (pError && pError.code !== 'PGRST116') throw pError;
            // Map to frontend expectation
            result = personal ? {
                ...personal,
                firstName: personal.full_name, // fallback
                schoolId: personal.school_id,
                programId: personal.program_id,
                majorId: personal.major_id,
                minorId: personal.minor_id,
                specializationId: personal.specialization_id,
                yearOfJoining: personal.year_of_joining,
                currentYear: personal.current_year,
                currentSemester: personal.current_semester,
                section: personal.section
            } : {};
            break;

        case 'contact':
             const { data: contact, error: cError } = await supabase
                .from('student_basic_details')
                .select('college_email, personal_email, phone_country_code, phone_number')
                .eq('usn', usn)
                .single();
            if (cError && cError.code !== 'PGRST116') throw cError;
            result = contact ? {
                collegeEmail: contact.college_email,
                personalEmail: contact.personal_email,
                phoneCountryCode: contact.phone_country_code,
                phoneNumber: contact.phone_number,
                links: [] // Not persisted in DB currently
            } : {};
            break;

        case 'education':
            const [eduRes, gapsRes] = await Promise.all([
              supabase.from('student_education_history').select('*').eq('usn', usn),
              supabase.from('student_education_gaps').select('*').eq('usn', usn)
            ]);
            if (eduRes.error) {
                console.log("[Education-Backend] getProfileSection education_history ERROR", { usn, error: eduRes.error.message });
                throw eduRes.error;
            }
            if (gapsRes.error) {
                console.log("[Education-Backend] getProfileSection education_gaps ERROR", { usn, error: gapsRes.error.message });
                throw gapsRes.error;
            }
            result = { education_history: eduRes.data || [], education_gaps: gapsRes.data || [] };
            console.log("[Education-Backend] getProfileSection education", { usn, historyCount: (result.education_history || []).length, gapCount: (result.education_gaps || []).length });
            break;

        case 'academic_performance': {
            // Use new Postgres-backed table student_semester_records instead of legacy student_semester_academics
            const { data: semRows, error: aError } = await supabase
                .from('student_semester_records')
                .select('*')
                .eq('usn', usn)
                .order('semester', { ascending: true });
            if (aError) throw aError;

            // Map to shape expected by existing frontend (and older APIs)
            result = (semRows || []).map(row => ({
                usn: row.usn,
                academic_year: row.academic_year,
                semester: row.semester,
                result_in_sgpa: row.sgpa,
                closed_backlogs: row.cleared_backlogs ?? 0,
                live_backlogs: row.active_backlogs ?? 0,
                provisional_result_upload_links: row.result_file || null
            }));
            break;
        }

        case 'projects':
            const { data: proj, error: prError } = await supabase
                .from('student_projects')
                .select('*')
                .eq('usn', usn);
            if (prError) throw prError;
            result = proj || [];
            break;

        case 'internships':
            const { data: intern, error: iError } = await supabase
                .from('student_internships')
                .select('*')
                .eq('usn', usn);
            if (iError) throw iError;
            result = intern || [];
            break;

        case 'trainings':
            const { data: train, error: tError } = await supabase
                .from('student_trainings')
                .select('*')
                .eq('usn', usn);
            if (tError) throw tError;
            result = train || [];
            break;

        case 'certifications':
            const { data: cert, error: certError } = await supabase
                .from('student_certifications')
                .select('*')
                .eq('usn', usn);
            if (certError) throw certError;
            result = cert || [];
            break;
        
        case 'publications':
            const { data: pub, error: pubError } = await supabase
                .from('student_publications')
                .select('*')
                .eq('usn', usn);
            if (pubError) throw pubError;
            result = pub || [];
            break;

        case 'extra_curricular':
            const { data: extra, error: exError } = await supabase
                .from('student_extra_curricular_activities')
                .select('*')
                .eq('usn', usn);
            if (exError) throw exError;
            result = extra || [];
            break;

        case 'other_experiences':
            const { data: other, error: oError } = await supabase
                .from('student_other_experiences')
                .select('*')
                .eq('usn', usn);
            if (oError) throw oError;
            result = other || [];
            break;

        case 'career_overview':
             const { data: career, error: carError } = await supabase
                .from('student_profile_details')
                .select('*')
                .eq('usn', usn)
                .single();
            if (carError && carError.code !== 'PGRST116') throw carError;
            result = career || {};
            break;

        case 'parent_details':
             const { data: parent, error: parError } = await supabase
                .from('student_parent_details')
                .select('*')
                .eq('usn', usn);
            if (parError) throw parError;
            result = parent || [];
            break;

        case 'summer_internship':
             const { data: summerInt, error: sintError } = await supabase
                .from('student_summer_internship')
                .select('*')
                .eq('usn', usn);
            if (sintError) throw sintError;
            result = summerInt || [];
            break;
        
        case 'capstone':
             const { data: capstone, error: capError } = await supabase
                .from('capstone')
                .select('*')
                .eq('usn', usn)
                .single();
            if (capError && capError.code !== 'PGRST116') throw capError;
            result = capstone || {};
            break;

        case 'resume':
             const { data: resumeData, error: rError } = await supabase
                .from('student_profile_details')
                .select('resume_file')
                .eq('usn', usn)
                .single();
            if (rError && rError.code !== 'PGRST116') throw rError;
            result = resumeData || {};
            break;

        default:
            return res.status(400).json({ message: "Invalid section" });
    }

    res.json(result);
  } catch (error) {
    console.error(`Error fetching section ${req.params.section}:`, error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProfileSection = async (req, res) => {
  try {
    const { usn, section } = req.params;
    const data = req.body;
    let result = null;

    // Map aliases
    let effectiveSection = section;
    const sectionMap = {
        'academics': 'academic_performance',
        'family': 'parent_details',
        'extra-curricular': 'extra_curricular',
        'other-experiences': 'other_experiences',
        'career': 'career_overview'
    };
    if (sectionMap[section]) effectiveSection = sectionMap[section];

    switch (effectiveSection) {
        case 'personal': {
            const rawPhone = data.phone_number ?? data.phoneNumber ?? '';
            const { phone_country_code: pCode, phone_number: pNum } = normalizePhoneForDb(
                data.phone_country_code || data.phoneCountryCode,
                data.phone_number || data.phoneNumber
            );
            if (rawPhone !== '' && rawPhone != null && pNum === undefined) {
                return res.status(400).json({ message: PHONE_VALIDATION_MSG });
            }
            const updateData = {
                full_name: data.full_name || data.firstName,
                personal_email: data.personal_email || data.personalEmail,
                phone_country_code: pCode !== undefined ? pCode : (data.phone_country_code || data.phoneCountryCode),
                phone_number: pNum !== undefined ? pNum : (data.phone_number || data.phoneNumber),
                updated_at: new Date()
            };
            const { data: updatedPersonal, error: upError } = await supabase
                .from('student_basic_details')
                .update(updateData)
                .eq('usn', usn)
                .select();
            if (upError) throw upError;
            result = updatedPersonal;
            break;
        }

        case 'contact': {
            const rawPhoneContact = data.phoneNumber ?? '';
            const { phone_country_code: cCode, phone_number: cNum } = normalizePhoneForDb(data.phoneCountryCode, data.phoneNumber);
            if (rawPhoneContact !== '' && rawPhoneContact != null && cNum === undefined) {
                return res.status(400).json({ message: PHONE_VALIDATION_MSG });
            }
            const contactUpdate = {
                college_email: data.collegeEmail,
                personal_email: data.personalEmail,
                phone_country_code: cCode !== undefined ? cCode : data.phoneCountryCode,
                phone_number: cNum !== undefined ? cNum : data.phoneNumber,
                updated_at: new Date()
            };
            const { data: updatedContact, error: ucError } = await supabase
                .from('student_basic_details')
                .update(contactUpdate)
                .eq('usn', usn)
                .select();
            if (ucError) throw ucError;
            result = updatedContact;
            break;
        }

        case 'career_overview':
             // Upsert student_profile_details (accept both snake_case and camelCase from frontend)
             const careerUpdate = {
                 usn: usn,
                 brief_summary: data.brief_summary ?? data.briefSummary ?? null,
                 key_expertise: data.key_expertise ?? data.keyExpertise ?? null,
                 hobbies_interests: data.hobbies_interests ?? data.hobbiesInterests ?? null,
                 career_objective: data.career_objective ?? data.careerObjective ?? null,
                 future_goals: data.future_goals ?? data.futureGoals ?? null,
                 updated_at: new Date()
             };
             const { data: updatedCareer, error: ucarError } = await supabase
                .from('student_profile_details')
                .upsert(careerUpdate)
                .select();
             if (ucarError) throw ucarError;
             result = Array.isArray(updatedCareer) && updatedCareer.length > 0 ? updatedCareer[0] : (updatedCareer || {});
             break;

        case 'capstone':
             const capstoneUpdate = {
                 usn: usn,
                 ...data,
                 updated_at: new Date()
             };
             delete capstoneUpdate.id; 
             
             const { data: existingCapstone } = await supabase.from('capstone').select('id').eq('usn', usn).single();
             
             if (existingCapstone) {
                 const { data: uc, error: uce } = await supabase.from('capstone').update(capstoneUpdate).eq('id', existingCapstone.id).select();
                 if (uce) throw uce;
                 result = uc;
             } else {
                 const { data: ic, error: ice } = await supabase.from('capstone').insert(capstoneUpdate).select();
                 if (ice) throw ice;
                 result = ic;
             }
             break;

        case 'resume':
             const resumeUpdate = {
                 usn: usn,
                 resume_file: data.resume_file,
                 updated_at: new Date()
             };
             const { data: updatedResume, error: urError } = await supabase
                .from('student_profile_details')
                .upsert(resumeUpdate)
                .select();
             if (urError) throw urError;
             result = updatedResume;
             break;

        case 'education':
        case 'academic_performance':
        case 'projects':
        case 'internships':
        case 'trainings':
        case 'certifications':
        case 'publications':
        case 'extra_curricular':
        case 'other_experiences':
        case 'parent_details':
        case 'summer_internship':
            const tableNameMap = {
                'education': 'student_education_history',
                'academic_performance': 'student_semester_academics',
                'projects': 'student_projects',
                'internships': 'student_internships',
                'trainings': 'student_trainings',
                'certifications': 'student_certifications',
                'publications': 'student_publications',
                'extra_curricular': 'student_extra_curricular_activities',
                'other_experiences': 'student_other_experiences',
                'parent_details': 'student_parent_details',
                'summer_internship': 'student_summer_internship'
            };
             
             const tableName = tableNameMap[effectiveSection];
             if (!tableName) {
                 return res.status(400).json({ message: "Invalid section mapping" });
             }

             let items = [];
             if (Array.isArray(data)) {
                 items = data;
             } else if (data[effectiveSection]) {
                 items = data[effectiveSection];
             } else if (data[section]) {
                 items = data[section];
             } else {
                 // Try to find any array property
                 const keys = Object.keys(data);
                 for (const key of keys) {
                     if (Array.isArray(data[key])) {
                         items = data[key];
                         break;
                     }
                 }
             }
             
             // Delete all existing for this USN
             const { error: delError } = await supabase
                 .from(tableName)
                 .delete()
                 .eq('usn', usn);
             
             if (delError) throw delError;
             
             if (items.length > 0) {
                 // Insert new – sanitize: exclude system fields, map to DB columns, drop undefined values
                 const itemsToInsert = items.map(item => {
                     const { id, created_at, updated_at, ...rest } = item; // Exclude system fields
                     const clean = {};
                     for (const [k, v] of Object.entries(rest)) {
                         if (v !== undefined && v !== null) clean[k] = v;
                     }
                     // student_internships / student_summer_internship: accept both camelCase and snake_case so frontend payload is never dropped
                     const internshipCamelToSnake = [
                         ['jobRole', 'job_role'], ['organization', 'organization'],
                         ['organizationDetails', 'organization_details'], ['durationMonths', 'duration_months'],
                         ['startDate', 'start_date'], ['endDate', 'end_date'], ['mentorName', 'mentor_name'],
                         ['proofDocument', 'proof_document'], ['academicYear', 'academic_year']
                     ];
                     if (tableName === 'student_internships' || tableName === 'student_summer_internship') {
                         for (const [camel, snake] of internshipCamelToSnake) {
                             const val = clean[camel] ?? clean[snake];
                             if (val !== undefined && val !== null) clean[snake] = val;
                         }
                     }
                     let newItem = { ...clean, usn: usn };

                     // Normalize dates for PostgreSQL: only YYYY-MM-DD is valid; invalid -> null
                     const toDateOnly = (val) => {
                         if (val == null || val === '') return null;
                         const s = String(val).trim().split('T')[0];
                         return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
                     };
                     const tablesWithStartEndDate = [
                         'student_internships', 'student_summer_internship',
                         'student_trainings', 'student_extra_curricular_activities', 'student_other_experiences'
                     ];
                     if (tablesWithStartEndDate.includes(tableName)) {
                         if (newItem.start_date !== undefined) newItem.start_date = toDateOnly(newItem.start_date);
                         if (newItem.end_date !== undefined) newItem.end_date = toDateOnly(newItem.end_date);
                     }

                     // Per-table column mapping to match database schema
                     if (tableName === 'student_semester_academics') {
                         if (newItem.sgpa !== undefined && newItem.result_in_sgpa === undefined) {
                             newItem.result_in_sgpa = newItem.sgpa;
                             delete newItem.sgpa;
                         }
                         if (newItem.academic_year === undefined && newItem.academicYear !== undefined) {
                             newItem.academic_year = newItem.academicYear;
                             delete newItem.academicYear;
                         }
                         if (typeof newItem.provisional_result_upload_links === 'string') {
                             newItem.provisional_result_upload_links = newItem.provisional_result_upload_links.trim()
                                 ? [newItem.provisional_result_upload_links]
                                 : null;
                         }
                         if (Array.isArray(newItem.provisional_result_upload_links) && newItem.provisional_result_upload_links.length === 0) {
                             newItem.provisional_result_upload_links = null;
                         }
                         // DB column is text: store single URL (first link only)
                         if (Array.isArray(newItem.provisional_result_upload_links) && newItem.provisional_result_upload_links.length > 0) {
                             newItem.provisional_result_upload_links = newItem.provisional_result_upload_links[0];
                         }
                     }
                     if (tableName === 'student_trainings') {
                         if (newItem.institution === undefined && newItem.institution_name !== undefined) {
                             newItem.institution = newItem.institution_name;
                             delete newItem.institution_name;
                         }
                         if (newItem.start_date !== undefined && (newItem.start_date === '' || newItem.start_date === null)) {
                             newItem.start_date = null;
                         }
                         if (newItem.end_date !== undefined && (newItem.end_date === '' || newItem.end_date === null)) {
                             newItem.end_date = null;
                         }
                     }
                     if (tableName === 'student_projects') {
                         if (newItem.project_snaps !== undefined) {
                             newItem.project_snaps = Array.isArray(newItem.project_snaps)
                                 ? newItem.project_snaps
                                 : (typeof newItem.project_snaps === 'string' ? (newItem.project_snaps.trim() ? [newItem.project_snaps] : []) : []);
                         } else {
                             newItem.project_snaps = [];
                         }
                         if (newItem.technologies !== undefined) {
                             newItem.technologies = Array.isArray(newItem.technologies)
                                 ? newItem.technologies
                                 : (typeof newItem.technologies === 'string' ? (newItem.technologies.trim() ? newItem.technologies.split(',').map(s => s.trim()).filter(Boolean) : []) : []);
                         } else {
                             newItem.technologies = [];
                         }
                         if (newItem.visibility === undefined) newItem.visibility = 'PRIVATE';
                         if (newItem.self_rating === undefined) newItem.self_rating = 5;
                         if (newItem.priority === undefined) newItem.priority = 1;
                     }
                     if (tableName === 'student_education_history') {
                         if (newItem.result_type !== undefined && (newItem.result_type === '' || newItem.result_type === null)) {
                             newItem.result_type = null;
                         }
                         // DB schema uses start_year/end_year; accept frontend year_of_passing and map to end_year
                         if (newItem.year_of_passing !== undefined) {
                             if (newItem.year_of_passing === '' || newItem.year_of_passing === null) {
                                 newItem.end_year = null;
                             } else if (newItem.end_year === undefined) {
                                 const n = parseInt(String(newItem.year_of_passing), 10);
                                 newItem.end_year = Number.isFinite(n) ? n : null;
                             }
                             delete newItem.year_of_passing;
                         }
                         if (newItem.end_year !== undefined && (newItem.end_year === '' || newItem.end_year === null)) {
                             newItem.end_year = null;
                         }
                         if (newItem.result !== undefined && (newItem.result === '' || newItem.result === null)) {
                             newItem.result = null;
                         }
                     }
                     if (tableName === 'student_extra_curricular_activities') {
                         if (newItem.activity_name === undefined && newItem.activityName !== undefined) {
                             newItem.activity_name = newItem.activityName;
                             delete newItem.activityName;
                         }
                     }
                     if (tableName === 'student_publications') {
                         if (newItem.publication_type === undefined || newItem.publication_type === null || newItem.publication_type === '') {
                             newItem.publication_type = 'OTHER';
                         }
                         if (newItem.author_count === undefined || newItem.author_count === null || Number(newItem.author_count) < 1) {
                             newItem.author_count = 1;
                         }
                     }

                     // student_internships / summer: integer/numeric/date columns – empty string "" causes PostgreSQL 22P02/22007
                     if (tableName === 'student_internships' || tableName === 'student_summer_immersion' || tableName === 'student_summer_internship') {
                         if (newItem.duration_months !== undefined && (newItem.duration_months === '' || newItem.duration_months === null)) {
                             newItem.duration_months = null;
                         } else if (tableName === 'student_internships' && newItem.duration_months !== undefined) {
                             const n = Number(newItem.duration_months);
                             newItem.duration_months = Number.isInteger(n) && n >= 0 ? n : (Number.isFinite(n) ? Math.round(n) : null);
                         }
                         if (newItem.duration_weeks !== undefined && (newItem.duration_weeks === '' || newItem.duration_weeks === null)) {
                             newItem.duration_weeks = null;
                         }
                         if (newItem.stipend !== undefined && (newItem.stipend === '' || newItem.stipend === null)) {
                             newItem.stipend = null;
                         } else if (tableName === 'student_internships' && newItem.stipend !== undefined) {
                             const n = Number(newItem.stipend);
                             newItem.stipend = Number.isFinite(n) && n >= 0 ? n : null;
                         }
                         // NOT NULL text columns – default to empty string so insert does not fail
                         if (tableName === 'student_internships') {
                             if (newItem.job_role === undefined || newItem.job_role === null) newItem.job_role = '';
                             if (newItem.organization === undefined || newItem.organization === null) newItem.organization = '';
                         }
                     }

                    // student_certifications: camelCase from frontend + empty date string -> null
                    if (tableName === 'student_certifications') {
                        if (newItem.issueDate !== undefined) { newItem.issue_date = newItem.issueDate; delete newItem.issueDate; }
                        if (newItem.expiryDate !== undefined) { newItem.expiry_date = newItem.expiryDate; delete newItem.expiryDate; }
                        if (newItem.certificationType !== undefined) { newItem.certification_type = newItem.certificationType; delete newItem.certificationType; }
                        if (newItem.proofDocument !== undefined) { newItem.proof_document = newItem.proofDocument; delete newItem.proofDocument; }
                        const toDateOnly = (val) => {
                            if (val == null || val === '') return null;
                            const s = String(val).trim().split('T')[0];
                            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
                        };
                        if (newItem.issue_date !== undefined) newItem.issue_date = toDateOnly(newItem.issue_date);
                        if (newItem.expiry_date !== undefined) newItem.expiry_date = toDateOnly(newItem.expiry_date);
                    }
                    // student_certifications.skills is text[] – convert string to array
                    if (tableName === 'student_certifications' && newItem.skills !== undefined) {
                        if (typeof newItem.skills === 'string') {
                            newItem.skills = newItem.skills.trim()
                                ? newItem.skills.split(',').map(s => s.trim()).filter(Boolean)
                                : [];
                        } else if (!Array.isArray(newItem.skills)) {
                            newItem.skills = [];
                        }
                    }

                     const tablesWithUpdatedAt = [
                         'student_projects',
                         'student_internships',
                         'student_trainings',
                         'student_certifications',
                         'student_publications',
                         'student_extra_curricular_activities',
                         'student_other_experiences',
                         'student_parent_details',
                         'student_summer_internship'
                     ];

                     if (tablesWithUpdatedAt.includes(tableName)) {
                         newItem.updated_at = new Date();
                     }

                     // Remove any keys not in DB to avoid Supabase errors
                     const allowedKeys = {
                         // DB schema: start_year, end_year
                         student_education_history: ['usn', 'education_level', 'institute_name', 'city', 'board', 'start_year', 'end_year', 'result', 'result_type', 'subjects', 'marksheet_file'],
                         student_semester_academics: ['usn', 'academic_year', 'semester', 'result_in_sgpa', 'closed_backlogs', 'live_backlogs', 'provisional_result_upload_links'],
                         student_projects: ['usn', 'title', 'one_line_description', 'full_description', 'genre', 'visibility', 'self_rating', 'admin_rating', 'priority', 'project_snaps', 'hosted_link', 'github_repo', 'mentor_name', 'technologies', 'is_approved', 'updated_at'],
                         student_internships: ['usn', 'job_role', 'organization', 'organization_details', 'duration_months', 'start_date', 'end_date', 'location', 'stipend', 'skills', 'description', 'mentor_name', 'proof_document', 'academic_year', 'updated_at'],
                         student_trainings: ['usn', 'title', 'institution', 'training_type', 'start_date', 'end_date', 'skills', 'description', 'proof_document', 'updated_at'],
                         student_certifications: ['usn', 'title', 'organization', 'certification_type', 'skills', 'score', 'issue_date', 'expiry_date', 'proof_document', 'updated_at'],
                         student_publications: ['usn', 'title', 'publication_name', 'publication_type', 'publication_date', 'author_count', 'mentor_name', 'skills', 'description', 'evidence_document', 'link', 'updated_at'],
                         student_extra_curricular_activities: ['usn', 'activity_name', 'activity_type', 'role', 'organization', 'start_date', 'end_date', 'achievements', 'skills', 'description', 'proof_document', 'updated_at'],
                         student_other_experiences: ['usn', 'title', 'organization', 'start_date', 'end_date', 'location', 'skills', 'description', 'proof_document', 'updated_at'],
                         student_parent_details: ['usn', 'parent_type', 'name', 'occupation', 'organization', 'email', 'phone_country_code', 'phone_number', 'updated_at'],
                         student_summer_internship: ['usn', 'job_role', 'organization', 'organization_details', 'duration_months', 'start_date', 'end_date', 'location', 'stipend', 'skills', 'description', 'mentor_name', 'proof_document', 'academic_year', 'updated_at']
                     };
                     const allowed = allowedKeys[tableName];
                     if (allowed) {
                         const filtered = {};
                         for (const key of allowed) {
                             if (newItem[key] !== undefined) filtered[key] = newItem[key];
                         }
                         newItem = { ...filtered, usn: usn };
                         if (tablesWithUpdatedAt.includes(tableName)) newItem.updated_at = new Date();
                     }

                     return newItem;
                 });

                 // Validate required fields for internships before insert
                 if (tableName === 'student_internships' && itemsToInsert.length > 0) {
                     const invalid = itemsToInsert.find(
                         (row, i) => !String(row.job_role || '').trim() || !String(row.organization || '').trim()
                     );
                     if (invalid) {
                         return res.status(400).json({
                             message: 'Each internship must have Organization and Job Role. Please fill these for every entry.'
                         });
                     }
                     const missingProof = itemsToInsert.find((row) => !row.proof_document || !String(row.proof_document).trim());
                     if (missingProof) {
                         return res.status(400).json({
                             message: 'Each internship must have a Proof document. Please upload a file for every entry.'
                         });
                     }
                 }

                 const { data: inserted, error: insError } = await supabase
                     .from(tableName)
                     .insert(itemsToInsert)
                     .select();
                 
                 if (insError) {
                     console.error(`Supabase insert error for ${tableName}:`, insError);
                     const friendly = getFriendlyMessage(insError);
                     const fallback = tableName === 'student_internships'
                         ? 'Could not save internships. Please ensure each entry has Organization, Job Role, and Proof document.'
                         : tableName === 'student_trainings'
                         ? 'Could not save trainings. Please ensure each entry has Title, Institution, and Proof document.'
                         : 'Could not save. Please check required fields and try again.';
                     return res.status(400).json({ message: friendly || fallback });
                 }
                 result = inserted;
             } else {
                 result = [];
             }
             break;

        default:
             console.log(`Update for section ${section} not fully implemented yet.`);
             result = { message: "Section update not implemented fully yet" };
    }

    res.json(result);
  } catch (error) {
    console.error(`Error updating section ${req.params.section}:`, error);
    const message = getFriendlyMessage(error) || "Something went wrong. Please try again.";
    res.status(400).json({ message });
  }
};
