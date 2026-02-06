const supabase = require('../config/supabaseClient');
const pool = require('../config/db');
const { computeCurrentYearSemester } = require('../utils/studentAcademic');
const { getFriendlyMessage } = require('../utils/constraintErrors');
const { normalizePhoneForDb } = require('../utils/phoneNormalizer');
const {
  sendError,
  sendNotFound,
  sendValidationError,
  sendAccessDenied,
  sendConflict,
  sendCaughtError,
  ERROR_CODES,
} = require('../utils/apiErrorResponse');
const {
  validateRequiredString,
  validateEmail,
  validatePhoneNumber,
  validateCountryCode,
  validateDate,
  validateDateRange,
  validateYear,
  validateEducationLevel,
  validateResultType,
  validateEnum,
  validateNonNegativeInt,
  validatePositiveInt,
  validatePercentage,
  validateSemester,
  validateSgpa,
  validateUrl,
  validateVisibility,
  validateSelfRating,
  validateBloodGroup,
  validateSection,
  validateFullName,
  validateGapDuration,
  GAP_TYPES,
} = require('../utils/profileValidators');

/** Parse provisional_result_upload_links from DB (text) to array for API/frontend */
function parseProvisionalLinks(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val];
  return [];
}

/**
 * Get all schools
 */
exports.getSchools = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('schools')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching schools.');
    }
};

/**
 * Create a school (admin). Body: { name, abbreviation? }
 */
exports.createSchool = async (req, res) => {
    try {
        const body = req.body || {};
        const name = (body.name || '').trim();
        const abbreviation = (body.abbreviation || '').trim() || null;
        if (!name) {
            return sendValidationError(res, 'School name is required.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('schools')
            .insert({ name, abbreviation })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error creating school.');
    }
};

/**
 * Update a school (admin). Body: { name?, abbreviation? }
 */
exports.updateSchool = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid school id.');
        const body = req.body || {};
        const updates = {};
        if (body.name !== undefined) updates.name = (body.name || '').trim() || null;
        if (body.abbreviation !== undefined) updates.abbreviation = (body.abbreviation || '').trim() || null;
        if (Object.keys(updates).length === 0) {
            return sendValidationError(res, 'No fields to update.', {});
        }
        if (updates.name !== undefined && !updates.name) {
            return sendValidationError(res, 'School name cannot be empty.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('schools')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return sendNotFound(res, 'School not found.');
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error updating school.');
    }
};

/**
 * Delete a school (admin). Allowed only if no students are associated (student_basic_details.school_id).
 */
exports.deleteSchool = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid school id.');
        const { count, error: countError } = await supabase
            .from('student_basic_details')
            .select('*', { count: 'exact', head: true })
            .eq('school_id', id);
        if (countError) throw countError;
        if (count > 0) {
            return sendConflict(res, 'Cannot delete school: it has students associated. Remove or reassign students first.');
        }
        const { error } = await supabase.from('schools').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        return sendCaughtError(res, error, 'Server error deleting school.');
    }
};

/**
 * Get all programs
 */
exports.getPrograms = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('programs')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching programs.');
    }
};

/**
 * Create a program (admin). Body: { school_id, name, graduation_level?, min_duration_years?, max_duration_years? }
 */
exports.createProgram = async (req, res) => {
    try {
        const body = req.body || {};
        const schoolId = body.school_id != null ? parseInt(body.school_id, 10) : null;
        const name = (body.name || '').trim();
        const graduationLevel = (body.graduation_level || '').trim() || null;
        const minDuration = body.min_duration_years != null && body.min_duration_years !== '' ? parseInt(body.min_duration_years, 10) : null;
        const maxDuration = body.max_duration_years != null && body.max_duration_years !== '' ? parseInt(body.max_duration_years, 10) : null;
        if (!schoolId || Number.isNaN(schoolId)) {
            return sendValidationError(res, 'School is required.', { school_id: 'Select a school.' });
        }
        if (!name) {
            return sendValidationError(res, 'Program name is required.', { name: 'Name is required.' });
        }
        const { data: school } = await supabase.from('schools').select('id').eq('id', schoolId).maybeSingle();
        if (!school) {
            return sendValidationError(res, 'Invalid school selected.', { school_id: 'School does not exist.' });
        }
        const insertData = { school_id: schoolId, name, graduation_level: graduationLevel };
        if (minDuration != null && !Number.isNaN(minDuration)) insertData.min_duration_years = minDuration;
        if (maxDuration != null && !Number.isNaN(maxDuration)) insertData.max_duration_years = maxDuration;
        const { data, error } = await supabase
            .from('programs')
            .insert(insertData)
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error creating program.');
    }
};

/**
 * Update a program (admin). Body: { name?, graduation_level?, min_duration_years?, max_duration_years? }
 */
exports.updateProgram = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid program id.');
        const body = req.body || {};
        const updates = {};
        if (body.name !== undefined) updates.name = (body.name || '').trim() || null;
        if (body.graduation_level !== undefined) updates.graduation_level = (body.graduation_level || '').trim() || null;
        if (body.min_duration_years !== undefined) {
            const v = body.min_duration_years;
            updates.min_duration_years = (v === '' || v == null) ? null : (parseInt(v, 10) || null);
        }
        if (body.max_duration_years !== undefined) {
            const v = body.max_duration_years;
            updates.max_duration_years = (v === '' || v == null) ? null : (parseInt(v, 10) || null);
        }
        if (Object.keys(updates).length === 0) {
            return sendValidationError(res, 'No fields to update.', {});
        }
        if (updates.name !== undefined && !updates.name) {
            return sendValidationError(res, 'Program name cannot be empty.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('programs')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return sendNotFound(res, 'Program not found.');
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error updating program.');
    }
};

/**
 * Delete a program (admin). Allowed only if no students have this program_id.
 */
exports.deleteProgram = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid program id.');
        const { count, error: countError } = await supabase
            .from('student_basic_details')
            .select('*', { count: 'exact', head: true })
            .eq('program_id', id);
        if (countError) throw countError;
        if (count > 0) {
            return sendConflict(res, 'Cannot delete program: students are associated. Remove or reassign students first.');
        }
        const { error } = await supabase.from('programs').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        return sendCaughtError(res, error, 'Server error deleting program.');
    }
};

/**
 * Get all majors
 */
exports.getMajors = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('majors')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching majors.');
    }
};

/**
 * Create a major (admin). Body: { program_id, name }
 */
exports.createMajor = async (req, res) => {
    try {
        const body = req.body || {};
        const programId = body.program_id != null ? parseInt(body.program_id, 10) : null;
        const name = (body.name || '').trim();
        if (!programId || Number.isNaN(programId)) {
            return sendValidationError(res, 'Program is required.', { program_id: 'Select a program.' });
        }
        if (!name) {
            return sendValidationError(res, 'Major name is required.', { name: 'Name is required.' });
        }
        const { data: program } = await supabase.from('programs').select('id').eq('id', programId).maybeSingle();
        if (!program) {
            return sendValidationError(res, 'Invalid program selected.', { program_id: 'Program does not exist.' });
        }
        const { data, error } = await supabase
            .from('majors')
            .insert({ program_id: programId, name })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error creating major.');
    }
};

/**
 * Update a major (admin). Body: { name? }
 */
exports.updateMajor = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid major id.');
        const body = req.body || {};
        const name = (body.name || '').trim();
        if (name === '') {
            return sendValidationError(res, 'Major name is required.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('majors')
            .update({ name })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return sendNotFound(res, 'Major not found.');
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error updating major.');
    }
};

/**
 * Delete a major (admin). Allowed only if no students have this major_id.
 */
exports.deleteMajor = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid major id.');
        const { count, error: countError } = await supabase
            .from('student_basic_details')
            .select('*', { count: 'exact', head: true })
            .eq('major_id', id);
        if (countError) throw countError;
        if (count > 0) {
            return sendConflict(res, 'Cannot delete major: students are associated. Remove or reassign students first.');
        }
        const { error } = await supabase.from('majors').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        return sendCaughtError(res, error, 'Server error deleting major.');
    }
};

/**
 * Get all minors
 */
exports.getMinors = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('minors')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching minors.');
    }
};

/**
 * Create a minor (admin). Body: { school_id, name }
 */
exports.createMinor = async (req, res) => {
    try {
        const body = req.body || {};
        const schoolId = body.school_id != null ? parseInt(body.school_id, 10) : null;
        const name = (body.name || '').trim();
        if (!schoolId || Number.isNaN(schoolId)) {
            return sendValidationError(res, 'School is required.', { school_id: 'Select a school.' });
        }
        if (!name) {
            return sendValidationError(res, 'Minor name is required.', { name: 'Name is required.' });
        }
        const { data: school } = await supabase.from('schools').select('id').eq('id', schoolId).maybeSingle();
        if (!school) {
            return sendValidationError(res, 'Invalid school selected.', { school_id: 'School does not exist.' });
        }
        const { data, error } = await supabase
            .from('minors')
            .insert({ school_id: schoolId, name })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error creating minor.');
    }
};

/**
 * Update a minor (admin). Body: { name? }
 */
exports.updateMinor = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid minor id.');
        const body = req.body || {};
        const name = (body.name || '').trim();
        if (name === '') {
            return sendValidationError(res, 'Minor name is required.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('minors')
            .update({ name })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return sendNotFound(res, 'Minor not found.');
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error updating minor.');
    }
};

/**
 * Delete a minor (admin). Allowed only if no students have this minor_id.
 */
exports.deleteMinor = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid minor id.');
        const { count, error: countError } = await supabase
            .from('student_basic_details')
            .select('*', { count: 'exact', head: true })
            .eq('minor_id', id);
        if (countError) throw countError;
        if (count > 0) {
            return sendConflict(res, 'Cannot delete minor: students are associated. Remove or reassign students first.');
        }
        const { error } = await supabase.from('minors').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        return sendCaughtError(res, error, 'Server error deleting minor.');
    }
};

/**
 * Get all specializations
 */
exports.getSpecializations = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('specializations')
            .select('*')
            .order('name', { ascending: true });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching specializations.');
    }
};

/**
 * Create a specialization (admin). Body: { program_id, name }
 */
exports.createSpecialization = async (req, res) => {
    try {
        const body = req.body || {};
        const programId = body.program_id != null ? parseInt(body.program_id, 10) : null;
        const name = (body.name || '').trim();
        if (!programId || Number.isNaN(programId)) {
            return sendValidationError(res, 'Program is required.', { program_id: 'Select a program.' });
        }
        if (!name) {
            return sendValidationError(res, 'Specialization name is required.', { name: 'Name is required.' });
        }
        const { data: program } = await supabase.from('programs').select('id').eq('id', programId).maybeSingle();
        if (!program) {
            return sendValidationError(res, 'Invalid program selected.', { program_id: 'Program does not exist.' });
        }
        const { data, error } = await supabase
            .from('specializations')
            .insert({ program_id: programId, name })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error creating specialization.');
    }
};

/**
 * Update a specialization (admin). Body: { name? }
 */
exports.updateSpecialization = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid specialization id.');
        const body = req.body || {};
        const name = (body.name || '').trim();
        if (name === '') {
            return sendValidationError(res, 'Specialization name is required.', { name: 'Name is required.' });
        }
        const { data, error } = await supabase
            .from('specializations')
            .update({ name })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return sendNotFound(res, 'Specialization not found.');
        res.json(data);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error updating specialization.');
    }
};

/**
 * Delete a specialization (admin). Allowed only if no students have this specialization_id.
 */
exports.deleteSpecialization = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return sendValidationError(res, 'Invalid specialization id.');
        const { count, error: countError } = await supabase
            .from('student_basic_details')
            .select('*', { count: 'exact', head: true })
            .eq('specialization_id', id);
        if (countError) throw countError;
        if (count > 0) {
            return sendConflict(res, 'Cannot delete specialization: students are associated. Remove or reassign students first.');
        }
        const { error } = await supabase.from('specializations').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send();
    } catch (error) {
        return sendCaughtError(res, error, 'Server error deleting specialization.');
    }
};

/**
 * Get academy overview: schools with programs, majors, minors, specializations, and student counts
 */
exports.getAcademyOverview = async (req, res) => {
    try {
        const [
            { data: schools, error: schoolsErr },
            { data: programs, error: programsErr },
            { data: majors, error: majorsErr },
            { data: minors, error: minorsErr },
            { data: specializations, error: specErr },
            { data: students, error: studentsErr }
        ] = await Promise.all([
            supabase.from('schools').select('id, name, abbreviation').order('name', { ascending: true }),
            supabase.from('programs').select('id, school_id, name, graduation_level, min_duration_years, max_duration_years').order('name', { ascending: true }),
            supabase.from('majors').select('id, program_id, name').order('name', { ascending: true }),
            supabase.from('minors').select('id, school_id, name').order('name', { ascending: true }),
            supabase.from('specializations').select('id, program_id, name').order('name', { ascending: true }),
            supabase.from('student_basic_details').select('school_id, program_id')
        ]);

        if (schoolsErr) throw schoolsErr;
        if (programsErr) throw programsErr;
        if (majorsErr) throw majorsErr;
        if (minorsErr) throw minorsErr;
        if (specErr) throw specErr;
        if (studentsErr) throw studentsErr;

        const programList = programs || [];
        const majorList = majors || [];
        const minorList = minors || [];
        const specList = specializations || [];
        const studentList = students || [];

        const studentsBySchool = {};
        const studentsByProgram = {};
        studentList.forEach((s) => {
            if (s.school_id != null) {
                studentsBySchool[s.school_id] = (studentsBySchool[s.school_id] || 0) + 1;
            }
            if (s.program_id != null) {
                studentsByProgram[s.program_id] = (studentsByProgram[s.program_id] || 0) + 1;
            }
        });

        const programsBySchool = {};
        programList.forEach((p) => {
            if (!programsBySchool[p.school_id]) programsBySchool[p.school_id] = [];
            programsBySchool[p.school_id].push({
                id: p.id,
                name: p.name,
                graduation_level: p.graduation_level,
                min_duration_years: p.min_duration_years ?? null,
                max_duration_years: p.max_duration_years ?? null,
                majors: (majorList.filter((m) => m.program_id === p.id)).map((m) => ({ id: m.id, name: m.name })),
                specializations: (specList.filter((s) => s.program_id === p.id)).map((s) => ({ id: s.id, name: s.name })),
                totalStudents: studentsByProgram[p.id] || 0
            });
        });

        const minorsBySchool = {};
        minorList.forEach((m) => {
            if (!minorsBySchool[m.school_id]) minorsBySchool[m.school_id] = [];
            minorsBySchool[m.school_id].push({ id: m.id, name: m.name });
        });

        const overview = (schools || []).map((school) => ({
            id: school.id,
            name: school.name,
            abbreviation: school.abbreviation,
            totalStudents: studentsBySchool[school.id] || 0,
            programs: programsBySchool[school.id] || [],
            minors: minorsBySchool[school.id] || []
        }));

        res.json(overview);
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching academy overview.');
    }
};

/**
 * Get list of students (admin/placement) with optional filters and pagination
 */
