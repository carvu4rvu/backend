/**
 * Supabase Storage service - structured file paths and fully random filenames
 * Buckets: student-assets, alumni-assets, company-assets, admin-assets, projects, system-assets
 * Filenames: cryptographically random - no user input, unpredictable paths
 */
const supabase = require('../config/supabaseClient');
const path = require('path');
const crypto = require('crypto');

const FOLDER_TO_BUCKET = {
  profile_image: 'student-assets',
  profileimage: 'student-assets',
  resumes: 'student-assets',
  resume: 'student-assets',
  education: 'student-assets',
  academics: 'student-assets',
  certifications: 'student-assets',
  internships: 'student-assets',
  trainings: 'student-assets',
  other_experiences: 'student-assets',
  extra_curricular: 'student-assets',
  publications: 'student-assets',
  summer_immersion: 'student-assets',
  summer_internship: 'student-assets',
  projects: 'projects',
  uploads: 'student-assets',
};

const PUBLIC_BUCKETS = ['projects', 'system-assets'];
const PRIVATE_BUCKETS = ['student-assets', 'alumni-assets', 'company-assets', 'admin-assets'];

/**
 * Generate a fully random filename - no user input, cryptographically secure, unpredictable.
 * Format: {16 hex}_{16 hex}.{ext} e.g. a3f2b1c4d5e6f789.1a2b3c4d5e6f7890.pdf
 */
function generateRandomFileName(originalName) {
  const ext = (path.extname(originalName) || '').toLowerCase() || '.bin';
  const part1 = crypto.randomBytes(8).toString('hex');
  const part2 = crypto.randomBytes(8).toString('hex');
  return `${part1}.${part2}${ext}`;
}

function getBucket(folder) {
  const f = (folder || 'uploads').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return FOLDER_TO_BUCKET[f] || 'student-assets';
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = { '.pdf': 'application/pdf', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  return map[ext] || 'image/jpeg';
}

/**
 * Upload to Supabase Storage
 * @param {Buffer} buffer - file buffer
 * @param {string} folder - e.g. profile-image, resumes, projects
 * @param {string} entityId - usn for students, alumni_id, company_id, project_id
 * @param {string} originalName - original filename (for extension only - not used in stored name)
 * @param {string} [bucketOverride] - override bucket (alumni-assets, company-assets, etc.)
 * @returns {{ url: string, path: string, bucket: string }}
 */
async function upload(buffer, folder, entityId, originalName, bucketOverride) {
  const bucket = bucketOverride || getBucket(folder);
  const sanitizedFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedEntity = String(entityId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = generateRandomFileName(originalName || 'file');
  const storagePath = `${sanitizedFolder}/${sanitizedEntity}/${fileName}`;

  const contentType = getContentType(fileName);
  const { data, error } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
  return { url: publicUrl, path: storagePath, bucket };
}

/**
 * Get signed URL for private bucket (1 hour expiry)
 */
async function getSignedUrl(bucket, filePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data?.signedUrl;
}

/**
 * Check if URL is a Supabase storage URL
 */
function isSupabaseUrl(url) {
  return url && (url.includes('supabase.co/storage') || url.startsWith('https://') && url.includes('/storage/'));
}

module.exports = { upload, getSignedUrl, getBucket, generateRandomFileName, isSupabaseUrl, PUBLIC_BUCKETS, PRIVATE_BUCKETS };
