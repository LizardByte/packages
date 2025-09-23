/**
 * File System Utilities
 * Handles directory creation and file operations
 */
const fs = require('fs');
const path = require('path');

/**
 * Ensure directory exists, create if it doesn't
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if file exists
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Write file safely
 */
function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content);
}

/**
 * Read file safely
 */
function readFile(filePath) {
  return fs.readFileSync(filePath);
}

module.exports = {
  ensureDir,
  fileExists,
  writeFile,
  readFile
};