exports.getStudentsList = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
        const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;
        const yearOfJoining = req.query.year_of_joining ? parseInt(req.query.year_of_joining, 10) : null;
        const isActive = req.query.is_active;
        const sortBy = req.query.sort_by || 'usn';
        const sortOrder = req.query.sort_order === 'desc' ? false : true;

        const selectFields = `
            usn, full_name, college_email, school_id, program_id, major_id, minor_id, specialization_id,
            year_of_joining, current_year, current_semester, section, is_registered, is_active,
            profile_image, created_at,
            schools ( id, name, abbreviation ),
            programs ( id, name, graduation_level ),
            majors ( id, name ),
            minors ( id, name ),
            specializations ( id, name )
        `;

        let query = supabase
            .from('student_basic_details')
            .select(selectFields, { count: 'exact' });

        if (schoolId != null && !Number.isNaN(schoolId)) {
            query = query.eq('school_id', schoolId);
        }
        if (programId != null && !Number.isNaN(programId)) {
            query = query.eq('program_id', programId);
        }
        if (yearOfJoining != null && !Number.isNaN(yearOfJoining)) {
            query = query.eq('year_of_joining', yearOfJoining);
        }
        if (isActive !== undefined && isActive !== '') {
            const active = isActive === 'true' || isActive === '1';
            query = query.eq('is_active', active);
        }
        if (search) {
            query = query.or(`usn.ilike.%${search}%,full_name.ilike.%${search}%,college_email.ilike.%${search}%`);
        }

        const allowedSort = ['usn', 'full_name', 'college_email', 'year_of_joining', 'current_year', 'current_semester', 'created_at'];
        const orderBy = allowedSort.includes(sortBy) ? sortBy : 'usn';
        query = query.order(orderBy, { ascending: sortOrder });
        query = query.range(offset, offset + limit - 1);

        const { data: rows, error, count } = await query;

        if (error) throw error;

        const total = count != null ? count : (rows || []).length;
        res.json({
            students: rows || [],
            total,
            page,
            limit,
            totalPages: Math.ceil((total || 0) / limit)
        });
    } catch (error) {
        return sendCaughtError(res, error, 'Server error fetching students list.');
    }
};

/**
 * Get Personal Profile (Basic Details)
 * GET /profile/:usn/personal
 * Access: Student (own usn only), Admin/Placement (any usn)
 * Ownership enforced by authMiddleware.
 */
exports.getPersonalProfile = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: personal, error } = await supabase
            .from('student_basic_details')
            .select(`
                *,
                schools ( name ),
                programs ( name ),
                majors ( name ),
                minors ( name ),
                specializations ( name )
            `)
            .eq('usn', usn)
            .single();

        if (error && error.code !== 'PGRST116') {
            return sendCaughtError(res, error, 'Failed to fetch personal profile.');
        }

        if (!personal) {
            return sendNotFound(res, 'Student not found.');
        }

        const result = {
            ...personal,
            fullName: personal.full_name,
            schoolId: personal.school_id,
            programId: personal.program_id,
            majorId: personal.major_id,
            minorId: personal.minor_id,
            specializationId: personal.specialization_id,
            schoolName: personal.schools?.name,
            programName: personal.programs?.name,
            majorName: personal.majors?.name,
            minorName: personal.minors?.name,
            specializationName: personal.specializations?.name,
            yearOfJoining: personal.year_of_joining,
            currentYear: personal.current_year,
            currentSemester: personal.current_semester,
            section: personal.section,
            gender: personal.gender,
            dateOfBirth: personal.date_of_birth,
            bloodGroup: personal.blood_group,
            speciallyAbled: personal.specially_abled,
            languages: personal.languages,
            profileImage: personal.profile_image || null,
            personalEmail: personal.personal_email,
            phoneCountryCode: personal.phone_country_code,
            phoneNumber: personal.phone_number,
            optIn: personal.opt_in === true,
            opt_in: personal.opt_in,
            hasAgreedPlacementPolicy: personal.has_agreed_placement_policy === true,
            has_agreed_placement_policy: personal.has_agreed_placement_policy,
        };

        res.json(result);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to fetch personal profile.');
    }
};

/**
 * Update Personal Profile (Basic Details)
 * PUT /profile/:usn/personal
 * Access: Student (own usn only), enforced by authMiddleware.
 * Uses shared validators, apiErrorResponse, business rules (opt-in one-way).
 */
