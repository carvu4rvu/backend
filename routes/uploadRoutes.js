const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/uploadController');
const { authenticateToken } = require('../middleware/authMiddleware');
const storageService = require('../services/storageService');

// GET /api/upload/asset?url=... - redirect to signed URL for private bucket files
router.get('/asset', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url query parameter required' });
    }
    
    // If it's already a signed URL or not a Supabase URL, just redirect
    if (url.includes('?token=') || !storageService.isSupabaseUrl(url)) {
      return res.redirect(url);
    }

    // Match public Supabase URLs to extract bucket and path
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return res.redirect(url);
    
    let [ , bucket, filePath ] = match;
    
    // Normalize bucket name
    if (bucket === 'student_assets' && !storageService.PUBLIC_BUCKETS.includes('student_assets')) {
      bucket = 'student-assets';
    }
    
    // Public buckets don't need signing
    if (storageService.PUBLIC_BUCKETS.includes(bucket)) {
      return res.redirect(url);
    }

    // Get signed URL (default 1 week expiry)
    const signedUrl = await storageService.getSignedUrl(bucket, filePath);
    
    if (!signedUrl) {
      console.error(`[upload/asset] FAILED to sign URL for bucket: ${bucket}, path: ${filePath}`);
      // Return a 403 instead of redirecting to a known 404 public URL
      return res.status(403).json({ 
        error: 'Access denied to private asset', 
        message: 'Could not generate a signed access token for this file.',
        bucket,
        path: filePath
      });
    }

    // Redirect to the actual signed Supabase URL (which includes the token)
    return res.redirect(signedUrl);
  } catch (err) {
    console.error('Asset URL error:', err);
    res.status(500).json({ error: 'Failed to get asset URL' });
  }
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

router.post('/', authenticateToken, upload.single('file'), uploadController.uploadFile);

// Multer and upload errors (e.g. LIMIT_FILE_SIZE)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File too large. Maximum size is 5MB.' });
  }
  if (err) {
    return res.status(400).json({ message: err.message || 'File upload error' });
  }
  next();
});

module.exports = router;
