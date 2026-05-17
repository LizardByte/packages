const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'packages.config.json';

/**
 * Find packages.config.json by walking up from a starting directory.
 * @param {string} startDir - Directory to start searching from.
 * @returns {string|null} Absolute path to the config file, or null if absent.
 */
function findConfigPath(startDir = process.cwd()) {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Normalize a possibly missing pattern list to non-empty string patterns.
 * @param {unknown} value - Config value to normalize.
 * @returns {string[]} Valid pattern strings.
 */
function normalizePatterns(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(pattern => typeof pattern === 'string' && pattern.length > 0);
}

/**
 * Load release asset retention config.
 * @param {string} startDir - Directory used to locate packages.config.json.
 * @returns {{defaultInclude: boolean, repositories: Object}} Normalized package config.
 */
function loadPackageConfig(startDir = process.cwd()) {
  const configPath = findConfigPath(startDir);
  if (!configPath) {
    console.log(`No ${CONFIG_FILENAME} found; including all release assets.`);
    return {
      defaultInclude: true,
      repositories: {}
    };
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const repositories = config.repositories && typeof config.repositories === 'object'
    ? config.repositories
    : {};

  console.log(`Loaded package config from ${configPath}`);

  return {
    defaultInclude: config.defaultInclude === true,
    repositories
  };
}

/**
 * Escape literal text for use inside a regular expression.
 * @param {string} value - Raw pattern segment.
 * @returns {string} Regex-escaped segment.
 */
function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/**
 * Convert a simple wildcard pattern to a regular expression.
 * @param {string} pattern - Pattern using '*' as a wildcard.
 * @returns {RegExp} Anchored regular expression.
 */
function patternToRegex(pattern) {
  const source = pattern
    .split('*')
    .map(escapeRegex)
    .join('.*');

  return new RegExp(`^${source}$`);
}

/**
 * Check whether a value matches any configured wildcard pattern.
 * @param {string} value - Value to test.
 * @param {string[]} patterns - Wildcard patterns.
 * @returns {boolean} True when any pattern matches.
 */
function matchesPattern(value, patterns) {
  return patterns.some(pattern => patternToRegex(pattern).test(value));
}

/**
 * Determine whether a release asset should be mirrored into dist and GitHub Pages.
 * @param {{defaultInclude: boolean, repositories: Object}} config - Package config.
 * @param {string} repoName - Repository name.
 * @param {string} assetName - Release asset filename.
 * @returns {boolean} True when the asset should be downloaded and retained.
 */
function shouldIncludeAsset(config, repoName, assetName) {
  const repoConfig = config.repositories[repoName];
  if (!repoConfig) {
    return config.defaultInclude;
  }

  if (repoConfig.includeAll === true) {
    return true;
  }

  const includeAssets = normalizePatterns(repoConfig.includeAssets || repoConfig.include);
  if (includeAssets.length === 0) {
    return false;
  }

  return matchesPattern(assetName, includeAssets);
}

module.exports = {
  loadPackageConfig,
  shouldIncludeAsset
};
