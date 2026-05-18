const storageService = require('../services/storageService');
const { StorageError } = require('../services/storageService');

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;
    const { usn, folder, project_id, alumni_id, company_id } = req.body;

    if (!file) {
      const contentType = req.headers['content-type'] || '';
      const hint = contentType.includes('multipart') ? 'Field name must be "file".' : 'Request must be multipart/form-data with a field named "file".';
      return res.status(400).json({ message: 'No file uploaded', error: 'No file uploaded', hint });
    }

    const entityId = usn || project_id || alumni_id || company_id;
    if (!entityId) {
      return res.status(400).json({ error: 'USN, project_id, alumni_id, or company_id is required' });
    }

    let bucketOverride;
    if (alumni_id != null) bucketOverride = 'alumni-assets';
    else if (company_id != null) bucketOverride = 'company-assets';
    else if (project_id != null) bucketOverride = 'projects';

    const { url, path: storagePath, bucket } = await storageService.upload(
      file.buffer,
      folder || 'uploads',
      entityId,
      file.originalname,
      bucketOverride
    );

    res.status(200).json({
      message: 'File uploaded successfully',
      path: storagePath,
      url,
      bucket,
    });
  } catch (err) {
    console.error('Upload controller error:', err);
    if (err instanceof StorageError) {
      const status = err.code === 'AUTH' ? 503 : err.retryable ? 503 : 400;
      return res.status(status).json({
        message: err.userMessage,
        error: err.userMessage,
        code: err.code,
        retryable: err.retryable,
      });
    }
    const msg = err.message || 'Server error during upload';
    res.status(500).json({ message: msg, error: msg, code: 'UNKNOWN' });
  }
};