exports.updatePersonalProfile = async (req, res) => {
    try {
        const { usn } = req.params;
        const data = req.body;

        // --- 1. Validation (shared validators) ---
        const fieldErrors = {};

        const fullName = data.fullName ?? data.full_name;
        if (fullName !== undefined) {
            const r = validateFullName(fullName, 'Full name');
            if (!r.valid) fieldErrors.full_name = r.message;
        }

        const personalEmail = data.personalEmail ?? data.personal_email;
        if (personalEmail !== undefined && personalEmail !== '' && personalEmail !== null) {
            const r = validateEmail(personalEmail);
            if (!r.valid) fieldErrors.personal_email = r.message;
        }

        const rawPhone = data.phoneNumber ?? data.phone_number ?? '';
        if (rawPhone !== '' && rawPhone != null) {
            const r = validatePhoneNumber(rawPhone);
            if (!r.valid) fieldErrors.phone_number = r.message;
        }
        const rawCode = data.phoneCountryCode ?? data.phone_country_code ?? '';
        if (rawCode !== '' && rawCode != null) {
            const r = validateCountryCode(rawCode);
            if (!r.valid) fieldErrors.phone_country_code = r.message;
        }

        const dateOfBirth = data.dateOfBirth ?? data.date_of_birth;
        if (dateOfBirth !== undefined && dateOfBirth !== '' && dateOfBirth != null) {
            const r = validateDate(dateOfBirth, { allowEmpty: true });
            if (!r.valid) fieldErrors.date_of_birth = r.message;
        }

        const yearOfJoining = data.yearOfJoining ?? data.year_of_joining;
        if (yearOfJoining !== undefined && yearOfJoining !== '' && yearOfJoining != null) {
            const r = validateYear(yearOfJoining, { allowEmpty: false });
            if (!r.valid) fieldErrors.year_of_joining = r.message;
        }

        const bloodGroup = data.bloodGroup ?? data.blood_group;
        // Make blood group mandatory
        if (bloodGroup === undefined || bloodGroup === '' || bloodGroup == null) {
            fieldErrors.blood_group = 'Blood group is required.';
        } else {
            const r = validateBloodGroup(bloodGroup);
            if (!r.valid) fieldErrors.blood_group = r.message;
        }

        const section = data.section;
        if (section !== undefined && section !== '' && section != null) {
            const r = validateSection(section);
            if (!r.valid) fieldErrors.section = r.message;
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 3. Build update payload ---
        const updateData = { updated_at: new Date() };

        if (data.fullName !== undefined && data.fullName !== null && data.fullName !== '') {
            updateData.full_name = String(data.fullName).trim();
        } else if (data.full_name !== undefined && data.full_name !== null && data.full_name !== '') {
            updateData.full_name = String(data.full_name).trim();
        }
        if (data.section !== undefined) updateData.section = data.section;
        if (data.profileImage !== undefined) updateData.profile_image = data.profileImage;
        if (data.profile_image !== undefined) updateData.profile_image = data.profile_image;
        if (data.gender !== undefined) updateData.gender = data.gender;
        if (data.dateOfBirth !== undefined) updateData.date_of_birth = data.dateOfBirth || null;
        if (data.date_of_birth !== undefined) updateData.date_of_birth = data.date_of_birth || null;
        if (data.bloodGroup !== undefined) updateData.blood_group = data.bloodGroup;
        if (data.blood_group !== undefined) updateData.blood_group = data.blood_group;
        if (data.speciallyAbled !== undefined) updateData.specially_abled = data.speciallyAbled;
        if (data.specially_abled !== undefined) updateData.specially_abled = data.specially_abled;
        if (data.languages !== undefined) updateData.languages = data.languages;

        if (data.schoolId !== undefined) updateData.school_id = data.schoolId;
        if (data.school_id !== undefined) updateData.school_id = data.school_id;
        if (data.programId !== undefined) updateData.program_id = data.programId;
        if (data.program_id !== undefined) updateData.program_id = data.program_id;
        if (data.majorId !== undefined) updateData.major_id = data.majorId ?? null;
        if (data.major_id !== undefined) updateData.major_id = data.major_id ?? null;
        if (data.minorId !== undefined) updateData.minor_id = data.minorId ?? null;
        if (data.minor_id !== undefined) updateData.minor_id = data.minor_id ?? null;
        if (data.specializationId !== undefined) updateData.specialization_id = data.specializationId ?? null;
        if (data.specialization_id !== undefined) updateData.specialization_id = data.specialization_id ?? null;
        if (data.yearOfJoining !== undefined) updateData.year_of_joining = data.yearOfJoining;
        if (data.year_of_joining !== undefined) updateData.year_of_joining = data.year_of_joining;

        if (data.personalEmail !== undefined) updateData.personal_email = data.personalEmail || null;
        if (data.personal_email !== undefined) updateData.personal_email = data.personal_email || null;

        // If client explicitly provided phone fields (even empty), process them so clearing is persisted.
        if (data.phoneNumber !== undefined || data.phone_number !== undefined || data.phoneCountryCode !== undefined || data.phone_country_code !== undefined) {
            const { phone_country_code: normCode, phone_number: normNumber } = normalizePhoneForDb(
                data.phoneCountryCode ?? data.phone_country_code,
                data.phoneNumber ?? data.phone_number
            );
            updateData.phone_country_code = normCode ?? null;
            updateData.phone_number = normNumber ?? null;
        }

        // --- 4. FK validation: school_id, program_id, major_id, minor_id, specialization_id ---
        if (updateData.school_id != null) {
            const { data: school } = await supabase.from('schools').select('id').eq('id', updateData.school_id).maybeSingle();
            if (!school) {
                return sendValidationError(res, 'Invalid school selected.', { school_id: 'School does not exist.' });
            }
        }
        if (updateData.program_id != null) {
            const { data: program } = await supabase.from('programs').select('id').eq('id', updateData.program_id).maybeSingle();
            if (!program) {
                return sendValidationError(res, 'Invalid program selected.', { program_id: 'Program does not exist.' });
            }
        }
        if (updateData.major_id != null) {
            const { data: major } = await supabase.from('majors').select('id').eq('id', updateData.major_id).maybeSingle();
            if (!major) {
                return sendValidationError(res, 'Invalid major selected.', { major_id: 'Major does not exist.' });
            }
        }
        if (updateData.minor_id != null) {
            const { data: minor } = await supabase.from('minors').select('id').eq('id', updateData.minor_id).maybeSingle();
            if (!minor) {
                return sendValidationError(res, 'Invalid minor selected.', { minor_id: 'Minor does not exist.' });
            }
        }
        if (updateData.specialization_id != null) {
            const { data: spec } = await supabase.from('specializations').select('id').eq('id', updateData.specialization_id).maybeSingle();
            if (!spec) {
                return sendValidationError(res, 'Invalid specialization selected.', { specialization_id: 'Specialization does not exist.' });
            }
        }

        // --- 5. Business rules: opt-in one-way, has_agreed_placement_policy, eligibility ---
        if (data.optIn !== undefined || data.opt_in !== undefined) {
            const requestedOptIn = data.optIn === true || data.opt_in === true;
            const { data: currentRow } = await supabase.from('student_basic_details').select('opt_in').eq('usn', usn).maybeSingle();
            if (currentRow?.opt_in === true && !requestedOptIn) {
                // One-way: cannot revert opt-in
                delete updateData.opt_in;
            } else if (requestedOptIn && !currentRow?.opt_in) {
                // Only validate when changing from NOT opted-in to opted-in
                // Fetch merged row (incoming + current) for eligibility
                const merged = { ...updateData };
                const { data: current } = await supabase
                    .from('student_basic_details')
                    .select('school_id, program_id, year_of_joining, full_name, personal_email, phone_number')
                    .eq('usn', usn)
                    .maybeSingle();
                const effective = { ...current, ...merged };
                if (!effective.school_id || effective.program_id == null || effective.year_of_joining == null) {
                    return sendError(res, 400, 'Complete your academic details (school, program, year) before opting in.', { errorCode: ERROR_CODES.OPT_IN_ELIGIBILITY });
                }
                const { data: policy } = await supabase
                    .from('batch_academic_policies')
                    .select('placement, capstone')
                    .eq('school_id', effective.school_id)
                    .eq('program_id', effective.program_id)
                    .eq('joining_year', effective.year_of_joining)
                    .maybeSingle();
                if (!policy || (!policy.placement && !policy.capstone)) {
                    return sendError(res, 400, 'Your batch does not allow placement or capstone track.', { errorCode: ERROR_CODES.OPT_IN_ELIGIBILITY });
                }
                const hasName = !!(effective.full_name && String(effective.full_name).trim().length >= 2);
                const hasContact = !!(effective.personal_email && String(effective.personal_email).trim()) ||
                    !!(effective.phone_number && String(effective.phone_number).trim());
                if (!hasName || !hasContact) {
                    return sendError(res, 400, 'Profile must have full name and at least one contact (email or phone) before opting in.', { errorCode: ERROR_CODES.OPT_IN_ELIGIBILITY });
                }
                const mustAgree = data.hasAgreedPlacementPolicy === true || data.has_agreed_placement_policy === true;
                if (!mustAgree) {
                    return sendError(res, 400, 'You must agree to the placement policy before opting in.', { errorCode: ERROR_CODES.OPT_IN_ELIGIBILITY });
                }
                updateData.opt_in = true;
            }
        }
        if (data.hasAgreedPlacementPolicy !== undefined) updateData.has_agreed_placement_policy = data.hasAgreedPlacementPolicy === true;
        if (data.has_agreed_placement_policy !== undefined) updateData.has_agreed_placement_policy = data.has_agreed_placement_policy === true;

        // --- 6. Clean undefined/null (keep profile_image null for clear)
        // Allow explicit nulls for specific contact fields so users can clear them.
        Object.keys(updateData).forEach((key) => {
            if (key === 'updated_at') return;
            if (key === 'profile_image' && updateData[key] === null) return;
            // Keep explicit nulls for contact fields so clearing is persisted
            if ((key === 'personal_email' || key === 'phone_country_code' || key === 'phone_number') && updateData[key] === null) return;
            if (updateData[key] === undefined || updateData[key] === null) delete updateData[key];
        });

        // --- 7. Ensure required fields (merge from current if missing) ---
        if (!updateData.full_name || !updateData.school_id || !updateData.program_id || updateData.year_of_joining === undefined) {
            const { data: current } = await supabase
                .from('student_basic_details')
                .select('full_name, school_id, program_id, year_of_joining')
                .eq('usn', usn)
                .single();
            if (current) {
                if (!updateData.full_name) updateData.full_name = current.full_name;
                if (!updateData.school_id) updateData.school_id = current.school_id;
                if (!updateData.program_id) updateData.program_id = current.program_id;
                if (updateData.year_of_joining === undefined) updateData.year_of_joining = current.year_of_joining;
            }
        }
        if (updateData.year_of_joining != null) {
            const { current_year, current_semester } = computeCurrentYearSemester(updateData.year_of_joining, 4);
            updateData.current_year = current_year;
            updateData.current_semester = current_semester;
        }

        // --- 8. Execute update ---
        let result = await supabase
            .from('student_basic_details')
            .update(updateData)
            .eq('usn', usn)
            .select()
            .single();

        let dbError = result.error;
        if (dbError && (dbError.code === 'PGRST204' || (dbError.message && dbError.message.includes('profile_image')))) {
            delete updateData.profile_image;
            result = await supabase.from('student_basic_details').update(updateData).eq('usn', usn).select().single();
            dbError = result.error;
        }

        if (dbError) {
            if (dbError.message && (dbError.message.includes('profile_image') || dbError.message.includes('column') || dbError.code === '42703')) {
                return sendError(res, 500, 'Database schema needs update. Please run migration to add profile_image column.', { errorCode: ERROR_CODES.SERVER });
            }
            return sendCaughtError(res, dbError, 'Failed to update personal profile.');
        }

        res.json(result.data);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update personal profile.');
    }
};

/**
 * Get Contact Profile
 * GET /profile/:usn/contact
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getContactProfile = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: contact, error } = await supabase
            .from('student_basic_details')
            .select('personal_email, college_email, phone_country_code, phone_number, social_links')
            .eq('usn', usn)
            .single();

        if (error && error.code !== 'PGRST116') {
            return sendCaughtError(res, error, 'Failed to load contact details.');
        }

        if (!contact) {
            return sendNotFound(res, 'Student not found.');
        }

        const result = {
            personalEmail: contact.personal_email,
            collegeEmail: contact.college_email,
            phoneCountryCode: contact.phone_country_code,
            phoneNumber: contact.phone_number,
            links: contact.social_links || []
        };

        res.json(result);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load contact details.');
    }
};

/**
 * Update Contact Profile
 * PUT /profile/:usn/contact
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Uses shared validators and apiErrorResponse.
 */
exports.updateContactProfile = async (req, res) => {
    try {
        const { usn } = req.params;
        const data = req.body;

        // --- 1. Load current contact to check if this is first save ---
        const { data: currentContact, error: loadErr } = await supabase
            .from('student_basic_details')
            .select('personal_email, phone_number')
            .eq('usn', usn)
            .single();

        if (loadErr && loadErr.code !== 'PGRST116') {
            return sendCaughtError(res, loadErr, 'Failed to load current contact.');
        }

        const isFirstSave = !currentContact || (!currentContact.personal_email && !currentContact.phone_number);

        // --- 2. Validation (shared validators) ---
        const fieldErrors = {};

        const personalEmail = data.personalEmail ?? data.personal_email;
        const rawNum = (data.phoneNumber ?? data.phone_number) ?? '';
        const rawCode = (data.phoneCountryCode ?? data.phone_country_code) ?? '';

        // Email and phone are ALWAYS mandatory (never allow null/empty)
        if (!personalEmail || personalEmail === '') {
            fieldErrors.personal_email = 'Personal email is required.';
        } else {
            const r = validateEmail(personalEmail);
            if (!r.valid) fieldErrors.personal_email = r.message;
        }
        if (!rawNum || rawNum === '') {
            fieldErrors.phone_number = 'Phone number is required.';
        } else {
            const r = validatePhoneNumber(rawNum);
            if (!r.valid) fieldErrors.phone_number = r.message;
        }

        if (rawCode !== '' && rawCode != null) {
            const r = validateCountryCode(rawCode);
            if (!r.valid) fieldErrors.phone_country_code = r.message;
        }

        // Validate links URLs
        const links = data.links;
        if (Array.isArray(links) && links.length > 0) {
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                if (link && link.url) {
                    const r = validateUrl(link.url);
                    if (!r.valid) {
                        fieldErrors.links = `Link "${link.name || i + 1}": ${r.message}`;
                        break; // Report first invalid link
                    }
                }
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 2. Normalize phone for DB ---
        const { phone_country_code: normCode, phone_number: normNumber } = normalizePhoneForDb(rawCode, rawNum);
        if (rawNum !== '' && rawNum != null && normNumber === undefined) {
            return sendValidationError(res, 'Please enter a valid phone number (10 digits).', { phone_number: 'Please enter a valid phone number (e.g. 1234567890). Use 10 digits only.' });
        }

        const updateData = {
            phone_country_code: normCode !== undefined ? normCode : (rawCode === '' ? null : rawCode),
            phone_number: normNumber !== undefined ? normNumber : (rawNum === '' ? null : rawNum),
            social_links: data.links ?? [],
            updated_at: new Date()
        };

        // Only set personal_email if client explicitly provided it (including empty to clear)
        if (data.personalEmail !== undefined || data.personal_email !== undefined) {
            updateData.personal_email = (data.personalEmail ?? data.personal_email) || null;
        }

        const { data: updatedContact, error } = await supabase
            .from('student_basic_details')
            .update(updateData)
            .eq('usn', usn)
            .select('personal_email, college_email, phone_country_code, phone_number, social_links')
            .single();

        if (error) {
            return sendCaughtError(res, error, 'Failed to update contact details.');
        }

        const result = {
            personalEmail: updatedContact.personal_email,
            collegeEmail: updatedContact.college_email,
            phoneCountryCode: updatedContact.phone_country_code,
            phoneNumber: updatedContact.phone_number,
            links: updatedContact.social_links || []
        };

        res.json(result);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update contact details.');
    }
};

/**
 * Get Summer Immersion (1:N list)
 * GET /profile/:usn/summer-immersion or /profile/:usn/summer_immersion
 * Table: student_summer_immersion. Allowed only if batch_academic_policies.summer_immersion = true.
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getSummerImmersion = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: student, error: studentErr } = await supabase
            .from('student_basic_details')
            .select('school_id, program_id, year_of_joining')
            .eq('usn', usn)
            .maybeSingle();

        if (studentErr) {
            return sendCaughtError(res, studentErr, 'Failed to load student.');
        }
        if (!student) {
            return sendNotFound(res, 'Student not found.');
        }

        const { data: policy, error: policyErr } = await supabase
            .from('batch_academic_policies')
            .select('summer_immersion')
            .eq('school_id', student.school_id)
            .eq('program_id', student.program_id)
            .eq('joining_year', student.year_of_joining)
            .maybeSingle();

        if (policyErr) {
            return sendCaughtError(res, policyErr, 'Failed to check batch policy.');
        }
        if (!policy || !policy.summer_immersion) {
            console.error('[Summer Immersion] Policy error: not enabled for batch', { usn, school_id: student.school_id, program_id: student.program_id });
            return sendError(res, 400, 'Summer Immersion is not enabled for your batch.', { errorCode: ERROR_CODES.VALIDATION });
        }

        const { data: rows, error } = await supabase
            .from('student_summer_immersion')
            .select('*')
            .eq('usn', usn)
            .order('start_date', { ascending: false, nullsFirst: false });

        if (error) {
            console.error('[Summer Immersion] GET error:', { usn, error: error.message });
            return sendCaughtError(res, error, 'Failed to load Summer Immersion records.');
        }

        res.json(rows || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load Summer Immersion.');
    }
};

/**
 * Update Summer Immersion (replace full list)
 * PUT /profile/:usn/summer-immersion or /profile/:usn/summer_immersion
 * Table: student_summer_immersion. Validation: job_role, organization required; duration_weeks positive integer; start_date/end_date valid range.
 * Business: allowed only if batch_academic_policies.summer_immersion = true; student can modify only their own records (authMiddleware).
 * Error handling: apiErrorResponse helpers.
 */
exports.updateSummerImmersion = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        const role = (req.user && req.user.role && String(req.user.role).toLowerCase()) || '';
        const isStudent = role === 'student';
        if (isStudent && req.user && req.user.usn && String(req.user.usn).toLowerCase() !== String(usn).toLowerCase()) {
            return sendAccessDenied(res, 'You can only modify your own Summer Immersion records.');
        }

        const { data: student, error: studentErr } = await supabase
            .from('student_basic_details')
            .select('school_id, program_id, year_of_joining')
            .eq('usn', usn)
            .maybeSingle();

        if (studentErr) {
            return sendCaughtError(res, studentErr, 'Failed to load student.');
        }
        if (!student) {
            return sendNotFound(res, 'Student not found.');
        }

        const { data: policy, error: policyErr } = await supabase
            .from('batch_academic_policies')
            .select('summer_immersion')
            .eq('school_id', student.school_id)
            .eq('program_id', student.program_id)
            .eq('joining_year', student.year_of_joining)
            .maybeSingle();

        if (policyErr) {
            return sendCaughtError(res, policyErr, 'Failed to check batch policy.');
        }
        if (!policy || !policy.summer_immersion) {
            console.error('[Summer Immersion] PUT policy error: not enabled for batch', { usn });
            return sendError(res, 400, 'Summer Immersion is not enabled for your batch.', { errorCode: ERROR_CODES.VALIDATION });
        }

        if (!Array.isArray(data)) {
            if (data && data.summer_immersion && Array.isArray(data.summer_immersion)) {
                data = data.summer_immersion;
            } else if (data && data.summerImmersion && Array.isArray(data.summerImmersion)) {
                data = data.summerImmersion;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of Summer Immersion entries.', {
                    payload: 'Expected array or { summer_immersion: [...] } or { summerImmersion: [...] }.'
                });
            }
        }

        const fieldErrors = {};
        const key = (i, f) => `summer_immersion[${i}].${f}`;
        const toDateOnly = (val) => {
            if (val == null || val === '') return null;
            const s = String(val).trim().split('T')[0];
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        };

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.job_role ?? item.jobRole) && !v(item.organization) &&
                !v(item.organization_details ?? item.organizationDetails) &&
                (item.duration_weeks ?? item.durationWeeks ?? '') === '' &&
                !v(item.start_date ?? item.startDate) && !v(item.end_date ?? item.endDate) &&
                !v(item.location) && (item.stipend ?? '') === '' && !v(item.skills) &&
                !v(item.description) && !v(item.mentor_name ?? item.mentorName) &&
                !v(item.proof_document ?? item.proofDocument) && !v(item.academic_year ?? item.academicYear);
        };

        for (let i = 0; i < data.length; i++) {
            const rawItem = data[i] || {};
            const item = {
                ...rawItem,
                organization: (rawItem.organization ?? rawItem.Organization ?? '').toString().trim(),
                job_role: (rawItem.job_role ?? rawItem.jobRole ?? '').toString().trim(),
                jobRole: rawItem.jobRole ?? rawItem.job_role ?? ''
            };
            if (isItemEmpty(item)) continue;

            const jobRole = item.job_role || item.jobRole || '';
            const organization = item.organization || '';
            const durationWeeks = item.duration_weeks ?? item.durationWeeks;
            const startDate = item.start_date ?? item.startDate;
            const endDate = item.end_date ?? item.endDate;

            if (!jobRole) fieldErrors[key(i, 'job_role')] = 'Job role is required.';
            if (!organization) fieldErrors[key(i, 'organization')] = 'Organization is required.';
            if (durationWeeks !== undefined && durationWeeks !== null && durationWeeks !== '') {
                const n = parseInt(String(durationWeeks), 10);
                if (Number.isNaN(n) || n < 1) {
                    fieldErrors[key(i, 'duration_weeks')] = 'Duration (weeks) must be a positive integer.';
                }
            }
            if (startDate !== undefined && startDate !== null && startDate !== '' && endDate !== undefined && endDate !== null && endDate !== '') {
                const r = validateDateRange(startDate, endDate);
                if (!r.valid) fieldErrors[key(i, 'end_date')] = r.message || 'End date cannot be earlier than start date.';
            }
            if (startDate !== undefined && startDate !== null && startDate !== '') {
                const r = validateDate(startDate, { allowEmpty: false });
                if (!r.valid) fieldErrors[key(i, 'start_date')] = r.message;
            }
            if (endDate !== undefined && endDate !== null && endDate !== '') {
                const r = validateDate(endDate, { allowEmpty: false });
                if (!r.valid) fieldErrors[key(i, 'end_date')] = r.message;
            }
            const mentorName = (item.mentor_name ?? item.mentorName ?? '').toString().trim();
            if (mentorName) {
                const rMentor = validateFullName(mentorName, 'Mentor name');
                if (!rMentor.valid) fieldErrors[key(i, 'mentor_name')] = rMentor.message;
            }
            const stipendVal = item.stipend ?? '';
            if (stipendVal !== '' && stipendVal != null && stipendVal !== undefined) {
                const n = Number(stipendVal);
                if (!Number.isFinite(n) || n < 0) {
                    fieldErrors[key(i, 'stipend')] = 'Stipend must be a valid non-negative number.';
                } else {
                    const str = String(stipendVal).replace(/\./g, '');
                    if (str.length > 15) {
                        fieldErrors[key(i, 'stipend')] = 'Stipend cannot exceed 15 digits.';
                    } else if (n > 999999999999) {
                        fieldErrors[key(i, 'stipend')] = 'Stipend cannot exceed 999,999,999,999.';
                    }
                }
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            const sortedErrors = Object.keys(fieldErrors).sort().reduce((acc, k) => { acc[k] = fieldErrors[k]; return acc; }, {});
            console.error('[Summer Immersion] Validation errors (a-z):', JSON.stringify(sortedErrors, null, 2));
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        const { error: delError } = await supabase.from('student_summer_immersion').delete().eq('usn', usn);
        if (delError) {
            return sendCaughtError(res, delError, 'Failed to update Summer Immersion.');
        }

        const dataToInsert = data.filter((item) => !isItemEmpty(item));
        if (dataToInsert.length === 0) {
            return res.json([]);
        }

        const allowedKeys = ['usn', 'job_role', 'organization', 'organization_details', 'duration_weeks', 'start_date', 'end_date', 'location', 'stipend', 'skills', 'description', 'mentor_name', 'proof_document', 'academic_year', 'updated_at'];
        const camelToSnake = [
            ['jobRole', 'job_role'], ['organizationDetails', 'organization_details'], ['durationWeeks', 'duration_weeks'],
            ['startDate', 'start_date'], ['endDate', 'end_date'], ['mentorName', 'mentor_name'],
            ['proofDocument', 'proof_document'], ['academicYear', 'academic_year']
        ];

        const rowsToInsert = dataToInsert.map((item) => {
            const raw = { ...item };
            for (const [camel, snake] of camelToSnake) {
                const v = raw[camel] ?? raw[snake];
                if (v !== undefined && v !== null) raw[snake] = v;
            }
            const jobRoleVal = (raw.job_role ?? raw.jobRole ?? '').toString().trim();
            const orgVal = (raw.organization ?? raw.Organization ?? '').toString().trim();
            const row = { usn };
            for (const key of allowedKeys) {
                if (key === 'usn') continue;
                const v = raw[key];
                if (v === undefined) continue;
                if (v === '' || v === null) {
                    row[key] = null;
                    continue;
                }
                if (key === 'start_date' || key === 'end_date') {
                    row[key] = toDateOnly(v);
                    continue;
                }
                if (key === 'duration_weeks') {
                    const n = parseInt(String(v), 10);
                    row[key] = Number.isInteger(n) && n >= 1 ? n : null;
                    continue;
                }
                if (key === 'stipend') {
                    const n = Number(v);
                    if (!Number.isFinite(n) || n < 0 || n > 999999999999) {
                        row[key] = null;
                    } else {
                        row[key] = n;
                    }
                    continue;
                }
                row[key] = v;
            }
            row.job_role = jobRoleVal || '';
            row.organization = orgVal || '';
            row.updated_at = new Date();
            return row;
        });

        let inserted;
        let insertErr;
        try {
            const result = await supabase
                .from('student_summer_immersion')
                .insert(rowsToInsert)
                .select();
            inserted = result.data;
            insertErr = result.error;
        } catch (insertEx) {
            console.error('[Summer Immersion] INSERT exception:', { usn, error: insertEx?.message, stack: insertEx?.stack });
            return sendCaughtError(res, insertEx, 'Failed to save Summer Immersion.');
        }

        if (insertErr) {
            console.error('[Summer Immersion] INSERT error:', { usn, error: insertErr.message, code: insertErr.code, details: insertErr.details });
            return sendCaughtError(res, insertErr, 'Failed to save Summer Immersion.');
        }

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update Summer Immersion.');
    }
};

