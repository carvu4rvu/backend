const { pool } = require('./query');
const logger = require('../utils/logger');

const CTC_LABELS = [
  '0-4 LPA',
  '4-8 LPA',
  '8-12 LPA',
  '12-16 LPA',
  '16-20 LPA',
  '20-24 LPA',
  '24-28 LPA',
  '28+ LPA',
];

async function timedQuery(label, text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms >= 200) {
    logger.info(`[SQL:dashboard] ${ms}ms ${label}`);
  }
  return result;
}

/** Shared CTE: normalized offers with job-type flags and CTC for analytics */
const OFFER_ANALYTICS_CTE = `
offer_rows AS (
  SELECT
    o.id AS offer_id,
    o.student_id,
    sbd.school_id,
    COALESCE(sch.name, sch.abbreviation, 'Unknown') AS school_name,
    LOWER(TRIM(COALESCE(
      o.job_type,
      p.type_of_hiring,
      CASE
        WHEN o.capstone_id IS NOT NULL THEN 'capstone'
        WHEN o.placement_id IS NOT NULL THEN 'placement'
        ELSE ''
      END
    ))) AS jt,
    NULLIF(
      GREATEST(
        COALESCE(p.ctc_max_lpa, 0),
        COALESCE(p.ctc_min_lpa, 0)
      ),
      0
    )::float AS ctc_lpa
  FROM offers o
  LEFT JOIN placement p ON p.id = o.placement_id
  LEFT JOIN student_basic_details sbd ON sbd.usn = o.student_id
  LEFT JOIN schools sch ON sch.id = sbd.school_id
),
offer_flags AS (
  SELECT
    offer_id,
    student_id,
    school_id,
    school_name,
    ctc_lpa,
    (
      jt LIKE '%full-time%'
      OR jt LIKE '%full time%'
      OR jt = 'placement'
    ) AS is_fulltime,
    (
      (jt LIKE '%internship%' OR jt = 'capstone')
      AND jt NOT LIKE '%full%'
    ) AS is_internship,
    (
      jt LIKE '%ppo%'
      OR (jt LIKE '%intern%' AND jt LIKE '%full%')
    ) AS is_ppo
  FROM offer_rows
),
student_buckets AS (
  SELECT DISTINCT ON (student_id)
    student_id,
    school_id,
    school_name,
    CASE
      WHEN is_ppo THEN 'ppo'
      WHEN is_fulltime THEN 'fulltime'
      WHEN is_internship THEN 'internship'
    END AS placement_bucket
  FROM offer_flags
  ORDER BY student_id, is_ppo DESC, is_fulltime DESC, is_internship DESC
)`;

function pct(numerator, denominator, suffix = '%') {
  if (!denominator) return `0${suffix}`;
  return `${((numerator / denominator) * 100).toFixed(2)}${suffix}`;
}

function formatLpa(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0 LPA';
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${rounded} LPA`;
}

async function getStudentHeadlineCounts() {
  const { rows } = await timedQuery(
    'student_headline',
    `SELECT
       COUNT(*)::int AS total_registered,
       COUNT(*) FILTER (WHERE opt_in = true)::int AS total_seeking,
       COUNT(*) FILTER (WHERE is_placement_eligible = true)::int AS total_eligible
     FROM student_basic_details`
  );
  return rows[0] || { total_registered: 0, total_seeking: 0, total_eligible: 0 };
}

async function getSchoolWiseSeekingCounts() {
  const { rows } = await timedQuery(
    'school_wise_seeking',
    `SELECT
       COALESCE(sch.name, sch.abbreviation, 'Unknown') AS name,
       COUNT(sbd.usn) FILTER (WHERE sbd.opt_in = true)::int AS count
     FROM schools sch
     LEFT JOIN student_basic_details sbd ON sbd.school_id = sch.id
     GROUP BY sch.id, sch.name, sch.abbreviation
     ORDER BY name ASC`
  );
  return rows.map((r) => ({ name: r.name, count: r.count }));
}

async function getDriveCounts() {
  /** Mutually exclusive buckets — canonical placement_status only (no date overlap). */
  const { rows } = await timedQuery(
    'drive_counts',
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE LOWER(TRIM(COALESCE(placement_status, ''))) = 'ongoing'
       )::int AS ongoing,
       COUNT(*) FILTER (
         WHERE LOWER(TRIM(COALESCE(placement_status, ''))) = 'scheduled'
       )::int AS upcoming,
       COUNT(*) FILTER (
         WHERE LOWER(TRIM(COALESCE(placement_status, ''))) IN ('completed', 'closed', 'failed')
       )::int AS completed
     FROM placements_drives`
  );
  const r = rows[0] || {};
  return {
    total: r.total ?? 0,
    ongoing: r.ongoing ?? 0,
    upcoming: r.upcoming ?? 0,
    completed: r.completed ?? 0,
  };
}

