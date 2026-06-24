'use strict';

const cloudinary = require('cloudinary');

let configured = false;

/**
 * Ensure Cloudinary is configured from environment variables.
 * Called lazily on first upload so config validation runs first.
 */
function ensureConfigured() {
  if (!configured) {
    cloudinary.v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    configured = true;
  }
}

/**
 * Upload an image to Cloudinary and return a reference.
 *
 * A missing reference is a hard failure — callers must roll back on null.
 *
 * @param {Buffer|string} file - A Buffer, file path, or base64 data URI to upload.
 * @param {'logo'|'candidate_photo'} kind - Determines the Cloudinary folder.
 * @param {object} [deps] - Injectable dependencies for testing.
 * @param {Function} [deps.upload] - The upload function (defaults to cloudinary.v2.uploader.upload).
 * @returns {Promise<{reference: string|null, error?: string}>}
 *   On success: { reference: <secure_url> }
 *   On failure: { reference: null, error: <message> }
 */
async function storeImage(file, kind, deps) {
  const upload = (deps && deps.upload) || (ensureConfigured(), cloudinary.v2.uploader.upload);

  try {
    // If file is a Buffer, convert to a base64 data URI so cloudinary can handle it.
    let uploadSource = file;
    if (Buffer.isBuffer(file)) {
      const base64 = file.toString('base64');
      uploadSource = `data:image/png;base64,${base64}`;
    }

    const result = await upload(uploadSource, {
      folder: kind,
      resource_type: 'image',
    });

    return { reference: result.secure_url };
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown upload error';
    return { reference: null, error: message };
  }
}

module.exports = { storeImage };