/**
 * Get Publications Profile
 * GET /profile/:usn/publications
 * Returns all publications for the student (1:N, student_publications).
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 */
exports.getPublicationsProfile = async (req, res) => {
    try {
        const { usn } = req.params;
        const { data, error } = await supabase
            .from('student_publications')
            .select('*')
            .eq('usn', usn)
            .order('publication_date', { ascending: false });

        if (error) return sendCaughtError(res, error, 'Failed to load publications.');
        res.json(data || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load publications.');
    }
};

/**
 * Update Publications Profile
 * PUT /profile/:usn/publications
 * Accepts array or { publications: [...] } or { data: [...] }.
 * Bulk-replace: delete existing + insert validated rows.
 * Validation: title (required), publication_type (required), publication_date (valid date), author_count (positive integer).
 * Business: student can modify only their own publications; duplicate title + publication_date prevented.
 * Error handling: apiErrorResponse with publications[index].fieldErrors.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 */
exports.updatePublications = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        if (!Array.isArray(data)) {
            if (data && data.publications && Array.isArray(data.publications)) {
                data = data.publications;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of publication entries.', {
                    payload: 'Expected array or { publications: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_publications').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update publications.');
            return res.json([]);
        }

        const fieldErrors = {};
        const itemsToInsert = [];
        const key = (i, f) => `publications[${i}].${f}`;

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.title) && !v(item.publication_type) && !v(item.publication_name) &&
                !v(item.publication_date) && (item.author_count == null || item.author_count === '') &&
                !v(item.mentor_name) && !v(item.skills) && !v(item.description) && !v(item.evidence_document) && !v(item.link);
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            if (isItemEmpty(item)) continue;

            const title = (item.title ?? '').toString().trim();
            const rTitle = validateRequiredString(title, 'Title', 1);
            if (!rTitle.valid) fieldErrors[key(i, 'title')] = rTitle.message;

            const publicationType = (item.publication_type ?? item.publicationType ?? '').toString().trim();
            const rType = validateRequiredString(publicationType, 'Publication type', 1);
            if (!rType.valid) fieldErrors[key(i, 'publication_type')] = rType.message;

            const publicationDateRaw = item.publication_date ?? item.publicationDate;
            if (publicationDateRaw != null && publicationDateRaw !== '') {
                const rDate = validateDate(publicationDateRaw, { allowEmpty: true });
                if (!rDate.valid) fieldErrors[key(i, 'publication_date')] = rDate.message;
            }

            const authorCount = item.author_count ?? item.authorCount;
            const rAuthor = validatePositiveInt(authorCount, 'Author count');
            if (!rAuthor.valid) fieldErrors[key(i, 'author_count')] = rAuthor.message;
            if (authorCount == null || authorCount === '') {
                fieldErrors[key(i, 'author_count')] = 'Author count is required.';
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`publications[${i}].`))) continue;

            const pubDateNorm = publicationDateRaw != null && publicationDateRaw !== ''
                ? String(publicationDateRaw).trim().split('T')[0]
                : null;
            const mappedItem = {
                usn,
                title: title || null,
                publication_name: (item.publication_name ?? item.publicationName ?? '') || null,
                publication_type: publicationType || null,
                publication_date: /^\d{4}-\d{2}-\d{2}$/.test(pubDateNorm || '') ? pubDateNorm : null,
                author_count: authorCount != null && authorCount !== '' ? parseInt(String(authorCount), 10) : null,
                mentor_name: (item.mentor_name ?? item.mentorName ?? '') || null,
                skills: (item.skills ?? '') || null,
                description: (item.description ?? '') || null,
                evidence_document: (item.evidence_document ?? item.evidenceDocument ?? '') || null,
                link: (item.link ?? '') || null,
                updated_at: new Date()
            };
            if (mappedItem.author_count != null && mappedItem.author_count < 1) mappedItem.author_count = 1;
            if (mappedItem.title) {
                itemsToInsert.push({
                    ...mappedItem,
                    _normTitle: (mappedItem.title || '').toLowerCase(),
                    _normDate: mappedItem.publication_date || '',
                    _dataIndex: i
                });
            }
        }

        const seen = new Map();
        for (const row of itemsToInsert) {
            const sig = `${(row._normTitle || '').toLowerCase()}|${row._normDate || ''}`;
            const dataIndex = row._dataIndex;
            if (seen.has(sig)) {
                fieldErrors[key(dataIndex, 'title')] = 'Duplicate: same title and publication date as another entry.';
            } else {
                seen.set(sig, dataIndex);
            }
        }
        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        const { error: delError } = await supabase.from('student_publications').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update publications.');

        const toInsert = itemsToInsert.map(({ _normTitle, _normDate, _dataIndex, ...rest }) => rest);
        const { data: inserted, error: insError } = await supabase
            .from('student_publications')
            .insert(toInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save publications.');

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update publications.');
    }
};

/**
 * Update Education Profile
 * PUT /profile/:usn/education
 * Accepts array or { education: [...] } or { data: [...] }.
 * Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 */
exports.updateEducation = async (req, res) => {
    try {
        const { usn } = req.params;
        let payload = req.body;

        // Accept:
        // - legacy: array or { education: [...] } -> education_history
        // - new: { education_history: [...], education_gaps: [...] }
        // - wrapped: { education: { education_history, education_gaps } }
        let educationHistory = [];
        let educationGaps = [];

        if (Array.isArray(payload)) {
            educationHistory = payload;
        } else if (payload && Array.isArray(payload.education)) {
            educationHistory = payload.education;
        } else if (payload && payload.education && typeof payload.education === 'object') {
            educationHistory = Array.isArray(payload.education.education_history) ? payload.education.education_history : [];
            educationGaps = Array.isArray(payload.education.education_gaps) ? payload.education.education_gaps : [];
        } else if (payload && (payload.education_history || payload.education_gaps)) {
            educationHistory = Array.isArray(payload.education_history) ? payload.education_history : [];
            educationGaps = Array.isArray(payload.education_gaps) ? payload.education_gaps : [];
        } else if (payload && Array.isArray(payload.data)) {
            educationHistory = payload.data;
        } else {
            return sendValidationError(res, 'Invalid data format. Expected education_history and/or education_gaps.', {
                payload: 'Expected array, { education: [...] }, { education_history: [...], education_gaps: [...] }, or { education: { education_history, education_gaps } }.'
            });
        }

        // If both empty, clear both tables
        if (educationHistory.length === 0 && educationGaps.length === 0) {
            const [delHist, delGaps] = await Promise.all([
                supabase.from('student_education_history').delete().eq('usn', usn),
                supabase.from('student_education_gaps').delete().eq('usn', usn)
            ]);
            if (delHist.error) return sendCaughtError(res, delHist.error, 'Failed to update education history.');
            if (delGaps.error) return sendCaughtError(res, delGaps.error, 'Failed to update education gaps.');
            return res.json({ education_history: [], education_gaps: [] });
        }

        // --- 3. Validate each item, collect fieldErrors ---
        const fieldErrors = {};
        const historyToInsert = [];
        const gapsToInsert = [];

        const isHistoryItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.educationLevel) && !v(item.education_level) && !v(item.instituteName) && !v(item.institute_name) &&
                !v(item.city) && !v(item.board) && !v(item.boardOrUniversity) && !v(item.yearOfPassing) && !v(item.year_of_passing) &&
                !v(item.result) && !v(item.result_value) && !v(item.resultType) && !v(item.result_type) && !v(item.subjects) &&
                !v(item.proofFile) && !v(item.marksheet_file);
        };

        for (let i = 0; i < educationHistory.length; i++) {
            const item = educationHistory[i] || {};
            const key = (f) => `education_history[${i}].${f}`;

            if (isHistoryItemEmpty(item)) continue;

            const educationLevel = item.educationLevel ?? item.education_level;
            const rRequired = validateRequiredString(educationLevel, 'Education level', 1);
            if (!rRequired.valid) {
                fieldErrors[key('education_level')] = rRequired.message;
            } else {
                const rLevel = validateEducationLevel(educationLevel);
                if (!rLevel.valid) fieldErrors[key('education_level')] = rLevel.message;
            }

            const yearOfPassing = item.yearOfPassing ?? item.year_of_passing ?? item.end_year;
            if (yearOfPassing != null && yearOfPassing !== '') {
                const rYear = validateYear(yearOfPassing, { allowEmpty: true, max: new Date().getFullYear() });
                if (!rYear.valid) fieldErrors[key('year_of_passing')] = rYear.message;
            }

            const resultVal = item.result ?? item.result_value;
            const resultTypeRaw = (item.resultType ?? item.result_type ?? '').toString().toUpperCase().trim();
            if (resultVal != null && resultVal !== '') {
                const n = parseFloat(String(resultVal));
                if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) {
                    fieldErrors[key('result')] = 'Result must be a valid number (0 or greater).';
                } else if (resultTypeRaw === 'CGPA' && n > 10) {
                    fieldErrors[key('result')] = 'CGPA must be between 0 and 10.';
                } else if ((resultTypeRaw === 'PERCENTAGE' || !resultTypeRaw) && n > 100) {
                    fieldErrors[key('result')] = 'Percentage must be between 0 and 100.';
                }
            }

            if (resultTypeRaw) {
                const rResultType = validateResultType(item.resultType ?? item.result_type);
                if (!rResultType.valid) fieldErrors[key('result_type')] = rResultType.message;
            }

            // Validate subjects - must be text only (no numbers)
            const subjects = item.subjects;
            if (subjects !== undefined && subjects !== null && subjects !== '') {
                const subjectsStr = String(subjects).trim();
                if (subjectsStr) {
                    // Check if subjects contains any numbers
                    if (/\d/.test(subjectsStr)) {
                        fieldErrors[key('subjects')] = 'Subjects cannot contain numbers. Please enter only text (e.g., Physics, Chemistry, Mathematics).';
                    } else if (!/^[a-zA-Z\s,.\-&()]+$/.test(subjectsStr)) {
                        fieldErrors[key('subjects')] = 'Subjects can only contain letters, spaces, commas, periods, hyphens, ampersands, and parentheses.';
                    }
                }
            }
            if (Object.keys(fieldErrors).some((k) => k.startsWith(`education_history[${i}].`))) continue;

            const mappedItem = {
                usn,
                education_level: (educationLevel ?? '').toString().trim() || null,
                institute_name: (item.instituteName ?? item.institute_name ?? '') || null,
                city: (item.city ?? '') || null,
                board: (item.board ?? item.boardOrUniversity ?? '') || null,
                // DB schema uses start_year/end_year (not year_of_passing). Treat "Year of Passing" as end_year.
                end_year: yearOfPassing != null && yearOfPassing !== '' ? parseInt(String(yearOfPassing), 10) : null,
                result: resultVal != null && resultVal !== '' ? parseFloat(resultVal) : null,
                result_type: resultTypeRaw === 'PERCENTAGE' || resultTypeRaw === 'CGPA' ? resultTypeRaw : null,
                subjects: (item.subjects ?? '') || null,
                marksheet_file: (item.proofFile ?? item.marksheet_file ?? '') || null
            };
            Object.keys(mappedItem).forEach((k) => {
                if (mappedItem[k] === null && k !== 'usn' && k !== 'education_level') delete mappedItem[k];
                if (mappedItem[k] === '') mappedItem[k] = null;
            });
            if (mappedItem.education_level) historyToInsert.push(mappedItem);
        }

        // Validate gaps (separate table)
        const isGapEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.gap_start_date) && !v(item.gapStartDate) && !v(item.gap_end_date) && !v(item.gapEndDate) &&
                !v(item.gap_reason) && !v(item.gapReason) && !v(item.remarks);
        };
        const normDate = (val) => {
            if (val == null || val === '') return '';
            const s = String(val).trim().split('T')[0];
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
        };
        for (let i = 0; i < educationGaps.length; i++) {
            const item = educationGaps[i] || {};
            const key = (f) => `education_gaps[${i}].${f}`;
            if (isGapEmpty(item)) continue;

            const start = normDate(item.gap_start_date ?? item.gapStartDate);
            const end = normDate(item.gap_end_date ?? item.gapEndDate);
            const reason = (item.gap_reason ?? item.gapReason ?? '').toString().trim();
            const remarks = (item.remarks ?? '').toString().trim();

            if (!start) fieldErrors[key('gap_start_date')] = 'Start date is required (YYYY-MM-DD).';
            if (!end) fieldErrors[key('gap_end_date')] = 'End date is required (YYYY-MM-DD).';
            if (!reason) fieldErrors[key('gap_reason')] = 'Reason is required.';
            if (start && end) {
                const sd = new Date(start);
                const ed = new Date(end);
                if (Number.isNaN(sd.getTime())) fieldErrors[key('gap_start_date')] = 'Invalid start date.';
                if (Number.isNaN(ed.getTime())) fieldErrors[key('gap_end_date')] = 'Invalid end date.';
                if (!Number.isNaN(sd.getTime()) && !Number.isNaN(ed.getTime()) && ed < sd) {
                    fieldErrors[key('gap_end_date')] = 'End date cannot be earlier than start date.';
                }
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`education_gaps[${i}].`))) continue;

            gapsToInsert.push({
                usn,
                gap_start_date: start,
                gap_end_date: end,
                gap_reason: reason,
                ...(remarks ? { remarks } : {})
            });
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Bulk replace: delete + insert ---
        const [delHist, delGaps] = await Promise.all([
            supabase.from('student_education_history').delete().eq('usn', usn),
            supabase.from('student_education_gaps').delete().eq('usn', usn)
        ]);
        if (delHist.error) return sendCaughtError(res, delHist.error, 'Failed to update education history.');
        if (delGaps.error) return sendCaughtError(res, delGaps.error, 'Failed to update education gaps.');

        const [insHist, insGaps] = await Promise.all([
            historyToInsert.length > 0
                ? supabase.from('student_education_history').insert(historyToInsert).select()
                : Promise.resolve({ data: [], error: null }),
            gapsToInsert.length > 0
                ? supabase.from('student_education_gaps').insert(gapsToInsert).select()
                : Promise.resolve({ data: [], error: null })
        ]);

        if (insHist.error) return sendCaughtError(res, insHist.error, 'Failed to save education history.');
        if (insGaps.error) return sendCaughtError(res, insGaps.error, 'Failed to save education gaps.');

        res.json({ education_history: insHist.data || [], education_gaps: insGaps.data || [] });
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update education.');
    }
};

