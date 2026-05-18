require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const dist = await pool.query(`
    SELECT LOWER(TRIM(COALESCE(placement_status, ''))) AS status, COUNT(*)::int AS cnt
    FROM placements_drives
    GROUP BY 1 ORDER BY cnt DESC`);
  console.log('Status distribution:');
  console.table(dist.rows);

  const buckets = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(placement_status, ''))) = 'ongoing') AS ongoing,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(placement_status, ''))) = 'scheduled') AS upcoming,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(placement_status, ''))) IN ('completed', 'closed', 'failed')) AS completed
    FROM placements_drives`);
  console.log('Mutually exclusive buckets:', buckets.rows[0]);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
