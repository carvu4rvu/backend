/**
 * Seed script: inserts 20 NEW unique companies and contacts (with logos).
 * Run from backend: node scripts/seedCompanies.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const N_COMPANIES_TO_ADD = 20;
const COMPANY_TEMPLATES = [
  { base: 'NVIDIA', domain: 'nvidia.com', type: 'Technology' },
  { base: 'Intel', domain: 'intel.com', type: 'Technology' },
  { base: 'Oracle', domain: 'oracle.com', type: 'Technology' },
  { base: 'IBM', domain: 'ibm.com', type: 'Technology' },
  { base: 'Cisco', domain: 'cisco.com', type: 'Technology' },
  { base: 'Accenture', domain: 'accenture.com', type: 'Consulting' },
  { base: 'Deloitte', domain: 'deloitte.com', type: 'Consulting' },
  { base: 'Capgemini', domain: 'capgemini.com', type: 'IT Services' },
  { base: 'Infosys', domain: 'infosys.com', type: 'IT Services' },
  { base: 'Wipro', domain: 'wipro.com', type: 'IT Services' },
  { base: 'TCS', domain: 'tcs.com', type: 'IT Services' },
  { base: 'Cognizant', domain: 'cognizant.com', type: 'IT Services' },
  { base: 'Zoho', domain: 'zoho.com', type: 'Technology' },
  { base: 'Atlassian', domain: 'atlassian.com', type: 'Technology' },
  { base: 'SAP', domain: 'sap.com', type: 'Enterprise Software' },
  { base: 'PayPal', domain: 'paypal.com', type: 'FinTech' },
  { base: 'Stripe', domain: 'stripe.com', type: 'FinTech' },
  { base: 'Uber', domain: 'uber.com', type: 'Mobility' },
  { base: 'Airbnb', domain: 'airbnb.com', type: 'Technology' },
  { base: 'LinkedIn', domain: 'linkedin.com', type: 'Technology' },
];

function makeBatchTag() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
}

function buildCompanyPayloads(existingNameSet) {
  const batchTag = makeBatchTag();
  const rows = [];

  for (let i = 0; i < N_COMPANIES_TO_ADD; i++) {
    const t = COMPANY_TEMPLATES[i % COMPANY_TEMPLATES.length];
    const baseName = `${t.base} Campus ${batchTag}`;
    let candidate = `${baseName} ${i + 1}`;
    let k = 2;
    while (existingNameSet.has(candidate.toLowerCase())) {
      candidate = `${baseName} ${i + 1}-${k}`;
      k += 1;
    }
    existingNameSet.add(candidate.toLowerCase());

    rows.push({
      company_name: candidate,
      description: `${t.base} hiring track seeded for placement testing.`,
      company_type: t.type,
      address: `Campus Recruiting Office ${i + 1}`,
      website: `https://www.${t.domain}`,
      linkedin: `https://www.linkedin.com/company/${t.base.toLowerCase()}`,
      remarks: ['Auto-seeded', 'Placement test data'],
      company_logo_link: `https://logo.clearbit.com/${t.domain}`,
      _domain: t.domain,
      _index: i + 1,
      _batchTag: batchTag,
    });
  }

  return rows;
}

async function seed() {
  console.log(`Seeding ${N_COMPANIES_TO_ADD} NEW unique companies and contacts...\n`);

  const { data: existingCompanies, error: exErr } = await supabase
    .from('companies')
    .select('*')
    .limit(2000);
  if (exErr) console.warn('Fetch existing companies:', exErr.message);
  const existingNames = new Set((existingCompanies || []).map((c) => String(c.company_name || '').toLowerCase()));
  console.log('Existing companies in DB:', (existingCompanies || []).length);

  const generated = buildCompanyPayloads(existingNames);
  const toInsert = generated.map(({ _domain, _index, _batchTag, ...company }) => company);
  const { data: inserted, error: insertErr } = await supabase
    .from('companies')
    .insert(toInsert)
    .select('*');
  if (insertErr) {
    console.error('Companies insert error:', insertErr.message);
    throw insertErr;
  }
  console.log('Inserted companies:', inserted?.length || 0);

  const byNameMeta = new Map(generated.map((g) => [g.company_name, g]));
  const contactRows = [];
  for (const c of inserted || []) {
    const meta = byNameMeta.get(c.company_name);
    if (!meta) continue;
    const local = `campus.${meta._batchTag}.${String(meta._index).padStart(2, '0')}`;
    contactRows.push({
      company_id: c.id,
      contact_name: `Campus Recruiter ${meta._index}`,
      email: `${local}@${meta._domain}`,
      phone_number: null,
      role_title: 'University Recruiter',
      remarks: 'Auto-seeded contact',
    });
  }

  if (contactRows.length > 0) {
    const { error: contactsErr } = await supabase.from('contacts').insert(contactRows);
    if (contactsErr) {
      console.error('Contacts insert error:', contactsErr.message);
      throw contactsErr;
    }
    console.log('Inserted contacts:', contactRows.length);
  } else {
    console.log('No contacts to insert.');
  }

  // Verify counts
  const { count: companyCount } = await supabase.from('companies').select('*', { count: 'exact', head: true });
  const { count: contactCount } = await supabase.from('contacts').select('*', { count: 'exact', head: true });
  console.log('\nVerify: companies total =', companyCount, ', contacts total =', contactCount);
  console.log('Seed completed.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
