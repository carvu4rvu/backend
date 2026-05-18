/**
 * Supabase Storage service - structured file paths and fully random filenames
 * Buckets: student-assets, alumni-assets, company-assets, admin-assets, projects, system-assets
 */
const supabase = require('../config/supabaseClient');
const path = require('path');
const crypto = require('crypto');
const {
  classifySupabaseError,
  logStorageOperationFailure,
} = require('../utils/supabaseDiagnostics');

class StorageError extends Error {
  constructor(message, { code, userMessage, retryable, cause } = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code || 'UNKNOWN';
    this.userMessage = userMessage || 'Storage operation failed. Please try again.';
    this.retryable = Boolean(retryable);
    this.cause = cause;
  }
}

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
const PRIVATE_BUCKETS = ['student-assets', 'student_assets', 'alumni-assets', 'company-assets', 'admin-assets'];

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

function wrapStorageError(error, operation, context = {}) {
  const classified = classifySupabaseError(error);
  logStorageOperationFailure(operation, {
    code: classified.code,
    bucket: context.bucket,
    path: context.path,
    message: error?.message,
  });
  return new StorageError(error?.message || classified.userMessage, {
    code: classified.code,
    userMessage: classified.userMessage,
    retryable: classified.retryable,
    cause: error,
  });
}

async function upload(buffer, folder, entityId, originalName, bucketOverride) {
  const bucket = bucketOverride || getBucket(folder);
  const sanitizedFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedEntity = String(entityId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = generateRandomFileName(originalName || 'file');
  const storagePath = `${sanitizedFolder}/${sanitizedEntity}/${fileName}`;
  const contentType = getContentType(fileName);

  try {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw error;

    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
    return { url: publicUrl, path: storagePath, bucket };
  } catch (err) {
    throw wrapStorageError(err, 'upload', { bucket, path: storagePath });
  }
}

async function getSignedUrl(bucket, filePath, expiresIn = 604800) {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn);
    if (error) {
      logStorageOperationFailure('getSignedUrl', {
        code: classifySupabaseError(error).code,
        bucket,
        path: filePath,
        message: error.message,
      });
      return null;
    }
    return data?.signedUrl;
  } catch (err) {
    logStorageOperationFailure('getSignedUrl', {
      code: classifySupabaseError(err).code,
      bucket,
      path: filePath,
      message: err.message,
    });
    return null;
  }
}

function isSupabaseUrl(url) {
  return url && (url.includes('supabase.co/storage') || (url.startsWith('https://') && url.includes('/storage/')));
}

const PROJECTS_BUCKET = 'projects';
const VARIANT_FOLDER = 'project-variants';

async function uploadVariant(buffer, assetId, variantType) {
  const sanitized = String(variantType || 'variant').replace(/[^A-Z0-9_]/gi, '_').toUpperCase() || 'variant';
  const storagePath = `${VARIANT_FOLDER}/${assetId}/${sanitized}.webp`;

  try {
    const { error } = await supabase.storage.from(PROJECTS_BUCKET).upload(storagePath, buffer, {
      contentType: 'image/webp',
      upsert: true,
    });
    if (error) throw error;

    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const publicUrl = `${baseUrl}/storage/v1/object/public/${PROJECTS_BUCKET}/${storagePath}`;
    return { url: publicUrl, path: storagePath };
  } catch (err) {
    throw wrapStorageError(err, 'uploadVariant', { bucket: PROJECTS_BUCKET, path: storagePath });
  }
}

module.exports = {
  upload,
  getSignedUrl,
  getBucket,
  generateRandomFileName,
  isSupabaseUrl,
  uploadVariant,
  StorageError,
  PUBLIC_BUCKETS,
  PRIVATE_BUCKETS,
};
