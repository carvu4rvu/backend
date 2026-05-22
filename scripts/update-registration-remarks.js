require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

/** Short 2–3 word remarks by batch year (fallback: generic label). */
const REMARKS_BY_BATCH = {
  2020: 'Class 2020',
  2021: 'Batch 2021',
  2022: 'CSE 2022',
  2023: 'ECE 2023',
  2024: 'Class 2024',
  2025: 'MBA 2025',
  2026: 'Alumni 2026',
};

function remarkForRow(row, index) {
  const year = row.batch_year != null ? Number(row.batch_year) : null;
  if (year && REMARKS_BY_BATCH[year]) return REMARKS_BY_BATCH[year];
  const inst = (row.institution_name || '').trim();
  if (inst && year) return `${year} ${inst.split(' ')[0]}`;
  const fallbacks = ['RVU alumni', 'Open registration', 'Placement batch'];
  return fallbacks[index % fallbacks.length];
}

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, batch_year, institution_name, remarks, code
       FROM alumni_registration_codes
       ORDER BY batch_year DESC NULLS LAST, id ASC`
    );
    console.log('Before:', rows.map((r) => ({ id: r.id, batch: r.batch_year, remarks: r.remarks })));

    /** Per-id overrides when same batch needs distinct short labels */
    const ID_OVERRIDES = {
      7: 'VC batch',
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const remarks = ID_OVERRIDES[r.id] ?? remarkForRow(r, i);
      await pool.query('UPDATE alumni_registration_codes SET remarks = $1 WHERE id = $2', [
        remarks,
        r.id,
      ]);
    }

    const after = await pool.query(
      'SELECT id, batch_year, remarks, code FROM alumni_registration_codes ORDER BY id'
    );
    console.log('After:', after.rows);
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
