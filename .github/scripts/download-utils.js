/**
 * Download Utilities
 * Handles downloading assets from GitHub releases
 */
const { writeFile } = require('./file-utils');

/**
 * Download file from URL with authentication
 */
async function downloadFile(url, filePath, token) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'GitHub Actions'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  writeFile(filePath, Buffer.from(buffer));
}

/**
 * Download asset with retry logic
 */
async function downloadAssetWithRetry(url, filePath, token, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadFile(url, filePath, token);
      return true;
    } catch (error) {
      console.error(`Download attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return false;
}

module.exports = {
  downloadFile,
  downloadAssetWithRetry
};
