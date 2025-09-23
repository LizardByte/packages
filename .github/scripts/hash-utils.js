/**
 * Hash Generation Utilities
 * Handles generating hash files for downloaded assets
 */
const crypto = require('crypto');
const { readFile, writeFile } = require('./file-utils');

/**
 * Generate hash for a file using specified algorithm
 */
function generateHash(filePath, algorithm) {
  const fileBuffer = readFile(filePath);
  const hash = crypto.createHash(algorithm);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Generate all hash files for an asset
 */
function generateHashFiles(assetPath) {
  console.log(`Generating hash files for: ${assetPath}`);

  try {
    // Generate hashes
    const sha256Hash = generateHash(assetPath, 'sha256');
    const sha512Hash = generateHash(assetPath, 'sha512');
    const md5Hash = generateHash(assetPath, 'md5');

    // Write hash files
    writeFile(`${assetPath}.sha256`, sha256Hash);
    writeFile(`${assetPath}.sha512`, sha512Hash);
    writeFile(`${assetPath}.md5`, md5Hash);

    console.log(`Hash files created for: ${assetPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to generate hash files for ${assetPath}: ${error.message}`);
    return false;
  }
}

module.exports = {
  generateHash,
  generateHashFiles
};