async function getGlobalOfferStats(seekingTotal) {
  const { rows } = await timedQuery(
    'global_offer_stats',
    `WITH ${OFFER_ANALYTICS_CTE},
     offer_totals AS (
       SELECT
         COUNT(*)::int AS total_offers,
         COALESCE(MAX(ctc_lpa) FILTER (WHERE ctc_lpa > 0), 0)::float AS max_ctc,
         COALESCE(MIN(ctc_lpa) FILTER (WHERE ctc_lpa > 0), 0)::float AS min_ctc,
         COALESCE(AVG(ctc_lpa) FILTER (WHERE ctc_lpa > 0), 0)::float AS avg_ctc,
         COUNT(*) FILTER (WHERE ctc_lpa > 0 AND ctc_lpa < 4)::int AS ctc_b0,
         COUNT(*) FILTER (WHERE ctc_lpa >= 4 AND ctc_lpa < 8)::int AS ctc_b1,
         COUNT(*) FILTER (WHERE ctc_lpa >= 8 AND ctc_lpa < 12)::int AS ctc_b2,
         COUNT(*) FILTER (WHERE ctc_lpa >= 12 AND ctc_lpa < 16)::int AS ctc_b3,
         COUNT(*) FILTER (WHERE ctc_lpa >= 16 AND ctc_lpa < 20)::int AS ctc_b4,
         COUNT(*) FILTER (WHERE ctc_lpa >= 20 AND ctc_lpa < 24)::int AS ctc_b5,
         COUNT(*) FILTER (WHERE ctc_lpa >= 24 AND ctc_lpa < 28)::int AS ctc_b6,
         COUNT(*) FILTER (WHERE ctc_lpa >= 28)::int AS ctc_b7
       FROM offer_flags
     ),
     bucket_totals AS (
       SELECT
         COUNT(*)::int AS placed_students,
         COUNT(*) FILTER (WHERE placement_bucket = 'fulltime')::int AS full_time,
         COUNT(*) FILTER (WHERE placement_bucket = 'internship')::int AS internships,
         COUNT(*) FILTER (WHERE placement_bucket = 'ppo')::int AS ppo
       FROM student_buckets
     )
     SELECT ot.*, bt.placed_students, bt.full_time, bt.internships, bt.ppo
     FROM offer_totals ot
     CROSS JOIN bucket_totals bt`
  );
  const r = rows[0] || {};
  const totalOffers = r.total_offers ?? 0;
  const placed = r.placed_students ?? 0;
  const fullTime = r.full_time ?? 0;
  const internships = r.internships ?? 0;
  const ppo = r.ppo ?? 0;

  return {
    offers: {
      total: totalOffers,
      percent: pct(totalOffers, seekingTotal),
      placed,
      placedPercent: pct(placed, seekingTotal),
    },
    breakdown: {
      fullTime,
      fullTimePercent: pct(fullTime, placed),
      internships,
      internshipsPercent: pct(internships, placed),
      internshipCumFulltime: ppo,
      internshipCumFulltimePercent: pct(ppo, placed),
    },
    ctc: {
      highest: formatLpa(r.max_ctc),
      average: formatLpa(r.avg_ctc),
      lowest: formatLpa(r.min_ctc),
      maxLpa: r.max_ctc ?? 0,
      avgLpa: r.avg_ctc ?? 0,
      minLpa: r.min_ctc ?? 0,
    },
    ctcDistribution: [
      r.ctc_b0 ?? 0,
      r.ctc_b1 ?? 0,
      r.ctc_b2 ?? 0,
      r.ctc_b3 ?? 0,
      r.ctc_b4 ?? 0,
      r.ctc_b5 ?? 0,
      r.ctc_b6 ?? 0,
      r.ctc_b7 ?? 0,
    ],
  };
}

