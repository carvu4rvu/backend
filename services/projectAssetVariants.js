/**
 * Project asset variants: build variant records for IMAGE assets.
 * Uses Supabase Storage Image Transformation URLs (render/image/public/...?width=&height=&quality=).
 * For non-Supabase URLs we do not create variants (caller can use original_url as fallback).
 */

const storageService = require('./storageService');

const VARIANT_SPECS = [
  { variant_type: 'THUMB', width: 150, height: 150, quality: 80 },
  { variant_type: 'SMALL', width: 400, height: 300, quality: 82 },
  { variant_type: 'MEDIUM', width: 800, height: 600, quality: 85 },
  { variant_type: 'LARGE', width: 1200, height: 900, quality: 88 },
  { variant_type: 'HD', width: 1920, height: 1080, quality: 90 },
];

/**
 * Convert Supabase storage public URL to render (transform) URL.
 * Input:  https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
 * Output: https://<ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=W&height=H&quality=Q
 */
function toSupabaseRenderUrl(originalUrl, width, height, quality) {
  if (!originalUrl || typeof originalUrl !== 'string') return null;
  const trimmed = originalUrl.trim();
  if (!trimmed.includes('/storage/v1/object/public/')) return null;
  const base = trimmed.replace('/object/public/', '/render/image/public/');
  const params = new URLSearchParams();
  if (width != null) params.set('width', String(width));
  if (height != null) params.set('height', String(height));
  if (quality != null) params.set('quality', String(quality));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Build variant records for an IMAGE asset. Only generates variants for Supabase storage URLs.
 * @param {string} originalUrl - project_assets.original_url
 * @returns {Array<{ variant_type: string, width: number, height: number, quality: number, variant_url: string }>}
 */
function buildVariantsForImage(originalUrl) {
  if (!originalUrl || typeof originalUrl !== 'string') return [];
  if (!storageService.isSupabaseUrl(originalUrl)) return [];

  return VARIANT_SPECS.map(({ variant_type, width, height, quality }) => ({
    variant_type,
    width,
    height,
    quality,
    variant_url: toSupabaseRenderUrl(originalUrl, width, height, quality),
  })).filter((v) => v.variant_url);
}

/**
 * Insert variant rows for an asset (caller provides DB client and assetId).
 * @param {object} client - pg client
 * @param {number} assetId - project_assets.id
 * @param {string} originalUrl - project_assets.original_url
 * @returns {Promise<number>} number of variants inserted
 */
async function insertVariantsForAsset(client, assetId, originalUrl) {
  const variants = buildVariantsForImage(originalUrl);
  if (variants.length === 0) return 0;

  for (const v of variants) {
    await client.query(
      `INSERT INTO project_asset_variants (asset_id, variant_type, width, height, quality, variant_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assetId, v.variant_type, v.width, v.height, v.quality, v.variant_url]
    );
  }
  return variants.length;
}

module.exports = {
  buildVariantsForImage,
  insertVariantsForAsset,
  toSupabaseRenderUrl,
  VARIANT_SPECS,
};