/**
 * Update Academics Profile (Semester Results)
 * PUT /profile/:usn/academics
 * Accepts array or { academics: [...] } or { data: [...] }.
 * Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 */
exports.updateAcademics = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.academics && Array.isArray(data.academics)) {
                data = data.academics;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of semester entries.', {
                    payload: 'Expected array or { academics: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_semester_academics').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update academics.');

            // Also clear new Postgres-backed semester tables for this student
            try {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    await client.query('DELETE FROM public.student_course_wise_academics WHERE usn = $1', [usn]);
                    await client.query('DELETE FROM public.student_semester_records WHERE usn = $1', [usn]);
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK').catch(() => {});
                    console.error('Failed to clear semester records in Postgres:', err.message);
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Postgres connection error while clearing semester records:', err.message);
            }

            return res.json([]);
        }

        // --- 3. Validate each item, collect fieldErrors; reject partially filled rows ---
        const fieldErrors = {};
        const itemsToInsert = [];

        const getLinks = (item) => {
            const raw = item.resultUploadLink ?? item.provisional_result_upload_links;
            if (Array.isArray(raw)) return raw.filter((l) => l && String(l).trim() !== '');
            if (typeof raw === 'string' && raw.trim() !== '') return [raw];
            return [];
        };

        const hasValidMarksheetUrl = (url) => {
            if (!url || typeof url !== 'string') return false;
            const s = url.trim();
            if (!s) return false;
            // Accept both absolute URLs and API-relative paths such as "/uploads/academics/..."
            if (s.startsWith('http://') || s.startsWith('https://')) return true;
            if (s.startsWith('/')) return true;
            // Fallback: basic length check so clearly broken values are rejected
            return s.length >= 5;
        };

        const isRowEmpty = (item) => {
            const v = (x) => x !== undefined && x !== null && String(x).trim() !== '';
            return !v(item.semester) && !v(item.academicYear) && !v(item.academic_year) &&
                !v(item.sgpa) && !v(item.result_in_sgpa) && getLinks(item).length === 0;
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            const key = (f) => `academics[${i}].${f}`;

            if (isRowEmpty(item)) continue;

            const semester = item.semester;
            const academicYear = item.academicYear ?? item.academic_year;
            const sgpa = item.sgpa ?? item.result_in_sgpa;
            const links = getLinks(item);

            const rSem = validateSemester(semester);
            if (!rSem.valid) fieldErrors[key('semester')] = rSem.message;

            const rYear = validateYear(academicYear, { allowEmpty: false });
            if (!rYear.valid) fieldErrors[key('academic_year')] = rYear.message;

            const rSgpa = validateSgpa(sgpa);
            if (!rSgpa.valid) fieldErrors[key('result_in_sgpa')] = rSgpa.message;

            if (links.length === 0) {
                fieldErrors[key('provisional_result_upload_links')] = 'Result marksheet is required for every semester entry.';
            } else {
                const firstValid = links.find((l) => hasValidMarksheetUrl(l));
                if (!firstValid) {
                    fieldErrors[key('provisional_result_upload_links')] = 'Please provide a valid marksheet URL (http or https).';
                }
            }

            const liveBacklogs = item.liveBacklogs ?? item.live_backlogs;
            if (liveBacklogs !== undefined && liveBacklogs !== null && liveBacklogs !== '') {
                const rLive = validateNonNegativeInt(liveBacklogs, 'Live backlogs');
                if (!rLive.valid) fieldErrors[key('live_backlogs')] = rLive.message;
            }

            const closedBacklogs = item.closedBacklogs ?? item.closed_backlogs;
            if (closedBacklogs !== undefined && closedBacklogs !== null && closedBacklogs !== '') {
                const rClosed = validateNonNegativeInt(closedBacklogs, 'Closed backlogs');
                if (!rClosed.valid) fieldErrors[key('closed_backlogs')] = rClosed.message;
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`academics[${i}].`))) continue;

            let uploadLinks = getLinks(item);
            const firstUrl = uploadLinks.find((l) => hasValidMarksheetUrl(l)) || uploadLinks[0] || null;

            const mappedItem = {
                usn,
                semester: parseInt(semester, 10),
                academic_year: parseInt(academicYear, 10),
                result_in_sgpa: parseFloat(sgpa),
                live_backlogs: liveBacklogs != null && liveBacklogs !== '' ? parseInt(liveBacklogs, 10) : 0,
                closed_backlogs: closedBacklogs != null && closedBacklogs !== '' ? parseInt(closedBacklogs, 10) : 0,
                provisional_result_upload_links: firstUrl
            };

            itemsToInsert.push(mappedItem);
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_semester_academics').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update academics.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_semester_academics')
            .insert(itemsToInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save semester academics.');

        const withParsedLinks = (inserted || []).map((row) => ({
            ...row,
            provisional_result_upload_links: parseProvisionalLinks(row.provisional_result_upload_links)
        }));
        res.json(withParsedLinks);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update academics.');
    }
};

/**
 * Get Extra-Curricular Activities Profile
 * GET /profile/:usn/extra-curricular
 * Table: student_extra_curricular_activities. Relationship: 1:N.
 * Returns array of rows. Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getExtraCurricular = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: student } = await supabase
            .from('student_basic_details')
            .select('usn')
            .eq('usn', usn)
            .single();

        if (!student) {
            return sendNotFound(res, 'Student not found.');
        }

        const { data: rows, error } = await supabase
            .from('student_extra_curricular_activities')
            .select('*')
            .eq('usn', usn)
            .order('start_date', { ascending: false, nullsFirst: false });

        if (error) {
            return sendCaughtError(res, error, 'Failed to fetch extra-curricular activities.');
        }

        res.json(rows || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to fetch extra-curricular activities.');
    }
};

/**
 * Update Extra-Curricular Activities Profile
 * PUT /profile/:usn/extra-curricular
 * Table: student_extra_curricular_activities. Relationship: 1:N. Bulk-replace: delete existing + insert validated rows.
 * Validation: activity_name required, activity_type required; start_date/end_date valid date range when present.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Error handling: apiErrorResponse (sendValidationError, sendCaughtError).
 */
exports.updateExtraCurricular = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.extraCurricular && Array.isArray(data.extraCurricular)) {
                data = data.extraCurricular;
            } else if (data && data['extra-curricular'] && Array.isArray(data['extra-curricular'])) {
                data = data['extra-curricular'];
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of extra-curricular entries.', {
                    payload: 'Expected array or { extraCurricular: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_extra_curricular_activities').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update extra-curricular activities.');
            return res.json([]);
        }

        // --- 3. Validate each item: activity_name required, activity_type required, start_date/end_date valid range ---
        const fieldErrors = {};
        const itemsToInsert = [];

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.activity_name) && !v(item.activityName) && !v(item.activity_type) && !v(item.activityType) &&
                !v(item.role) && !v(item.organization) && !v(item.start_date) && !v(item.startDate) &&
                !v(item.end_date) && !v(item.endDate) && !v(item.achievements) && !v(item.skills) &&
                !v(item.description) && !v(item.proof_document) && !v(item.proofDocument);
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            const key = (f) => `extraCurricular[${i}].${f}`;

            if (isItemEmpty(item)) continue;

            const activityName = item.activity_name ?? item.activityName ?? '';
            const rName = validateRequiredString(activityName, 'Activity name', 1);
            if (!rName.valid) {
                fieldErrors[key('activity_name')] = rName.message;
            }

            const activityType = item.activity_type ?? item.activityType ?? '';
            const rType = validateRequiredString(activityType, 'Activity type', 1);
            if (!rType.valid) {
                fieldErrors[key('activity_type')] = rType.message;
            }

            const startDate = item.start_date ?? item.startDate;
            const endDate = item.end_date ?? item.endDate;
            if (startDate != null && startDate !== '') {
                const rStart = validateDate(startDate, { allowEmpty: true });
                if (!rStart.valid) fieldErrors[key('start_date')] = rStart.message;
            }
            if (endDate != null && endDate !== '') {
                const rEnd = validateDate(endDate, { allowEmpty: true });
                if (!rEnd.valid) fieldErrors[key('end_date')] = rEnd.message;
            }
            const rRange = validateDateRange(startDate, endDate);
            if (!rRange.valid) {
                fieldErrors[key('end_date')] = fieldErrors[key('end_date')] || rRange.message;
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`extraCurricular[${i}].`))) continue;

            const toDateOnly = (val) => {
                if (val == null || val === '') return null;
                const s = String(val).trim().split('T')[0];
                return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
            };

            const mappedItem = {
                usn,
                activity_name: (activityName || '').toString().trim() || null,
                activity_type: (activityType || '').toString().trim() || null,
                role: (item.role ?? '').toString().trim() || null,
                organization: (item.organization ?? '').toString().trim() || null,
                start_date: toDateOnly(startDate),
                end_date: toDateOnly(endDate),
                achievements: (item.achievements ?? '').toString().trim() || null,
                skills: (item.skills ?? '').toString().trim() || null,
                description: (item.description ?? '').toString().trim() || null,
                proof_document: (item.proof_document ?? item.proofDocument ?? '').toString().trim() || null
            };
            Object.keys(mappedItem).forEach((k) => {
                if (mappedItem[k] === null && k !== 'usn' && k !== 'activity_name' && k !== 'activity_type') delete mappedItem[k];
                if (mappedItem[k] === '') mappedItem[k] = null;
            });
            if (mappedItem.activity_name && mappedItem.activity_type) itemsToInsert.push(mappedItem);
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_extra_curricular_activities').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update extra-curricular activities.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_extra_curricular_activities')
            .insert(itemsToInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save extra-curricular activities.');

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update extra-curricular activities.');
    }
};

/**
 * Get Projects
 * GET /profile/:usn/projects
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getProjects = async (req, res) => {
    try {
        const { usn } = req.params;
        const { data: projects, error } = await supabase
            .from('student_projects')
            .select('*')
            .eq('usn', usn);
        if (error) return sendCaughtError(res, error, 'Failed to load projects.');
        res.json(projects || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load projects.');
    }
};

/**
 * Update Projects (bulk replace)
 * PUT /profile/:usn/projects
 * Accepts array or { projects: [...] } or { data: [...] }.
 * Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 */