async function getPlacementBySchool() {
  const { rows } = await timedQuery(
    'placement_by_school',
    `WITH school_students AS (
       SELECT
         sch.id AS school_id,
         COALESCE(sch.name, sch.abbreviation, 'Unknown') AS school,
         COUNT(sbd.usn) FILTER (WHERE sbd.opt_in = true)::int AS total
       FROM schools sch
       LEFT JOIN student_basic_details sbd ON sbd.school_id = sch.id
       GROUP BY sch.id, sch.name, sch.abbreviation
     ),
     ${OFFER_ANALYTICS_CTE},
     school_offer_counts AS (
       SELECT
         COALESCE(of.school_name, 'Unknown') AS school,
         COUNT(*)::int AS total_offers
       FROM offer_flags of
       GROUP BY COALESCE(of.school_name, 'Unknown')
     ),
     school_ctc AS (
       SELECT
         COALESCE(of.school_name, 'Unknown') AS school,
         COUNT(*) FILTER (WHERE of.ctc_lpa > 0)::int AS ctc_offer_count,
         COALESCE(MAX(of.ctc_lpa) FILTER (WHERE of.ctc_lpa > 0), 0)::float AS max_ctc,
         COALESCE(MIN(of.ctc_lpa) FILTER (WHERE of.ctc_lpa > 0), 0)::float AS min_ctc,
         COALESCE(AVG(of.ctc_lpa) FILTER (WHERE of.ctc_lpa > 0), 0)::float AS avg_ctc,
         COUNT(*) FILTER (WHERE of.ctc_lpa > 0 AND of.ctc_lpa < 4)::int AS ctc_b0,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 4 AND of.ctc_lpa < 8)::int AS ctc_b1,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 8 AND of.ctc_lpa < 12)::int AS ctc_b2,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 12 AND of.ctc_lpa < 16)::int AS ctc_b3,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 16 AND of.ctc_lpa < 20)::int AS ctc_b4,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 20 AND of.ctc_lpa < 24)::int AS ctc_b5,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 24 AND of.ctc_lpa < 28)::int AS ctc_b6,
         COUNT(*) FILTER (WHERE of.ctc_lpa >= 28)::int AS ctc_b7
       FROM offer_flags of
       GROUP BY COALESCE(of.school_name, 'Unknown')
     ),
     school_buckets AS (
       SELECT
         COALESCE(sb.school_name, 'Unknown') AS school,
         COUNT(*)::int AS placed,
         COUNT(*) FILTER (WHERE sb.placement_bucket = 'fulltime')::int AS full_time,
         COUNT(*) FILTER (WHERE sb.placement_bucket = 'internship')::int AS internship,
         COUNT(*) FILTER (WHERE sb.placement_bucket = 'ppo')::int AS ppo
       FROM student_buckets sb
       GROUP BY COALESCE(sb.school_name, 'Unknown')
     )
     SELECT
       ss.school,
       ss.total,
       COALESCE(sb.full_time, 0)::int AS full_time,
       COALESCE(sb.internship, 0)::int AS internship,
       COALESCE(sb.ppo, 0)::int AS ppo,
       COALESCE(soc.total_offers, 0)::int AS total_offers,
       COALESCE(sb.placed, 0)::int AS placed,
       CASE
         WHEN ss.total > 0 THEN ROUND((COALESCE(sb.placed, 0)::numeric / ss.total) * 100, 2)
         ELSE 0
       END AS percent,
       COALESCE(sc.ctc_offer_count, 0)::int AS ctc_offer_count,
       COALESCE(sc.max_ctc, 0)::float AS max_ctc,
       COALESCE(sc.min_ctc, 0)::float AS min_ctc,
       COALESCE(sc.avg_ctc, 0)::float AS avg_ctc,
       COALESCE(sc.ctc_b0, 0)::int AS ctc_b0,
       COALESCE(sc.ctc_b1, 0)::int AS ctc_b1,
       COALESCE(sc.ctc_b2, 0)::int AS ctc_b2,
       COALESCE(sc.ctc_b3, 0)::int AS ctc_b3,
       COALESCE(sc.ctc_b4, 0)::int AS ctc_b4,
       COALESCE(sc.ctc_b5, 0)::int AS ctc_b5,
       COALESCE(sc.ctc_b6, 0)::int AS ctc_b6,
       COALESCE(sc.ctc_b7, 0)::int AS ctc_b7
     FROM school_students ss
     LEFT JOIN school_buckets sb ON sb.school = ss.school
     LEFT JOIN school_offer_counts soc ON soc.school = ss.school
     LEFT JOIN school_ctc sc ON sc.school = ss.school
     ORDER BY ss.school ASC`
  );

  return rows.map((r) => ({
    school: r.school,
    total: r.total,
    fullTime: r.full_time,
    internship: r.internship,
    ppo: r.ppo,
    totalOffers: r.total_offers,
    placed: r.placed,
    percent: Number(r.percent) || 0,
    ctcOfferCount: r.ctc_offer_count ?? 0,
    ctc: {
      highest: formatLpa(r.max_ctc),
      average: formatLpa(r.avg_ctc),
      lowest: formatLpa(r.min_ctc),
      maxLpa: r.max_ctc ?? 0,
      avgLpa: r.avg_ctc ?? 0,
      minLpa: r.min_ctc ?? 0,
    },
    ctcDistribution: [
      r.ctc_b0 ?? 0,
      r.ctc_b1 ?? 0,
      r.ctc_b2 ?? 0,
      r.ctc_b3 ?? 0,
      r.ctc_b4 ?? 0,
      r.ctc_b5 ?? 0,
      r.ctc_b6 ?? 0,
      r.ctc_b7 ?? 0,
    ],
  }));
}

