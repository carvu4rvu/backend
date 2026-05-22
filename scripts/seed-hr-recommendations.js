require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const alumniDb = require('../db/alumniDb');

/** Fictional companies only — plausible names, not real brands. */
const SEEDS = [
  {
    company_name: 'Nexora Technologies',
    hr_name: 'Priya Sharma',
    hr_email: 'priya.sharma@nexoratech.in',
    hr_phone: '+91 98765 43210',
    hiring_role: 'Software Engineer',
    opportunity_type: 'Full-Time',
    recommendation_note:
      'Strong campus hiring pipeline for RV graduates. HR is open to bulk drives and technical interviews.',
    consent_given: true,
  },
  {
    company_name: 'Velvant Systems',
    hr_name: 'Rahul Menon',
    hr_email: 'rahul.menon@velvant.com',
    hr_phone: '+91 99887 76655',
    hiring_role: 'Graduate Trainee',
    opportunity_type: 'Full-Time',
    recommendation_note: 'Looking for freshers from CSE and ECE. Alumni referral preferred.',
    consent_given: true,
  },
  {
    company_name: 'Prismbyte Solutions',
    hr_name: 'Ananya Iyer',
    hr_email: 'ananya.iyer@prismbyte.io',
    hr_phone: null,
    hiring_role: 'Systems Engineer',
    opportunity_type: 'Internship',
    recommendation_note: '6-month internship with PPO track. Good fit for final-year students.',
    consent_given: true,
  },
  {
    company_name: 'Arcline Innovations',
    hr_name: 'Vikram Patel',
    hr_email: 'vikram.patel@arcline.co',
    hr_phone: '+91 91234 56789',
    hiring_role: 'Associate Software Analyst',
    opportunity_type: 'Full-Time',
    recommendation_note: 'Hybrid role in Bangalore. Alumni can connect directly for referral.',
    consent_given: true,
  },
  {
    company_name: 'Lumencore Digital',
    hr_name: 'Sneha Reddy',
    hr_email: 'sneha.reddy@lumencore.in',
    hr_phone: '+91 90123 45678',
    hiring_role: 'SDE Intern',
    opportunity_type: 'Internship',
    recommendation_note: 'Summer internship program — competitive but alumni vouch helps.',
    consent_given: true,
  },
];

const REAL_COMPANY_NAMES = [
  'Infosys',
  'Wipro',
  'TCS',
  'Accenture',
  'Amazon',
  'Google',
  'Microsoft',
  'Flipkart',
];

(async () => {
  try {
    const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM hr_recommendations');
    const existing = countRes.rows[0].n;

    const { rows: alumni } = await pool.query(`
      SELECT id, full_name, personal_email
      FROM alumni
      WHERE personal_email IS NOT NULL AND TRIM(personal_email) <> ''
      ORDER BY id DESC
      LIMIT 10
    `);
    if (alumni.length < SEEDS.length) {
      console.error('Need at least', SEEDS.length, 'alumni; found', alumni.length);
      process.exit(1);
    }

    // Update rows that still use old real company names
    const { rows: toFix } = await pool.query(
      `SELECT id, company_name FROM hr_recommendations
       WHERE company_name = ANY($1::text[])
       ORDER BY id ASC`,
      [REAL_COMPANY_NAMES]
    );

    const updated = [];
    for (let i = 0; i < toFix.length && i < SEEDS.length; i++) {
      const seed = SEEDS[i];
      await pool.query(
        `UPDATE hr_recommendations
         SET company_name = $1, hr_name = $2, hr_email = $3, hr_phone = $4,
             hiring_role = $5, opportunity_type = $6, recommendation_note = $7
         WHERE id = $8`,
        [
          seed.company_name,
          seed.hr_name,
          seed.hr_email,
          seed.hr_phone,
          seed.hiring_role,
          seed.opportunity_type,
          seed.recommendation_note,
          toFix[i].id,
        ]
      );
      updated.push({ id: toFix[i].id, from: toFix[i].company_name, to: seed.company_name });
    }

    if (updated.length) {
      console.log('Updated', updated.length, 'existing rows to fictional companies:');
      console.log(JSON.stringify(updated, null, 2));
    }

    if (existing >= SEEDS.length && updated.length === 0) {
      console.log('No real-company rows to fix. Total HR recommendations:', existing);
      const { rows: sample } = await pool.query(
        'SELECT id, company_name, hr_name FROM hr_recommendations ORDER BY id DESC LIMIT 8'
      );
      console.log(sample);
      return;
    }

    if (existing > 0 && updated.length > 0) {
      return;
    }

    const inserted = [];
    for (let i = 0; i < SEEDS.length; i++) {
      const alum = alumni[i % alumni.length];
      const row = await alumniDb.insertHrRecommendation({
        alumni_id: alum.id,
        ...SEEDS[i],
      });
      inserted.push({
        id: row.id,
        alumni: alum.full_name,
        company: row.company_name,
        hr: row.hr_name,
      });
    }

    console.log('Seeded', inserted.length, 'HR recommendations:');
    console.log(JSON.stringify(inserted, null, 2));
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