exports.updateProjects = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape ---
        if (!Array.isArray(data)) {
            if (data && data.projects && Array.isArray(data.projects)) {
                data = data.projects;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of projects.', {
                    payload: 'Expected array or { projects: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_projects').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update projects.');
            return res.json([]);
        }

        // --- 3. Validate each item, collect fieldErrors and parsed priorities ---
        const fieldErrors = {};
        const isRowEmpty = (item) => {
            const v = (x) => x !== undefined && x !== null && String(x).trim() !== '';
            const snaps = item.project_snaps ?? item.projectSnaps ?? [];
            const hasSnaps = Array.isArray(snaps) ? snaps.length > 0 : (typeof snaps === 'string' && snaps.trim() !== '');
            return !v(item.title) && !v(item.one_line_description) && !v(item.genre) && !hasSnaps;
        };

        const parsedPriorities = []; // index -> null | number (only for non-empty valid priority)
        const rowData = []; // validated row data for building itemsToInsert

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            const key = (f) => `projects[${i}].${f}`;

            if (isRowEmpty(item)) continue;

            const title = item.title ?? '';
            const oneLineDesc = item.one_line_description ?? item.oneLineDescription ?? '';
            const genre = item.genre ?? '';
            const visibility = (item.visibility ?? 'PRIVATE').toString().toUpperCase().trim();
            const selfRating = item.self_rating ?? item.selfRating;
            const priority = item.priority;
            const projectSnaps = item.project_snaps ?? item.projectSnaps ?? [];
            const snapsArr = Array.isArray(projectSnaps)
                ? projectSnaps.filter((s) => s != null && String(s).trim() !== '')
                : typeof projectSnaps === 'string' && projectSnaps.trim()
                    ? [projectSnaps.trim()]
                    : [];
            const hostedLink = item.hosted_link ?? item.hostedLink ?? '';
            const githubRepo = item.github_repo ?? item.githubRepo ?? '';

            const rTitle = validateRequiredString(title, 'Title', 1);
            if (!rTitle.valid) fieldErrors[key('title')] = rTitle.message;

            const rDesc = validateRequiredString(oneLineDesc, 'One-line description', 1);
            if (!rDesc.valid) fieldErrors[key('one_line_description')] = rDesc.message;

            const rGenre = validateRequiredString(genre, 'Genre', 1);
            if (!rGenre.valid) fieldErrors[key('genre')] = rGenre.message;

            const rVis = validateVisibility(visibility);
            if (!rVis.valid) fieldErrors[key('visibility')] = rVis.message;
            else if (visibility === 'PUBLIC') {
                const isApproved = item.is_approved ?? item.isApproved;
                if (isApproved === false) {
                    fieldErrors[key('visibility')] = 'Project must be approved before it can be set to PUBLIC.';
                }
            }

            const rSelf = validateSelfRating(selfRating);
            if (!rSelf.valid) fieldErrors[key('self_rating')] = rSelf.message;

            // Priority: optional. When present must be positive integer. Empty does not participate in uniqueness.
            let resolvedPriority = null;
            if (priority !== undefined && priority !== null && String(priority).trim() !== '') {
                const n = parseInt(String(priority).trim(), 10);
                if (Number.isNaN(n) || n < 1 || String(priority).trim() !== String(n)) {
                    fieldErrors[key('priority')] = 'Priority must be a positive integer.';
                } else {
                    resolvedPriority = n;
                }
            }

            if (snapsArr.length === 0) {
                fieldErrors[key('project_snaps')] = 'At least one project image is required.';
            }

            if (hostedLink && hostedLink.trim() !== '') {
                const rHosted = validateUrl(hostedLink);
                if (!rHosted.valid) fieldErrors[key('hosted_link')] = rHosted.message;
            }
            if (githubRepo && githubRepo.trim() !== '') {
                const rGithub = validateUrl(githubRepo);
                if (!rGithub.valid) fieldErrors[key('github_repo')] = rGithub.message;
            }

            parsedPriorities[i] = resolvedPriority;

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`projects[${i}].`))) continue;

            const technologies = item.technologies ?? [];
            const techArr = Array.isArray(technologies)
                ? technologies
                : typeof technologies === 'string'
                    ? technologies.split(',').map((s) => s.trim()).filter(Boolean)
                    : [];

            rowData.push({
                i,
                item,
                title,
                oneLineDesc,
                genre,
                visibility,
                selfRating,
                priority: resolvedPriority,
                snapsArr,
                hostedLink,
                githubRepo,
                techArr,
            });
        }

        // User-scoped uniqueness: same student cannot have two projects with the same (non-empty) priority
        const priorityToIndices = {};
        for (let i = 0; i < data.length; i++) {
            const p = parsedPriorities[i];
            if (p != null) {
                if (!priorityToIndices[p]) priorityToIndices[p] = [];
                priorityToIndices[p].push(i);
            }
        }
        for (const [pri, indices] of Object.entries(priorityToIndices)) {
            if (indices.length > 1) {
                const msg = 'Priority must be unique for your projects.';
                indices.forEach((idx) => {
                    fieldErrors[`projects[${idx}].priority`] = msg;
                });
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // Build itemsToInsert with raw priorities (null allowed)
        const itemsToInsert = rowData.map((r) => ({
            usn,
            title: String(r.title).trim(),
            one_line_description: String(r.oneLineDesc).trim(),
            full_description: (r.item.full_description ?? r.item.fullDescription ?? '') || null,
            genre: String(r.genre).trim(),
            visibility: r.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
            self_rating: r.selfRating != null && r.selfRating !== '' ? parseInt(String(r.selfRating), 10) : 5,
            admin_rating: r.item.admin_rating ?? r.item.adminRating ?? null,
            priority: r.priority, // null or number; will normalize next
            project_snaps: r.snapsArr,
            hosted_link: r.hostedLink.trim() || null,
            github_repo: r.githubRepo.trim() || null,
            mentor_name: (r.item.mentor_name ?? r.item.mentorName ?? '') || null,
            technologies: r.techArr.length > 0 ? r.techArr : [],
            is_approved: r.item.is_approved ?? r.item.isApproved ?? null,
            updated_at: new Date(),
        }));

        // Priority normalization: sort non-null priorities, reassign consecutive 1, 2, 3...
        const withPriority = itemsToInsert
            .map((row, idx) => ({ idx, priority: row.priority }))
            .filter((x) => x.priority != null);
        withPriority.sort((a, b) => a.priority - b.priority);
        withPriority.forEach((x, k) => {
            itemsToInsert[x.idx].priority = k + 1;
        });

        // --- 4. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_projects').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update projects.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_projects')
            .insert(itemsToInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save projects.');

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update projects.');
    }
};

/**
 * Get Internships Profile (1:N)
 * GET /profile/:usn/internships
 * Table: student_internships. Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getInternships = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: list, error } = await supabase
            .from('student_internships')
            .select('*')
            .eq('usn', usn)
            .order('start_date', { ascending: false, nullsFirst: false });

        if (error) {
            return sendCaughtError(res, error, 'Failed to load internships.');
        }

        res.json(list || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load internships.');
    }
};

/**
 * Update Internships Profile (1:N bulk replace)
 * PUT /profile/:usn/internships
 * Table: student_internships. Accepts array or { internships: [...] } or { data: [...] }.
 * Validation: job_role (required), organization (required); start_date/end_date valid date range; proof_document valid URL when present.
 * Business: Student can modify only their own; lock section after placement milestones.
 * Error handling: apiErrorResponse helpers.
 */
exports.updateInternships = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape ---
        if (!Array.isArray(data)) {
            if (data && data.internships && Array.isArray(data.internships)) {
                data = data.internships;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of internship entries.', {
                    payload: 'Expected array or { internships: [...] } or { data: [...] }.',
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_internships').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update internships.');
            return res.json([]);
        }

        // --- 3. Validate each item ---
        const fieldErrors = {};
        const itemsToInsert = [];
        const toDateOnly = (val) => {
            if (val == null || val === '') return null;
            const s = String(val).trim().split('T')[0];
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            const key = (f) => `internships[${i}].${f}`;

            const jobRole = (item.job_role ?? item.jobRole ?? '').toString().trim();
            const organization = (item.organization ?? '').toString().trim();

            const rJobRole = validateRequiredString(jobRole, 'Job role', 1);
            if (!rJobRole.valid) fieldErrors[key('job_role')] = rJobRole.message;

            const rOrg = validateRequiredString(organization, 'Organization', 1);
            if (!rOrg.valid) fieldErrors[key('organization')] = rOrg.message;

            const durationMonths = item.duration_months ?? item.durationMonths;
            if (durationMonths !== undefined && durationMonths !== null && durationMonths !== '') {
                const rDur = validatePositiveInt(durationMonths, 'Duration (months)');
                if (!rDur.valid) fieldErrors[key('duration_months')] = rDur.message;
            }

            const startDate = item.start_date ?? item.startDate;
            const endDate = item.end_date ?? item.endDate;
            if (startDate == null || String(startDate).trim() === '') {
                fieldErrors[key('start_date')] = 'Start date is required.';
            } else {
                const rStart = validateDate(startDate, { allowEmpty: false, allowFuture: false });
                if (!rStart.valid) fieldErrors[key('start_date')] = rStart.message;
            }
            if (endDate == null || String(endDate).trim() === '') {
                fieldErrors[key('end_date')] = 'End date is required.';
            } else {
                const rEnd = validateDate(endDate, { allowEmpty: false, allowFuture: true });
                if (!rEnd.valid) fieldErrors[key('end_date')] = rEnd.message;
            }
            if (startDate != null && String(startDate).trim() !== '' && endDate != null && String(endDate).trim() !== '') {
                const rRange = validateDateRange(startDate, endDate);
                if (!rRange.valid) fieldErrors[key('end_date')] = rRange.message;
            }

            const mentorName = (item.mentor_name ?? item.mentorName ?? '').toString().trim();
            if (mentorName) {
                const rMentor = validateFullName(mentorName, 'Mentor name');
                if (!rMentor.valid) fieldErrors[key('mentor_name')] = rMentor.message;
            }

            const proofDoc = item.proof_document ?? item.proofDocument;
            const hasProof = proofDoc != null && proofDoc !== '' && String(proofDoc).trim() !== '';
            if (jobRole && organization && !hasProof) {
                fieldErrors[key('proof_document')] = 'Kindly upload a proof of internship.';
            }
            if (hasProof) {
                const str = String(proofDoc).trim();
                const isFullUrl = /^https?:\/\//i.test(str);
                if (isFullUrl) {
                    const rUrl = validateUrl(proofDoc);
                    if (!rUrl.valid) fieldErrors[key('proof_document')] = 'Please upload a valid proof document (PDF or image).';
                }
                // Non-URL strings (storage paths like /path or folder/file) from uploads are accepted
            }

            const stipendVal = item.stipend != null && item.stipend !== '' ? parseFloat(String(item.stipend)) : null;
            if (stipendVal != null && !Number.isNaN(stipendVal)) {
                if (stipendVal < 0) fieldErrors[key('stipend')] = 'Enter a valid stipend (0 or positive number).';
                else if (stipendVal > 500000) fieldErrors[key('stipend')] = 'Stipend cannot exceed 5 lakh (5,00,000).';
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`internships[${i}].`))) continue;

            const mappedItem = {
                usn,
                job_role: jobRole,
                organization: organization,
                organization_details: (item.organization_details ?? item.organizationDetails ?? '').toString().trim() || null,
                duration_months: durationMonths != null && durationMonths !== '' ? parseInt(String(durationMonths), 10) : null,
                start_date: toDateOnly(startDate),
                end_date: toDateOnly(endDate),
                location: (item.location ?? '').toString().trim() || null,
                stipend: stipendVal != null && !Number.isNaN(stipendVal) && stipendVal >= 0 && stipendVal <= 500000 ? stipendVal : null,
                skills: (item.skills ?? '').toString().trim() || null,
                description: (item.description ?? '').toString().trim() || null,
                mentor_name: (item.mentor_name ?? item.mentorName ?? '').toString().trim() || null,
                proof_document: (proofDoc ?? '').toString().trim() || null,
                academic_year: (item.academic_year ?? item.academicYear ?? '').toString().trim() || null,
                updated_at: new Date(),
            };
            if (mappedItem.job_role && mappedItem.organization) itemsToInsert.push(mappedItem);
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Bulk replace ---
        const { error: delError } = await supabase.from('student_internships').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update internships.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_internships')
            .insert(itemsToInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save internships.');

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update internships.');
    }
};

/**
 * Get Trainings Profile (1:N)
 * GET /profile/:usn/trainings
 * Table: student_trainings. Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getTrainingsProfile = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: trainings, error } = await supabase
            .from('student_trainings')
            .select('*')
            .eq('usn', usn)
            .order('start_date', { ascending: false, nullsFirst: false });

        if (error) {
            return sendCaughtError(res, error, 'Failed to load trainings.');
        }

        res.json(trainings || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load trainings.');
    }
};

/**
 * Update Trainings Profile (1:N bulk replace)
 * PUT /profile/:usn/trainings
 * Table: student_trainings. Accepts array or { trainings: [...] } or { data: [...] }.
 * Validation: title (required), institution (required), start_date/end_date (valid date range).
 * Business: Student can modify only their own.
 * Error handling: apiErrorResponse helpers.
 */
exports.updateTrainingsProfile = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;
        console.log('[updateTrainingsProfile] ENTRY', { usn, bodyType: Array.isArray(data) ? 'array' : typeof data, bodyKeys: !Array.isArray(data) && data && typeof data === 'object' ? Object.keys(data) : null, body: data });

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.trainings && Array.isArray(data.trainings)) {
                data = data.trainings;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                console.log('[updateTrainingsProfile] INVALID FORMAT - expected array or {trainings/data}');
                return sendValidationError(res, 'Invalid data format. Expected an array of training entries.', {
                    payload: 'Expected array or { trainings: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_trainings').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update trainings.');
            return res.json([]);
        }

        // --- 3. Validate each item: title required, institution required, start_date/end_date valid range ---
        const fieldErrors = {};
        const itemsToInsert = [];
        const toDateOnly = (val) => {
            if (val == null || val === '') return null;
            const s = String(val).trim().split('T')[0];
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            const key = (f) => `trainings[${i}].${f}`;

            const title = item.title ?? item.Title ?? '';
            const rTitle = validateRequiredString(title, 'Title', 1);
            if (!rTitle.valid) {
                fieldErrors[key('title')] = rTitle.message;
            }

            const institution = item.institution ?? item.Institution ?? '';
            const rInstitution = validateRequiredString(institution, 'Institution', 1);
            if (!rInstitution.valid) {
                fieldErrors[key('institution')] = rInstitution.message;
            }

            const startDate = item.start_date ?? item.startDate;
            const endDate = item.end_date ?? item.endDate;
            if (startDate == null || String(startDate).trim() === '') {
                fieldErrors[key('start_date')] = 'Start date is required.';
            } else {
                const rStart = validateDate(startDate, { allowEmpty: false, allowFuture: false });
                if (!rStart.valid) fieldErrors[key('start_date')] = rStart.message;
            }
            if (endDate == null || String(endDate).trim() === '') {
                fieldErrors[key('end_date')] = 'End date is required.';
            } else {
                const rEnd = validateDate(endDate, { allowEmpty: false, allowFuture: true });
                if (!rEnd.valid) fieldErrors[key('end_date')] = rEnd.message;
            }
            if (startDate != null && String(startDate).trim() !== '' && endDate != null && String(endDate).trim() !== '') {
                const rRange = validateDateRange(startDate, endDate);
                if (!rRange.valid) fieldErrors[key('end_date')] = rRange.message;
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`trainings[${i}].`))) continue;

            const mappedItem = {
                usn,
                title: String(title ?? '').trim() || null,
                institution: String(institution ?? '').trim() || null,
                training_type: (item.training_type ?? item.trainingType ?? '') || null,
                start_date: toDateOnly(startDate),
                end_date: toDateOnly(endDate),
                skills: (item.skills ?? '') || null,
                description: (item.description ?? '') || null,
                proof_document: (item.proof_document ?? item.proofDocument ?? '') || null,
                updated_at: new Date()
            };
            if (mappedItem.title && mappedItem.institution) {
                itemsToInsert.push(mappedItem);
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            console.log('[updateTrainingsProfile] VALIDATION FAILED', { fieldErrors });
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        console.log('[updateTrainingsProfile] VALID OK, itemsToInsert count:', itemsToInsert.length, itemsToInsert);

        // --- 4. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_trainings').delete().eq('usn', usn);
        if (delError) {
            console.error('[updateTrainingsProfile] DELETE ERROR', delError);
            return sendCaughtError(res, delError, 'Failed to update trainings.');
        }

        if (itemsToInsert.length === 0) {
            console.log('[updateTrainingsProfile] No items to insert, returning []');
            return res.json([]);
        }

        const { data: inserted, error: insError } = await supabase
            .from('student_trainings')
            .insert(itemsToInsert)
            .select();

        if (insError) {
            console.error('[updateTrainingsProfile] INSERT ERROR', insError);
            return sendCaughtError(res, insError, 'Failed to save trainings.');
        }

        console.log('[updateTrainingsProfile] SUCCESS', { insertedCount: (inserted || []).length });
        res.json(inserted || []);
    } catch (error) {
        console.error('[updateTrainingsProfile] CATCH ERROR', error);
        return sendCaughtError(res, error, 'Failed to update trainings.');
    }
};

/**
 * Get Certifications Profile
 * GET /profile/:usn/certifications
 * Table: student_certifications. Relationship: 1:N.
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getCertifications = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: list, error } = await supabase
            .from('student_certifications')
            .select('*')
            .eq('usn', usn)
            .order('issue_date', { ascending: false, nullsFirst: false });

        if (error) {
            return sendCaughtError(res, error, 'Failed to load certifications.');
        }

        if (!list) {
            return res.json([]);
        }

        res.json(list);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load certifications.');
    }
};

/**
 * Update Certifications Profile
 * PUT /profile/:usn/certifications
 * Table: student_certifications. Relationship: 1:N. Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Validation: title, organization required; issue_date valid date when present; expiry_date >= issue_date; proof_document valid URL when present.
 * Business rules: prevent duplicate (same title + organization).
 * Error handling: apiErrorResponse + constraintErrors; map errors to certifications[index].field.
 */
