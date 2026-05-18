const { queryMany, queryOne, queryIn, queryInText } = require('./query');

async function getAllSchools() {
  return queryMany('SELECT id, name, abbreviation FROM schools ORDER BY name ASC');
}

async function getSchoolsByIds(ids) {
  if (!ids?.length) return [];
  return queryIn('schools', 'id, name, abbreviation', 'id', [...new Set(ids)]);
}

async function getSchoolsByNames(names) {
  if (!names?.length) return [];
  const { rows } = await require('./query').pool.query(
    'SELECT id, name FROM schools WHERE name = ANY($1::text[])',
    [names]
  );
  return rows;
}

async function getAllPrograms() {
  return queryMany(
    'SELECT id, school_id, name, graduation_level, min_duration_years, max_duration_years FROM programs ORDER BY name ASC'
  );
}

async function getProgramsByIds(ids) {
  if (!ids?.length) return [];
  return queryIn('programs', 'id, name, school_id, min_duration_years, max_duration_years', 'id', [...new Set(ids)]);
}

async function getProgramsByNames(names) {
  if (!names?.length) return [];
  const { rows } = await require('./query').pool.query(
    'SELECT id FROM programs WHERE name = ANY($1::text[])',
    [names]
  );
  return rows;
}

async function getMajorsByIds(ids) {
  if (!ids?.length) return [];
  return queryIn('majors', 'id, name', 'id', [...new Set(ids)]);
}

async function getSpecializationsByIds(ids) {
  if (!ids?.length) return [];
  return queryIn('specializations', 'id, name', 'id', [...new Set(ids)]);
}

async function existsById(table, id) {
  const allowed = ['schools', 'programs', 'majors', 'minors', 'specializations'];
  if (!allowed.includes(table)) throw new Error(`Invalid catalog table: ${table}`);
  return queryOne(`SELECT id FROM ${table} WHERE id = $1`, [id]);
}

async function getAllMajors() {
  return queryMany('SELECT id, program_id, name FROM majors ORDER BY name ASC');
}

async function getAllMinors() {
  return queryMany('SELECT id, school_id, name FROM minors ORDER BY name ASC');
}

async function getAllSpecializations() {
  return queryMany('SELECT id, program_id, name FROM specializations ORDER BY name ASC');
}

async function getCatalogLookupMaps() {
  const [schools, programs, majors, specializations] = await Promise.all([
    queryMany('SELECT id, name FROM schools ORDER BY name ASC'),
    queryMany('SELECT id, name FROM programs ORDER BY name ASC'),
    queryMany('SELECT id, name FROM majors ORDER BY name ASC'),
    queryMany('SELECT id, name FROM specializations ORDER BY name ASC'),
  ]);
  return { schools, programs, majors, specializations };
}

async function getAcademyOverviewData() {
  const [schools, programs, majors, minors, specializations, students] = await Promise.all([
    getAllSchools(),
    getAllPrograms(),
    getAllMajors(),
    getAllMinors(),
    getAllSpecializations(),
    require('./studentDb').getStudentSchoolProgramIds(),
  ]);
  return { schools, programs, majors, minors, specializations, students };
}

async function getNameMaps({ schoolIds = [], programIds = [], majorIds = [], specIds = [] } = {}) {
  const [schools, programs, majors, specs] = await Promise.all([
    getSchoolsByIds(schoolIds),
    getProgramsByIds(programIds),
    getMajorsByIds(majorIds),
    getSpecializationsByIds(specIds),
  ]);
  return {
    schoolMap: new Map(schools.map((s) => [s.id, s.name])),
    programMap: new Map(programs.map((p) => [p.id, p])),
    majorMap: new Map(majors.map((m) => [m.id, m.name])),
    specMap: new Map(specs.map((s) => [s.id, s.name])),
  };
}

module.exports = {
  getAllSchools,
  getSchoolsByIds,
  getSchoolsByNames,
  getAllPrograms,
  getProgramsByIds,
  getProgramsByNames,
  getMajorsByIds,
  getAllMajors,
  getAllMinors,
  getAllSpecializations,
  getSpecializationsByIds,
  existsById,
  getCatalogLookupMaps,
  getAcademyOverviewData,
  getNameMaps,
};
