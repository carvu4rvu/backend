const fs = require('fs');
const path = require('path');

exports.uploadFile = async (req, res) => {
  try {
    const file = req.file;
    const { usn, folder } = req.body;

    if (!file) {
      const contentType = req.headers['content-type'] || '';
      const hint = contentType.includes('multipart') ? 'Field name must be "file".' : 'Request must be multipart/form-data with a field named "file".';
      return res.status(400).json({ message: 'No file uploaded', error: 'No file uploaded', hint });
    }

    if (!usn) {
      return res.status(400).json({ error: 'USN is required' });
    }

    // Sanitize USN and folder name
    const sanitizedUsn = usn.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9]/g, '_');
    
    // Create directory structure: public/{folder}/{usn}/
    const publicDir = path.join(__dirname, '..', 'public');
    const folderDir = path.join(publicDir, sanitizedFolder);
    const usnDir = path.join(folderDir, sanitizedUsn);

    // Create directories if they don't exist
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    if (!fs.existsSync(folderDir)) {
      fs.mkdirSync(folderDir, { recursive: true });
    }
    if (!fs.existsSync(usnDir)) {
      fs.mkdirSync(usnDir, { recursive: true });
    }

    // Sanitize filename and add timestamp
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, fileExtension).replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${timestamp}_${baseName}${fileExtension}`;
    const filePath = path.join(usnDir, fileName);

    // Write file to disk
    fs.writeFileSync(filePath, file.buffer);

    // Return relative path from public directory (for URL construction)
    const relativePath = path.join(sanitizedFolder, sanitizedUsn, fileName).replace(/\\/g, '/');
    const url = `/uploads/${relativePath}`;

    res.status(200).json({
      message: 'File uploaded successfully',
      path: relativePath,
      url: url
    });

  } catch (err) {
    console.error('Upload controller error:', err);
    res.status(500).json({ error: 'Server error during upload', details: err.message });
  }
};