exports.updateCertifications = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.certifications && Array.isArray(data.certifications)) {
                data = data.certifications;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of certification entries.', {
                    'certifications[0].payload': 'Expected array or { certifications: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_certifications').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update certifications.');
            return res.json([]);
        }

        // --- 3. Validate each item; collect fieldErrors as certifications[index].field ---
        const fieldErrors = {};
        const key = (i, f) => `certifications[${i}].${f}`;

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            const title = item.title ?? item.Title;
            const org = item.organization ?? item.Organization;
            return !v(title) && !v(org) &&
                !v(item.certification_type) && !v(item.certificationType) &&
                !v(item.issue_date) && !v(item.issueDate) && !v(item.expiry_date) && !v(item.expiryDate) &&
                !v(item.proof_document) && !v(item.proofDocument) &&
                !v(item.score) && !(Array.isArray(item.skills) && item.skills.length) && !(typeof item.skills === 'string' && item.skills.trim());
        };

        // Track (title, organization) for duplicate check (normalized trim, case-insensitive)
        const seenKeys = new Set();

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};

            if (isItemEmpty(item)) continue;

            const title = (item.title ?? item.Title ?? '').toString().trim();
            const organization = (item.organization ?? item.Organization ?? '').toString().trim();

            const rTitle = validateRequiredString(title || (item.title ?? item.Title), 'Title', 1);
            if (!rTitle.valid) {
                fieldErrors[key(i, 'title')] = rTitle.message;
            }

            const rOrg = validateRequiredString(organization || (item.organization ?? item.Organization), 'Organization', 1);
            if (!rOrg.valid) {
                fieldErrors[key(i, 'organization')] = rOrg.message;
            }

            const issueDate = item.issue_date ?? item.issueDate;
            if (issueDate != null && issueDate !== '') {
                const rIssue = validateDate(issueDate, { allowEmpty: true });
                if (!rIssue.valid) fieldErrors[key(i, 'issue_date')] = rIssue.message;
            }

            const expiryDate = item.expiry_date ?? item.expiryDate;
            if (expiryDate != null && expiryDate !== '') {
                const rExpiry = validateDate(expiryDate, { allowEmpty: true });
                if (!rExpiry.valid) fieldErrors[key(i, 'expiry_date')] = rExpiry.message;
            }

            if (issueDate != null && issueDate !== '' && expiryDate != null && expiryDate !== '') {
                const rRange = validateDateRange(issueDate, expiryDate);
                if (!rRange.valid) fieldErrors[key(i, 'expiry_date')] = rRange.message;
            }

            const proofDoc = item.proof_document ?? item.proofDocument;
            if (proofDoc != null && proofDoc !== '') {
                const str = String(proofDoc).trim();
                const isFullUrl = /^https?:\/\//i.test(str);
                if (isFullUrl) {
                    const rUrl = validateUrl(proofDoc);
                    if (!rUrl.valid) fieldErrors[key(i, 'proof_document')] = rUrl.message;
                }
                // Non-URL strings (storage paths like /uploads/...) from file uploads are accepted
            }

            // Duplicate check: same title + organization (within payload)
            const normKey = `${title.toLowerCase()}|${organization.toLowerCase()}`;
            if (title && organization && seenKeys.has(normKey)) {
                fieldErrors[key(i, 'title')] = 'This certification already exists (same title and organization).';
            }
            if (title && organization) seenKeys.add(normKey);
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Build rows to insert ---
        const itemsToInsert = [];
        seenKeys.clear();

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            if (isItemEmpty(item)) continue;

            const title = (item.title ?? item.Title ?? '').toString().trim();
            const organization = (item.organization ?? item.Organization ?? '').toString().trim();
            const normKey = `${title.toLowerCase()}|${organization.toLowerCase()}`;
            if (seenKeys.has(normKey)) continue;
            seenKeys.add(normKey);

            const issueDate = item.issue_date ?? item.issueDate;
            const expiryDate = item.expiry_date ?? item.expiryDate;
            const toDateOnly = (val) => {
                if (val == null || val === '') return null;
                const s = String(val).trim().split('T')[0];
                return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
            };

            const skills = item.skills;
            let skillsArr = [];
            if (Array.isArray(skills)) {
                skillsArr = skills.filter((s) => s != null && String(s).trim() !== '').map((s) => String(s).trim());
            } else if (typeof skills === 'string' && skills.trim()) {
                skillsArr = skills.split(',').map((s) => s.trim()).filter(Boolean);
            }

            const row = {
                usn,
                title,
                organization,
                certification_type: (item.certification_type ?? item.certificationType ?? '') || null,
                skills: skillsArr.length ? skillsArr : null,
                score: (item.score ?? '') || null,
                issue_date: toDateOnly(issueDate),
                expiry_date: toDateOnly(expiryDate),
                proof_document: (item.proof_document ?? item.proofDocument ?? '') || null,
                updated_at: new Date()
            };
            Object.keys(row).forEach((k) => {
                if (row[k] === '' || row[k] === null) row[k] = null;
            });
            itemsToInsert.push(row);
        }

        // --- 5. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_certifications').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update certifications.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_certifications')
            .insert(itemsToInsert)
            .select();

        if (insError) {
            return sendCaughtError(res, insError, 'Failed to save certifications.');
        }

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update certifications.');
    }
};

/** Allowed parent_type values */
const PARENT_TYPES = ['Father', 'Mother', 'Guardian'];

/**
 * Get Parent / Guardian Details
 * GET /profile/:usn/family
 * Table: student_parent_details. Relationship: 1:N.
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getParentDetails = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: list, error } = await supabase
            .from('student_parent_details')
            .select('*')
            .eq('usn', usn)
            .order('id', { ascending: true });

        if (error) {
            return sendCaughtError(res, error, 'Failed to load parent/guardian details.');
        }

        res.json(list || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load parent/guardian details.');
    }
};

/**
 * Update Parent / Guardian Details
 * PUT /profile/:usn/family
 * Table: student_parent_details. Relationship: 1:N. Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Validation: parent_type, name required; phone_number valid when present; email valid when present.
 * Business rules: max 2 parents/guardians.
 * Error handling: apiErrorResponse helpers.
 */
exports.updateParentDetails = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.parents && Array.isArray(data.parents)) {
                data = data.parents;
            } else if (data && data.family && Array.isArray(data.family)) {
                data = data.family;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of parent/guardian entries.', {
                    payload: 'Expected array or { parents: [...] } or { family: [...] } or { data: [...] }.',
                });
            }
        }

        // --- 2. Max 3 family members (special case: 1 Father + 1 Mother + 1 Guardian) ---
        if (data.length > 3) {
            return sendValidationError(res, 'Maximum 3 family members allowed.', {
                payload: 'You can add at most 3 family member entries (1 father + 1 mother + 1 guardian).',
            });
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_parent_details').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update parent/guardian details.');
            return res.json([]);
        }

        // --- 4. Validate each item; collect fieldErrors ---
        const fieldErrors = {};
        const itemsToInsert = [];
        const key = (i, f) => `parents[${i}].${f}`;

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return (
                !v(item.parent_type) && !v(item.parentType) &&
                !v(item.name) && !v(item.email) &&
                !v(item.phone_number) && !v(item.phoneNumber) &&
                !v(item.occupation) && !v(item.organization)
            );
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};

            if (isItemEmpty(item)) continue;

            const parentType = (item.parent_type ?? item.parentType ?? '').toString().trim();
            const rParentType = validateRequiredString(parentType || (item.parent_type ?? item.parentType), 'Parent type', 1);
            if (!rParentType.valid) {
                fieldErrors[key(i, 'parent_type')] = rParentType.message;
            } else {
                const rEnum = validateEnum(parentType, PARENT_TYPES, 'parent type');
                if (!rEnum.valid) fieldErrors[key(i, 'parent_type')] = rEnum.message;
            }

            const name = (item.name ?? '').toString().trim();
            const rName = validateFullName(name || item.name, 'Name');
            if (!rName.valid) fieldErrors[key(i, 'name')] = rName.message;

            const email = item.email ?? '';
            if (email !== undefined && email !== null && String(email).trim() !== '') {
                const rEmail = validateEmail(email);
                if (!rEmail.valid) fieldErrors[key(i, 'email')] = rEmail.message;
            }

            const rawPhone = item.phone_number ?? item.phoneNumber ?? '';
            if (rawPhone !== '' && rawPhone != null) {
                const rPhone = validatePhoneNumber(rawPhone);
                if (!rPhone.valid) fieldErrors[key(i, 'phone_number')] = rPhone.message;
            }

            const rawCode = item.phone_country_code ?? item.phoneCountryCode ?? '';
            if (rawCode !== '' && rawCode != null) {
                const rCode = validateCountryCode(rawCode);
                if (!rCode.valid) fieldErrors[key(i, 'phone_country_code')] = rCode.message;
            }

            if (Object.keys(fieldErrors).some((k) => k.startsWith(`parents[${i}].`))) continue;

            const rawPhoneVal = item.phone_number ?? item.phoneNumber ?? '';
            const rawCodeVal = item.phone_country_code ?? item.phoneCountryCode ?? '';
            const { phone_country_code: normCode, phone_number: normNumber } = normalizePhoneForDb(rawCodeVal, rawPhoneVal);

            const hasPhone = rawPhoneVal !== '' && rawPhoneVal != null && String(rawPhoneVal).trim() !== '';
            const phoneCountryCode = hasPhone ? (normCode ?? (rawCodeVal || '+91')) : null;
            const phoneNumber = hasPhone ? (normNumber ?? String(rawPhoneVal).trim()) : null;

            const row = {
                usn,
                parent_type: parentType || (item.parent_type ?? item.parentType ?? 'Guardian'),
                name: name || (item.name ?? ''),
                occupation: (item.occupation ?? '').toString().trim() || null,
                organization: (item.organization ?? '').toString().trim() || null,
                email: (email ?? '').toString().trim() || null,
                phone_country_code: phoneCountryCode,
                phone_number: phoneNumber,
                updated_at: new Date(),
            };
            Object.keys(row).forEach((k) => {
                if (row[k] === '' && k !== 'parent_type' && k !== 'name') row[k] = null;
            });
            itemsToInsert.push(row);
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 5. Business rules: check for valid parent/guardian combinations ---
        // Valid combinations:
        // - 1 Father only, 1 Mother only, 1 Guardian only
        // - 1 Father + 1 Mother
        // - 1 Father + 1 Guardian
        // - 1 Mother + 1 Guardian
        // - 1 Father + 1 Mother + 1 Guardian (max 3)
        // - 2 Guardians (without father or mother)
        // Invalid: 2 fathers, 2 mothers, 2+ guardians with father/mother
        if (itemsToInsert.length > 0) {
            const typeCounts = {};
            itemsToInsert.forEach((item) => {
                const type = (item.parent_type || '').toString().toUpperCase();
                typeCounts[type] = (typeCounts[type] || 0) + 1;
            });

            const fatherCount = typeCounts['FATHER'] || 0;
            const motherCount = typeCounts['MOTHER'] || 0;
            const guardianCount = typeCounts['GUARDIAN'] || 0;

            // Check for two fathers
            if (fatherCount > 1) {
                return sendValidationError(res, 'You cannot add two fathers. Only one father is allowed.', {
                    payload: 'Maximum one father allowed.',
                });
            }

            // Check for two mothers
            if (motherCount > 1) {
                return sendValidationError(res, 'You cannot add two mothers. Only one mother is allowed.', {
                    payload: 'Maximum one mother allowed.',
                });
            }

            // Check for more than 1 guardian when father or mother is present
            if (guardianCount > 1 && (fatherCount > 0 || motherCount > 0)) {
                return sendValidationError(res, 'You cannot add more than 1 guardian when father or mother is present.', {
                    payload: 'Valid: 1 father + 1 mother + 1 guardian, or 2 guardians only (without parents).',
                });
            }

            // Check for 2 guardians (only valid if no father and no mother)
            if (guardianCount > 2) {
                return sendValidationError(res, 'Maximum 2 guardians allowed.', {
                    payload: 'You can add at most 2 guardians.',
                });
            }
        }

        // --- 6. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_parent_details').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update parent/guardian details.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_parent_details')
            .insert(itemsToInsert)
            .select();

        if (insError) return sendCaughtError(res, insError, 'Failed to save parent/guardian details.');

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update parent/guardian details.');
    }
};

/**
 * Get Capstone Profile
 * GET /profile/:usn/capstone
 * Table: capstone. Relationship: 1:N (effectively 0–1 per student).
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getCapstone = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: student } = await supabase
            .from('student_basic_details')
            .select('usn')
            .eq('usn', usn)
            .maybeSingle();

        if (!student) {
            return sendNotFound(res, 'Student not found.');
        }

        const { data: capstone, error } = await supabase
            .from('capstone')
            .select('*')
            .eq('usn', usn)
            .maybeSingle();

        if (error) {
            return sendCaughtError(res, error, 'Failed to load capstone.');
        }

        res.json(capstone || {});
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load capstone.');
    }
};

/**
 * Update Capstone Profile
 * PUT /profile/:usn/capstone
 * Table: capstone. Relationship: 1:N (effectively 0–1 per student). Upsert single row.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Validation: company_name required; internship_duration_months positive integer when present; academic_year required.
 * Business rules: Allowed only if batch_academic_policies.capstone = true.
 * Error handling: apiErrorResponse helpers.
 */