async function getHiringPartners() {
  const { rows } = await timedQuery(
    'hiring_partners',
    `SELECT
       id,
       company_name,
       company_type,
       company_logo_link,
       website,
       address,
       description
     FROM companies
     ORDER BY company_name ASC`
  );
  return {
    count: rows.length,
    partners: rows.map((c) => ({
      id: c.id,
      name: c.company_name,
      company_type: c.company_type,
      logo: c.company_logo_link,
      website: c.website || '',
      location: c.address || 'Unknown',
      description: c.description || '',
      industry: c.company_type || 'Technology',
    })),
  };
}

/**
 * Full dashboard analytics payload (aggregated in PostgreSQL).
 */
async function getDashboardAnalytics() {
  const routeStart = Date.now();

  const headline = await getStudentHeadlineCounts();
  const seekingTotal = headline.total_seeking ?? 0;

  const [schoolWise, drives, offerBlock, placementBySchool, partnersBlock] = await Promise.all([
    getSchoolWiseSeekingCounts(),
    getDriveCounts(),
    getGlobalOfferStats(seekingTotal),
    getPlacementBySchool(),
    getHiringPartners(),
  ]);

  const elapsed = Date.now() - routeStart;
  logger.info(`[dashboard] analytics assembled in ${elapsed}ms`);

  return {
    students: {
      totalRegistered: headline.total_registered,
      totalSeeking: headline.total_seeking,
      totalEligible: headline.total_eligible,
      schoolWise,
    },
    drives,
    offers: offerBlock.offers,
    breakdown: offerBlock.breakdown,
    ctc: offerBlock.ctc,
    chart: {
      labels: CTC_LABELS,
      data: offerBlock.ctcDistribution,
    },
    placementBySchool,
    partners: partnersBlock.partners,
    partnerCount: partnersBlock.count,
  };
}

module.exports = {
  getDashboardAnalytics,
  getStudentHeadlineCounts,
  getSchoolWiseSeekingCounts,
  getDriveCounts,
  getGlobalOfferStats,
  getPlacementBySchool,
  getHiringPartners,
};
