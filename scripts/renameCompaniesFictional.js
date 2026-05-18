/**
 * Rename all companies to fictional/non-real names.
 *
 * Run from backend:
 *   node scripts/renameCompaniesFictional.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const PREFIXES = [
  'Auralith', 'Brinova', 'Calytrix', 'Deltora', 'Elyvion',
  'Fluxera', 'Glyphon', 'Heliora', 'Inverra', 'Jyntra',
  'Klyvora', 'Lumetra', 'Myntara', 'Novaryn', 'Orvanta',
  'Prysmic', 'Quentra', 'Ryvanta', 'Solvica', 'Trivana',
  'Ulthera', 'Veltrix', 'Wyverra', 'Xylanta', 'Yorvex', 'Zentari',
];

const SUFFIXES = [
  'Dynamics', 'Systems', 'Labs', 'Networks', 'Technologies',
  'Ventures', 'Analytics', 'Digital', 'Collective', 'Works',
  'Logic', 'Industries', 'Solutions', 'Matrix', 'Cloud',
];

function fictionalName(index, id) {
  const p = PREFIXES[index % PREFIXES.length];
  const s = SUFFIXES[Math.floor(index / PREFIXES.length) % SUFFIXES.length];
  return `${p} ${s} ${String(id).padStart(3, '0')}`;
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows: companies } = await client.query(
      'SELECT id, company_name FROM companies ORDER BY id'
    );

    if (!companies.length) {
      console.log('No companies found.');
      return;
    }

    await client.query('BEGIN');
    for (let i = 0; i < companies.length; i += 1) {
      const row = companies[i];
      const nextName = fictionalName(i, row.id);
      await client.query(
        'UPDATE companies SET company_name = $1, updated_at = NOW() WHERE id = $2',
        [nextName, row.id]
      );
    }
    await client.query('COMMIT');

    console.log(`Renamed ${companies.length} companies to fictional names.`);
    const { rows: preview } = await client.query(
      'SELECT id, company_name FROM companies ORDER BY id LIMIT 15'
    );
    console.log(JSON.stringify(preview, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Rename failed:', err.message || err);
  process.exit(1);
});
