const fs = require('node:fs');
const path = require('node:path');

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
  return value.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`);
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
 * @param {Object|string} repository - GitHub repository record or configured directory.
 * @param {string} assetName - Release asset filename.
 * @returns {boolean} True when the asset should be downloaded and retained.
 */
function shouldIncludeAsset(config, repository, assetName) {
  const repoConfig = getRepositoryConfig(config, repository);
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

/**
 * Find a repository's retention policy, including after an organization transfer.
 * @param {Object} config - Loaded package config.
 * @param {Object|string} repository - GitHub repository record or qualified name.
 * @returns {Object|undefined} Matching retention policy.
 */
function getRepositoryConfig(config, repository) {
  if (typeof repository === 'string') {
    return config.repositories[repository] || Object.values(config.repositories)
      .find(entry => entry.directory === repository);
  }
  const named = config.repositories[repository.full_name];
  if (named && (!named.repositoryId || named.repositoryId === repository.id)) return named;
  return Object.values(config.repositories).find(entry => entry.repositoryId === repository.id);
}

/**
 * Use an explicit legacy directory or a transfer-stable GitHub repository ID.
 * @param {Object} config - Loaded package config.
 * @param {Object} repository - GitHub repository record.
 * @returns {string} Single directory name within dist.
 */
function getRepositoryDirectory(config, repository) {
  if (!Number.isSafeInteger(repository.id) || repository.id <= 0) {
    throw new Error(`Invalid GitHub repository ID for ${repository.full_name}`);
  }
  const directory = getRepositoryConfig(config, repository)?.directory ?? String(repository.id);
  if (typeof directory !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(directory)) {
    throw new Error(`Invalid package directory for ${repository.full_name}`);
  }
  return directory;
}

module.exports = {
  getRepositoryConfig,
  getRepositoryDirectory,
  loadPackageConfig,
  shouldIncludeAsset
};