exports.updateCapstone = async (req, res) => {
    try {
        const { usn } = req.params;
        const data = req.body || {};

        // --- 1. Verify student exists and get batch policy ---
        const { data: student, error: studentErr } = await supabase
            .from('student_basic_details')
            .select('usn, school_id, program_id, year_of_joining')
            .eq('usn', usn)
            .maybeSingle();

        if (studentErr) {
            return sendCaughtError(res, studentErr, 'Failed to fetch student.');
        }
        if (!student) {
            return sendNotFound(res, 'Student not found.');
        }

        const { data: policy } = await supabase
            .from('batch_academic_policies')
            .select('capstone')
            .eq('school_id', student.school_id)
            .eq('program_id', student.program_id)
            .eq('joining_year', student.year_of_joining)
            .maybeSingle();

        if (!policy || policy.capstone !== true) {
            return sendError(res, 400, 'Your batch does not allow capstone track.', { errorCode: ERROR_CODES.OPT_IN_ELIGIBILITY });
        }

        // --- 3. Validation ---
        const fieldErrors = {};

        const companyName = data.company_name ?? data.companyName ?? '';
        const rCompany = validateRequiredString(companyName, 'Company name', 1);
        if (!rCompany.valid) {
            fieldErrors.company_name = rCompany.message;
        }

        const academicYear = data.academic_year ?? data.academicYear ?? '';
        const rYear = validateRequiredString(academicYear, 'Academic year', 1);
        if (!rYear.valid) {
            fieldErrors.academic_year = rYear.message;
        }

        const durationMonths = data.internship_duration_months ?? data.internshipDurationMonths;
        if (durationMonths !== undefined && durationMonths !== null && durationMonths !== '') {
            const rDuration = validatePositiveInt(durationMonths, 'Internship duration');
            if (!rDuration.valid) {
                fieldErrors.internship_duration_months = rDuration.message;
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Build upsert payload ---
        const payload = {
            usn,
            company_name: String(companyName).trim(),
            academic_year: String(academicYear).trim(),
            internship_duration_months: durationMonths != null && durationMonths !== '' ? parseInt(String(durationMonths), 10) : null,
            designation: (data.designation ?? '').toString().trim() || null,
            offer_letter_status: (data.offer_letter_status ?? data.offerLetterStatus ?? '').toString().trim() || null,
            internship_stipend_min: data.internship_stipend_min ?? data.internshipStipendMin ?? null,
            internship_stipend_max: data.internship_stipend_max ?? data.internshipStipendMax ?? null,
            description: (data.description ?? '').toString().trim() || null,
            remarks: (data.remarks ?? '').toString().trim() || null,
            updated_at: new Date()
        };

        const { data: existingCapstone } = await supabase
            .from('capstone')
            .select('id')
            .eq('usn', usn)
            .maybeSingle();

        let result;
        if (existingCapstone) {
            const { data: updated, error: updateErr } = await supabase
                .from('capstone')
                .update(payload)
                .eq('id', existingCapstone.id)
                .select()
                .single();

            if (updateErr) {
                return sendCaughtError(res, updateErr, 'Failed to update capstone.');
            }
            result = updated;
        } else {
            const { data: inserted, error: insertErr } = await supabase
                .from('capstone')
                .insert(payload)
                .select()
                .single();

            if (insertErr) {
                return sendCaughtError(res, insertErr, 'Failed to save capstone.');
            }
            result = inserted;
        }

        res.json(result);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update capstone.');
    }
};

/**
 * Get Other Experiences Profile
 * GET /profile/:usn/other-experiences
 * Table: student_other_experiences. Relationship: 1:N.
 * Access: Student (own usn only), Admin/Placement (any usn). Ownership enforced by authMiddleware.
 */
exports.getOtherExperiences = async (req, res) => {
    try {
        const { usn } = req.params;

        const { data: list, error } = await supabase
            .from('student_other_experiences')
            .select('*')
            .eq('usn', usn)
            .order('start_date', { ascending: false, nullsFirst: false });

        if (error) {
            return sendCaughtError(res, error, 'Failed to load other experiences.');
        }

        if (!list) {
            return res.json([]);
        }

        res.json(list);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to load other experiences.');
    }
};

/**
 * Update Other Experiences Profile
 * PUT /profile/:usn/other-experiences
 * Table: student_other_experiences. Relationship: 1:N. Bulk-replace: delete existing + insert validated rows.
 * Access: Student (own usn only). Ownership enforced by authMiddleware.
 * Validation: title required; organization required when present; start_date/end_date valid date range.
 * Business rules: Student can modify only their own records.
 * Error handling: apiErrorResponse helpers.
 */
exports.updateOtherExperiences = async (req, res) => {
    try {
        const { usn } = req.params;
        let data = req.body;

        // --- 1. Input shape: accept array or wrapped payloads ---
        if (!Array.isArray(data)) {
            if (data && data.otherExperiences && Array.isArray(data.otherExperiences)) {
                data = data.otherExperiences;
            } else if (data && data.other_experiences && Array.isArray(data.other_experiences)) {
                data = data.other_experiences;
            } else if (data && data.data && Array.isArray(data.data)) {
                data = data.data;
            } else {
                return sendValidationError(res, 'Invalid data format. Expected an array of other experience entries.', {
                    payload: 'Expected array or { otherExperiences: [...] } or { other_experiences: [...] } or { data: [...] }.'
                });
            }
        }

        if (data.length === 0) {
            const { error: delError } = await supabase.from('student_other_experiences').delete().eq('usn', usn);
            if (delError) return sendCaughtError(res, delError, 'Failed to update other experiences.');
            return res.json([]);
        }

        // --- 3. Validate each item; collect fieldErrors as otherExperiences[index].field ---
        const fieldErrors = {};
        const key = (i, f) => `otherExperiences[${i}].${f}`;

        const isItemEmpty = (item) => {
            const v = (x) => x != null && String(x).trim() !== '';
            return !v(item.title) && !v(item.organization) &&
                !v(item.start_date) && !v(item.startDate) && !v(item.end_date) && !v(item.endDate) &&
                !v(item.location) && !v(item.skills) && !v(item.description) && !v(item.proof_document) && !v(item.proofDocument);
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};

            if (isItemEmpty(item)) continue;

            const title = (item.title ?? '').toString().trim();
            const rTitle = validateRequiredString(title || item.title, 'Title', 1);
            if (!rTitle.valid) {
                fieldErrors[key(i, 'title')] = rTitle.message;
            }

            const organization = (item.organization ?? '').toString().trim();
            if (organization !== '' || item.organization !== undefined) {
                const rOrg = validateRequiredString(organization || item.organization, 'Organization', 1);
                if (!rOrg.valid) {
                    fieldErrors[key(i, 'organization')] = rOrg.message;
                }
            }

            const startDate = item.start_date ?? item.startDate;
            if (startDate != null && startDate !== '') {
                const rStart = validateDate(startDate, { allowEmpty: true });
                if (!rStart.valid) fieldErrors[key(i, 'start_date')] = rStart.message;
            }

            const endDate = item.end_date ?? item.endDate;
            if (endDate != null && endDate !== '') {
                const rEnd = validateDate(endDate, { allowEmpty: true });
                if (!rEnd.valid) fieldErrors[key(i, 'end_date')] = rEnd.message;
            }

            if (startDate != null && startDate !== '' && endDate != null && endDate !== '') {
                const rRange = validateDateRange(startDate, endDate);
                if (!rRange.valid) fieldErrors[key(i, 'end_date')] = rRange.message;
            }
        }

        if (Object.keys(fieldErrors).length > 0) {
            return sendValidationError(res, 'Please correct the errors below.', fieldErrors);
        }

        // --- 4. Build rows to insert ---
        const itemsToInsert = [];
        const toDateOnly = (val) => {
            if (val == null || val === '') return null;
            const s = String(val).trim().split('T')[0];
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        };

        for (let i = 0; i < data.length; i++) {
            const item = data[i] || {};
            if (isItemEmpty(item)) continue;

            const title = (item.title ?? '').toString().trim();
            const organization = (item.organization ?? '').toString().trim();

            const row = {
                usn,
                title,
                organization: organization || null,
                start_date: toDateOnly(item.start_date ?? item.startDate),
                end_date: toDateOnly(item.end_date ?? item.endDate),
                location: (item.location ?? '').toString().trim() || null,
                skills: (item.skills ?? '').toString().trim() || null,
                description: (item.description ?? '').toString().trim() || null,
                proof_document: (item.proof_document ?? item.proofDocument ?? '').toString().trim() || null,
                updated_at: new Date()
            };
            Object.keys(row).forEach((k) => {
                if (row[k] === '') row[k] = null;
            });
            itemsToInsert.push(row);
        }

        // --- 5. Bulk replace: delete + insert ---
        const { error: delError } = await supabase.from('student_other_experiences').delete().eq('usn', usn);
        if (delError) return sendCaughtError(res, delError, 'Failed to update other experiences.');

        if (itemsToInsert.length === 0) return res.json([]);

        const { data: inserted, error: insError } = await supabase
            .from('student_other_experiences')
            .insert(itemsToInsert)
            .select();

        if (insError) {
            return sendCaughtError(res, insError, 'Failed to save other experiences.');
        }

        res.json(inserted || []);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to update other experiences.');
    }
};

/** Required fields for adding a student (single or bulk). current_year/current_semester are computed from year_of_joining. */
const STUDENT_REQUIRED_FIELDS = ['usn', 'full_name', 'college_email', 'year_of_joining'];

function normalizeUsn(val) {
    if (val == null) return '';
    return String(val).trim().toUpperCase();
}

/**
 * Add a single student (admin)
 * POST /student
 * Body: { school_id, program_id, usn, full_name, college_email, year_of_joining, ...optional }
 * current_year and current_semester are computed from year_of_joining.
 */
exports.addStudent = async (req, res) => {
    try {
        const body = req.body || {};
        const schoolId = body.school_id != null ? parseInt(body.school_id, 10) : null;
        const programId = body.program_id != null ? parseInt(body.program_id, 10) : null;
        if (!schoolId || !programId) {
            return sendValidationError(res, 'school_id and program_id are required.');
        }
        const usn = normalizeUsn(body.usn);
        if (!usn) return sendValidationError(res, 'usn is required.');

        const { data: existing } = await supabase.from('student_basic_details').select('usn').eq('usn', usn).maybeSingle();
        if (existing) {
            return sendConflict(res, 'A student with this USN already exists.');
        }

        const yearOfJoining = body.year_of_joining != null ? parseInt(body.year_of_joining, 10) : null;
        const { current_year, current_semester } = computeCurrentYearSemester(yearOfJoining, 4);
        const row = {
            usn,
            full_name: body.full_name != null ? String(body.full_name).trim() : '',
            college_email: body.college_email != null ? String(body.college_email).trim() : '',
            school_id: schoolId,
            program_id: programId,
            year_of_joining: yearOfJoining,
            current_year,
            current_semester,
            is_registered: body.is_registered === true,
            is_active: body.is_active !== false,
        };
        if (row.full_name === '' || row.college_email === '') {
            return sendValidationError(res, 'full_name and college_email are required.');
        }
        if (row.year_of_joining == null) {
            return sendValidationError(res, 'year_of_joining is required.');
        }
        const optional = ['major_id', 'minor_id', 'specialization_id', 'section', 'personal_email', 'gender', 'date_of_birth', 'blood_group', 'languages', 'specially_abled'];
        optional.forEach((key) => {
            if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
                row[key] = body[key];
            }
        });
        // Validate blood_group if provided
        if (row.blood_group) {
            const r = validateBloodGroup(row.blood_group);
            if (!r.valid) return sendValidationError(res, r.message, { blood_group: r.message });
        }
        // Validate section if provided
        if (row.section) {
            const r = validateSection(row.section);
            if (!r.valid) return sendValidationError(res, r.message, { section: r.message });
        }
        const rawPhone = body.phone_number ?? '';
        const { phone_country_code: normCode, phone_number: normNumber } = normalizePhoneForDb(body.phone_country_code, body.phone_number);
        if (rawPhone !== '' && rawPhone != null && normNumber === undefined) {
            return sendValidationError(res, PHONE_VALIDATION_MSG, { phone_number: PHONE_VALIDATION_MSG });
        }
        if (normCode !== undefined) row.phone_country_code = normCode;
        if (normNumber !== undefined) row.phone_number = normNumber;

        const { data: inserted, error } = await supabase.from('student_basic_details').insert(row).select().single();
        if (error) throw error;
        res.status(201).json(inserted);
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to add student.');
    }
};

/**
 * Check bulk students for duplicate USNs (in DB and within file)
 * POST /student/bulk/check-duplicates
 * Body: { school_id, program_id, students: [{ usn, full_name, college_email, ... }, ...] }
 * Returns: { duplicateUsnsInDb: [], duplicateUsnsInFile: [], duplicateRows: [] }
 */
exports.checkBulkDuplicates = async (req, res) => {
    try {
        const { school_id, program_id, students } = req.body || {};
        if (!school_id || !program_id || !Array.isArray(students) || students.length === 0) {
            return sendValidationError(res, 'school_id, program_id, and non-empty students array are required.');
        }

        const usnList = students.map((s) => normalizeUsn(s.usn)).filter(Boolean);
        const uniqueUsns = [...new Set(usnList)];
        const duplicateUsnsInFile = usnList.filter((u, i) => usnList.indexOf(u) !== i);
        const duplicateUsnsInFileSet = new Set(duplicateUsnsInFile);

        const duplicateRows = students.filter((s) => duplicateUsnsInFileSet.has(normalizeUsn(s.usn)));

        let duplicateUsnsInDb = [];
        if (uniqueUsns.length > 0) {
            const { data: existing } = await supabase.from('student_basic_details').select('usn').in('usn', uniqueUsns);
            duplicateUsnsInDb = (existing || []).map((r) => r.usn);
        }

        const allDuplicateUsns = [...new Set([...duplicateUsnsInFile, ...duplicateUsnsInDb])];
        const duplicateRowsForResponse = students.filter((s) => allDuplicateUsns.includes(normalizeUsn(s.usn)));

        res.json({
            duplicateUsnsInDb,
            duplicateUsnsInFile: [...new Set(duplicateUsnsInFile)],
            duplicateRows: duplicateRowsForResponse,
            hasDuplicates: duplicateRowsForResponse.length > 0,
        });
    } catch (error) {
        return sendCaughtError(res, error, 'Server error checking duplicates.');
    }
};

/**
 * Bulk insert students (admin). Call after check-duplicates returns no duplicates.
 * POST /student/bulk
 * Body: { school_id, program_id, students: [{ usn, full_name, college_email, year_of_joining, ... }, ...] }
 * current_year and current_semester are computed from year_of_joining per row.
 */
exports.bulkInsertStudents = async (req, res) => {
    try {
        const { school_id, program_id, students } = req.body || {};
        if (!school_id || !program_id || !Array.isArray(students) || students.length === 0) {
            return sendValidationError(res, 'school_id, program_id, and non-empty students array are required.');
        }

        const schoolId = parseInt(school_id, 10);
        const programId = parseInt(program_id, 10);
        if (Number.isNaN(schoolId) || Number.isNaN(programId)) {
            return sendValidationError(res, 'Invalid school_id or program_id.');
        }

        const invalidPhoneRows = [];
        const invalidBloodGroupRows = [];
        const invalidSectionRows = [];
        const rows = students.map((s, index) => {
            const usn = normalizeUsn(s.usn);
            const yearOfJoining = s.year_of_joining != null ? parseInt(s.year_of_joining, 10) : null;
            const { current_year, current_semester } = computeCurrentYearSemester(yearOfJoining, 4);
            const row = {
                usn,
                full_name: (s.full_name != null ? String(s.full_name).trim() : '') || '',
                college_email: (s.college_email != null ? String(s.college_email).trim() : '') || '',
                school_id: schoolId,
                program_id: programId,
                year_of_joining: yearOfJoining,
                current_year,
                current_semester,
                is_registered: s.is_registered === true,
                is_active: s.is_active !== false,
            };
            const optional = ['major_id', 'minor_id', 'specialization_id', 'section', 'personal_email', 'gender', 'date_of_birth', 'blood_group', 'languages', 'specially_abled'];
            optional.forEach((key) => {
                if (s[key] !== undefined && s[key] !== null && s[key] !== '') {
                    row[key] = s[key];
                }
            });
            // Validate blood_group if provided
            if (row.blood_group) {
                const r = validateBloodGroup(row.blood_group);
                if (!r.valid) invalidBloodGroupRows.push(usn || `row ${index + 1}`);
            }
            // Validate section if provided
            if (row.section) {
                const r = validateSection(row.section);
                if (!r.valid) invalidSectionRows.push(usn || `row ${index + 1}`);
            }
            const rawPhone = s.phone_number ?? '';
            const { phone_country_code: normCode, phone_number: normNumber } = normalizePhoneForDb(s.phone_country_code, s.phone_number);
            if (rawPhone !== '' && rawPhone != null && normNumber === undefined) {
                invalidPhoneRows.push(usn || `row ${index + 1}`);
            }
            if (normCode !== undefined) row.phone_country_code = normCode;
            if (normNumber !== undefined) row.phone_number = normNumber;
            return row;
        });

        if (invalidBloodGroupRows.length > 0) {
            return sendValidationError(res, 'Blood group must be a valid type (A+, A-, B+, B-, AB+, AB-, O+, O-). Invalid row(s): ' + invalidBloodGroupRows.slice(0, 5).join(', ') + (invalidBloodGroupRows.length > 5 ? '...' : ''));
        }
        if (invalidSectionRows.length > 0) {
            return sendValidationError(res, 'Section must be a single letter (A-Z). Invalid row(s): ' + invalidSectionRows.slice(0, 5).join(', ') + (invalidSectionRows.length > 5 ? '...' : ''));
        }
        if (invalidPhoneRows.length > 0) {
            return sendValidationError(res, PHONE_VALIDATION_MSG + ' Invalid row(s): ' + invalidPhoneRows.slice(0, 5).join(', ') + (invalidPhoneRows.length > 5 ? '...' : ''));
        }

        const missing = rows.filter((r) => !r.usn || !r.full_name || !r.college_email || r.year_of_joining == null);
        if (missing.length > 0) {
            return sendValidationError(res, 'Every row must have usn, full_name, college_email, year_of_joining.');
        }

        const { data: inserted, error } = await supabase.from('student_basic_details').insert(rows).select('usn');
        if (error) throw error;
        res.status(201).json({ inserted: inserted || [], count: (inserted || []).length });
    } catch (error) {
        return sendCaughtError(res, error, 'Failed to bulk insert students.');
    }
};
