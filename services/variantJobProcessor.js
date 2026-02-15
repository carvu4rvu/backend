/**
 * In-memory job queue: when a project IMAGE asset is added, we enqueue a job to
 * download the image, resize/compress to THUMB/SMALL/MEDIUM/LARGE/HD, upload each
 * to Supabase Storage, and insert project_asset_variants rows.
 */

const sharp = require('sharp');
const pool = require('../config/db');
const storageService = require('./storageService');

const VARIANT_SPECS = [
  { variant_type: 'THUMB', width: 150, height: 150, quality: 80 },
  { variant_type: 'SMALL', width: 400, height: 300, quality: 82 },
  { variant_type: 'MEDIUM', width: 800, height: 600, quality: 85 },
  { variant_type: 'LARGE', width: 1200, height: 900, quality: 88 },
  { variant_type: 'HD', width: 1920, height: 1080, quality: 90 },
];

const queue = [];
let processing = false;

/**
 * Fetch image buffer from URL (public HTTP/HTTPS).
 */
async function fetchImageBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Process one asset: download, resize to each variant, upload, insert DB.
 */
async function processAssetVariants(assetId, originalUrl) {
  const client = await pool.connect();
  try {
    const imageBuffer = await fetchImageBuffer(originalUrl);

    for (const spec of VARIANT_SPECS) {
      const { variant_type, width, height, quality } = spec;
      const buffer = await sharp(imageBuffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();

      const { url: variant_url } = await storageService.uploadVariant(buffer, assetId, variant_type);
      const file_size_kb = Math.max(1, Math.round(buffer.length / 1024));
      const outMeta = await sharp(buffer).metadata();
      const outW = outMeta.width || width;
      const outH = outMeta.height || height;

      await client.query(
        `INSERT INTO project_asset_variants (asset_id, variant_type, width, height, quality, variant_url, file_size_kb)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [assetId, variant_type, outW, outH, quality, variant_url, file_size_kb]
      );
    }
    console.log(`[variantJob] Processed asset ${assetId}: ${VARIANT_SPECS.length} variants.`);
  } catch (err) {
    console.error(`[variantJob] Failed for asset ${assetId}:`, err.message);
  } finally {
    client.release();
  }
}

function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;
  const job = queue.shift();
  processAssetVariants(job.assetId, job.originalUrl)
    .then(() => {
      processing = false;
      if (queue.length > 0) setImmediate(processNext);
    })
    .catch(() => {
      processing = false;
      if (queue.length > 0) setImmediate(processNext);
    });
}

/**
 * Enqueue a job to generate and store variants for an IMAGE asset.
 * Call this when a new project_assets row (asset_type=IMAGE) is inserted.
 */
function enqueueVariantJob(assetId, originalUrl) {
  if (!assetId || !originalUrl || typeof originalUrl !== 'string') return;
  const trimmed = originalUrl.trim();
  if (!trimmed) return;
  queue.push({ assetId, originalUrl: trimmed });
  setImmediate(processNext);
}

module.exports = {
  enqueueVariantJob,
  VARIANT_SPECS,
};
