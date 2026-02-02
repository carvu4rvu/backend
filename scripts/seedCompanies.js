/**
 * Seed script: inserts companies and contacts (with logos where possible).
 * Run from backend: node scripts/seedCompanies.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

// Companies with Clearbit logo URLs (https://logo.clearbit.com/<domain>)
const COMPANIES = [
  {
    company_name: 'Google LLC',
    description: 'Technology company specializing in Internet-related services and products.',
    company_type: 'Technology',
    address: '1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',
    website: 'https://www.google.com',
    linkedin: 'https://www.linkedin.com/company/google',
    remarks: ['Top recruiter', 'Preferred for CS/ECE'],
    company_logo_link: 'https://logo.clearbit.com/google.com',
  },
  {
    company_name: 'Microsoft Corporation',
    description: 'Multinational technology corporation developing software, hardware, and cloud services.',
    company_type: 'Technology',
    address: 'One Microsoft Way, Redmond, WA 98052, USA',
    website: 'https://www.microsoft.com',
    linkedin: 'https://www.linkedin.com/company/microsoft',
    remarks: ['Frequent campus recruiter'],
    company_logo_link: 'https://logo.clearbit.com/microsoft.com',
  },
  {
    company_name: 'Amazon',
    description: 'E-commerce and cloud computing company. AWS, retail, and logistics.',
    company_type: 'Technology / E-commerce',
    address: '410 Terry Avenue North, Seattle, WA 98109, USA',
    website: 'https://www.amazon.com',
    linkedin: 'https://www.linkedin.com/company/amazon',
    remarks: ['SDE roles', 'Internship programs'],
    company_logo_link: 'https://logo.clearbit.com/amazon.com',
  },
  {
    company_name: 'Meta Platforms, Inc.',
    description: 'Social media and technology company. Facebook, Instagram, WhatsApp, Reality Labs.',
    company_type: 'Technology',
    address: '1 Meta Way, Menlo Park, CA 94025, USA',
    website: 'https://www.meta.com',
    linkedin: 'https://www.linkedin.com/company/meta',
    remarks: ['Product & Engineering'],
    company_logo_link: 'https://logo.clearbit.com/meta.com',
  },
  {
    company_name: 'Apple Inc.',
    description: 'Consumer electronics, software, and services. iPhone, Mac, iPad, Apple Watch.',
    company_type: 'Technology',
    address: 'One Apple Park Way, Cupertino, CA 95014, USA',
    website: 'https://www.apple.com',
    linkedin: 'https://www.linkedin.com/company/apple',
    remarks: ['Hardware & Software'],
    company_logo_link: 'https://logo.clearbit.com/apple.com',
  },
  {
    company_name: 'Netflix, Inc.',
    description: 'Streaming entertainment service. Content production and distribution.',
    company_type: 'Technology / Media',
    address: '5808 Sunset Blvd, Los Angeles, CA 90028, USA',
    website: 'https://www.netflix.com',
    linkedin: 'https://www.linkedin.com/company/netflix',
    remarks: ['Engineering & Data'],
    company_logo_link: 'https://logo.clearbit.com/netflix.com',
  },
  {
    company_name: 'Adobe Inc.',
    description: 'Creative, marketing, and document solutions. Photoshop, Illustrator, Creative Cloud.',
    company_type: 'Technology',
    address: '345 Park Avenue, San Jose, CA 95110, USA',
    website: 'https://www.adobe.com',
    linkedin: 'https://www.linkedin.com/company/adobe',
    remarks: ['Design & Engineering'],
    company_logo_link: 'https://logo.clearbit.com/adobe.com',
  },
  {
    company_name: 'Salesforce',
    description: 'Enterprise cloud CRM. Sales, Service, Marketing, Analytics.',
    company_type: 'Technology',
    address: '415 Mission Street, San Francisco, CA 94105, USA',
    website: 'https://www.salesforce.com',
    linkedin: 'https://www.linkedin.com/company/salesforce',
    remarks: ['CRM & Cloud'],
    company_logo_link: 'https://logo.clearbit.com/salesforce.com',
  },
];

// Contacts per company (keyed by company_name). Add after companies are inserted.
const CONTACTS_BY_COMPANY = {
  'Google LLC': [
    { contact_name: 'Priya Sharma', email: 'priya.sharma@google.com', phone_number: '+1-650-253-0001', role_title: 'University Recruiter', remarks: 'Campus hiring lead' },
    { contact_name: 'Arjun Kapoor', email: 'arjun.kapoor@google.com', phone_number: '+1-650-253-0002', role_title: 'Technical Recruiter', remarks: null },
  ],
  'Microsoft Corporation': [
    { contact_name: 'Neha Patel', email: 'neha.patel@microsoft.com', phone_number: '+1-425-882-8080', role_title: 'Campus Lead', remarks: null },
    { contact_name: 'Vikram Singh', email: 'vikram.singh@microsoft.com', phone_number: null, role_title: 'HR Partner', remarks: 'Internship coordinator' },
  ],
  'Amazon': [
    { contact_name: 'Ananya Reddy', email: 'ananya.reddy@amazon.com', phone_number: '+1-206-266-1000', role_title: 'University Programs', remarks: null },
  ],
  'Meta Platforms, Inc.': [
    { contact_name: 'Rohan Mehta', email: 'rmehta@meta.com', phone_number: '+1-650-308-7300', role_title: 'Technical Sourcer', remarks: null },
    { contact_name: 'Isha Gupta', email: 'igupta@meta.com', phone_number: null, role_title: 'University Recruiter', remarks: null },
  ],
  'Apple Inc.': [
    { contact_name: 'Karan Nair', email: 'knair@apple.com', phone_number: '+1-408-996-1010', role_title: 'Campus Relations', remarks: null },
  ],
  'Netflix, Inc.': [
    { contact_name: 'Divya Krishnan', email: 'dkrishnan@netflix.com', phone_number: '+1-408-540-3700', role_title: 'Engineering Recruiter', remarks: null },
  ],
  'Adobe Inc.': [
    { contact_name: 'Aditya Verma', email: 'averma@adobe.com', phone_number: '+1-408-536-6000', role_title: 'University Recruiter', remarks: 'Design & CS focus' },
  ],
  'Salesforce': [
    { contact_name: 'Sneha Iyer', email: 'siyer@salesforce.com', phone_number: '+1-415-901-7000', role_title: 'Campus Programs Manager', remarks: null },
  ],
};

async function seed() {
  console.log('Seeding companies and contacts...\n');

  const { data: existingCompanies, error: exErr } = await supabase
    .from('companies')
    .select('*')
    .limit(2000);
  if (exErr) console.warn('Fetch existing companies:', exErr.message);
  const existingNames = new Set((existingCompanies || []).map((c) => c.company_name));
  console.log('Existing companies in DB:', (existingCompanies || []).length);

  const toInsert = COMPANIES.filter((c) => !existingNames.has(c.company_name));
  if (toInsert.length === 0) {
    console.log('All companies already exist. Skipping insert.');
  } else {
    const inserted = [];
    for (const company of toInsert) {
      const { data: row, error: insertErr } = await supabase
        .from('companies')
        .insert(company)
        .select('*')
        .single();
      if (insertErr) {
        if (insertErr.code === '23505') {
          console.log('Skip (already exists):', company.company_name);
          continue;
        }
        console.error('Companies insert error:', insertErr.message);
        throw insertErr;
      }
      inserted.push(row);
    }
    console.log('Inserted companies:', inserted.length);

    const contactRows = [];
    for (const c of inserted) {
      const list = CONTACTS_BY_COMPANY[c.company_name] || [];
      for (const ct of list) {
        contactRows.push({
          company_id: c.id,
          contact_name: ct.contact_name || null,
          email: ct.email || null,
          phone_number: ct.phone_number || null,
          role_title: ct.role_title || null,
          remarks: ct.remarks || null,
        });
      }
    }

    if (contactRows.length > 0) {
      const { error: contactsErr } = await supabase.from('contacts').insert(contactRows);
      if (contactsErr) {
        console.error('Contacts insert error:', contactsErr.message);
        throw contactsErr;
      }
      console.log('Inserted contacts:', contactRows.length);
    } else {
      console.log('No contacts to insert (0 new companies or no contacts defined).');
    }
  }

  // Backfill contacts for companies that exist but have no contacts
  const { data: allCompanies, error: acErr } = await supabase.from('companies').select('*').limit(2000);
  if (acErr) console.warn('Fetch all companies for backfill:', acErr.message);
  const arr = allCompanies || [];
  const byName = new Map(arr.map((c) => [c.company_name, c.id]));
  const { data: contactCounts } = await supabase.from('contacts').select('company_id').limit(5000);
  const companiesWithContacts = new Set((contactCounts || []).map((r) => r.company_id));
  const backfillRows = [];
  for (const [name, list] of Object.entries(CONTACTS_BY_COMPANY)) {
    const companyId = byName.get(name);
    if (!companyId || companiesWithContacts.has(companyId)) continue;
    for (const ct of list) {
      backfillRows.push({
        company_id: companyId,
        contact_name: ct.contact_name || null,
        email: ct.email || null,
        phone_number: ct.phone_number || null,
        role_title: ct.role_title || null,
        remarks: ct.remarks || null,
      });
    }
  }
  if (backfillRows.length > 0) {
    const { error: bfErr } = await supabase.from('contacts').insert(backfillRows);
    if (bfErr) console.warn('Backfill contacts error:', bfErr.message);
    else console.log('Backfilled contacts:', backfillRows.length);
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
