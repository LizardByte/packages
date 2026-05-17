/**
 * Asset Synchronization Script
 * Main script for downloading and organizing release assets
 */
const fs = require('fs');
const path = require('path');
const { ensureDir, fileExists } = require('./file-utils');
const { generateHashFiles } = require('./hash-utils');
const { downloadAssetWithRetry } = require('./download-utils');
const { loadPackageConfig, shouldIncludeAsset } = require('./package-config');
const { cleanupNonVPrefixedReleases } = require('./cleanup-releases');

/**
 * Check whether a filename is one of the generated hash sidecar files.
 * @param {string} filename - File name to check.
 * @returns {boolean} True when the file is a generated hash file.
 */
function isHashFile(filename) {
  return filename.endsWith('.sha256') ||
    filename.endsWith('.sha512') ||
    filename.endsWith('.md5');
}

/**
 * Remove generated hash sidecars for a stored asset.
 * @param {string} assetPath - Path to the primary asset file.
 */
function removeHashFiles(assetPath) {
  ['sha256', 'sha512', 'md5'].forEach(hashType => {
    const hashFile = `${assetPath}.${hashType}`;
    if (fileExists(hashFile)) {
      fs.unlinkSync(hashFile);
      console.log(`Removed hash file: ${hashFile}`);
    }
  });
}

/**
 * Remove an asset and any generated hash sidecars.
 * @param {string} assetPath - Path to the primary asset file.
 */
function removeAsset(assetPath) {
  if (fileExists(assetPath)) {
    fs.unlinkSync(assetPath);
    console.log(`Removed asset: ${assetPath}`);
  }

  removeHashFiles(assetPath);
}

/**
 * Check whether a release directory still contains retained assets.
 * @param {string} directoryPath - Release directory path.
 * @returns {boolean} True when at least one non-hash asset remains.
 */
function hasAssetFiles(directoryPath) {
  return fs.readdirSync(directoryPath, { withFileTypes: true })
    .some(dirent => dirent.isFile() && !isHashFile(dirent.name));
}

/**
 * Check whether another new asset may be downloaded during this run.
 * @param {number} maxNewAssets - Maximum new assets to download; 0 means unlimited.
 * @param {number} currentNewAssets - Number of new assets already downloaded.
 * @param {number} releaseNewAssets - Number of new assets downloaded in the current release.
 * @returns {boolean} True when another new asset download is allowed.
 */
function canDownloadNewAsset(maxNewAssets, currentNewAssets, releaseNewAssets) {
  return maxNewAssets <= 0 || (currentNewAssets + releaseNewAssets) < maxNewAssets;
}

/**
 * Encode path segments for a browser URL without changing the dist directory layout.
 * @param {...string} segments - URL path segments.
 * @returns {string} Relative URL for GitHub Pages.
 */
function encodeDirectAssetUrl(...segments) {
  return segments.map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Build public metadata for a GitHub release asset.
 * @param {string} repoName - Repository name.
 * @param {string} releaseTag - Release tag.
 * @param {Object} asset - GitHub release asset API response object.
 * @returns {Object} Package index asset metadata.
 */
function buildAssetMetadata(repoName, releaseTag, asset) {
  const assetData = {
    name: asset.name,
    size: asset.size,
    githubUrl: asset.browser_download_url
  };

  if (fileExists(path.join(repoName, releaseTag, asset.name))) {
    assetData.directUrl = encodeDirectAssetUrl(repoName, releaseTag, asset.name);
  }

  return assetData;
}

/**
 * Remove stored files from dist that are no longer allowed by packages.config.json.
 * This only affects mirrored files; release metadata is still generated from GitHub.
 * @param {string} distPath - Path to the dist checkout.
 * @param {Object} packageConfig - Loaded package config.
 */
function cleanupStoredAssets(distPath, packageConfig) {
  console.log('Cleaning up stored assets excluded by package config...');

  const distContents = fs.readdirSync(distPath, { withFileTypes: true });

  for (const repoDir of distContents) {
    if (!repoDir.isDirectory() || repoDir.name === '.git' || repoDir.name.startsWith('.')) {
      continue;
    }

    const repoPath = path.join(distPath, repoDir.name);
    const repoContents = fs.readdirSync(repoPath, { withFileTypes: true });

    for (const releaseDir of repoContents) {
      if (!releaseDir.isDirectory() || !releaseDir.name.startsWith('v')) {
        continue;
      }

      const releasePath = path.join(repoPath, releaseDir.name);
      const releaseContents = fs.readdirSync(releasePath, { withFileTypes: true });

      for (const assetFile of releaseContents) {
        if (!assetFile.isFile() || isHashFile(assetFile.name)) {
          continue;
        }

        if (!shouldIncludeAsset(packageConfig, repoDir.name, assetFile.name)) {
          removeAsset(path.join(releasePath, assetFile.name));
        }
      }

      for (const hashFile of fs.readdirSync(releasePath, { withFileTypes: true })) {
        if (!hashFile.isFile() || !isHashFile(hashFile.name)) {
          continue;
        }

        const assetName = hashFile.name.replace(/\.(sha256|sha512|md5)$/, '');
        if (!fileExists(path.join(releasePath, assetName))) {
          const hashPath = path.join(releasePath, hashFile.name);
          fs.unlinkSync(hashPath);
          console.log(`Removed orphan hash file: ${hashPath}`);
        }
      }

      if (!hasAssetFiles(releasePath)) {
        fs.rmSync(releasePath, { recursive: true, force: true });
        console.log(`Removed empty release directory: ${releasePath}`);
      }
    }

    if (fs.readdirSync(repoPath).length === 0) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      console.log(`Removed empty repository directory: ${repoPath}`);
    }
  }

  console.log('Package config cleanup completed successfully');
}

/**
 * Process a single repository, collecting all release metadata while downloading only configured assets.
 * @param {Object} github - GitHub API client.
 * @param {Object} context - GitHub Actions context.
 * @param {Object} repo - Repository API response object.
 * @param {Array} repositoryData - Accumulated package metadata.
 * @param {number} totalAssets - Current total release asset count.
 * @param {Object} packageConfig - Loaded package config.
 * @param {boolean} isPullRequest - Whether this is a pull request run.
 * @param {number|null} releaseLimit - Optional release limit for pull request runs.
 * @param {number} maxNewAssets - Maximum new assets to download.
 * @param {number} newAssetsDownloaded - Number of new assets already downloaded.
 * @returns {Promise<{totalAssets: number, processedReleases: number, newAssetsDownloaded: number}>}
 */
async function processRepository(github, context, repo, repositoryData, totalAssets, packageConfig, isPullRequest = false, releaseLimit = null, maxNewAssets = 0, newAssetsDownloaded = 0) {
  console.log(`Processing repository: ${repo.name}`);

  let processedReleasesWithAssets = 0;
  let repoNewAssets = 0;

  try {
    // Get releases for the repository with pagination
    const releases = await github.paginate(github.rest.repos.listReleases, {
      owner: context.repo.owner,
      repo: repo.name,
      per_page: 100
    });

    // Filter out draft and prerelease, and only include releases with v-prefixed tags
    const publishedReleases = releases.filter(release =>
      !release.draft &&
      !release.prerelease &&
      release.tag_name.startsWith('v')
    );

    if (publishedReleases.length === 0) {
      console.log(`No published releases found for ${repo.name}`);
      return { totalAssets, processedReleases: 0, newAssetsDownloaded };
    }

    const repoData = {
      name: repo.name,
      archived: repo.archived,
      url: repo.html_url,
      releases: []
    };

    for (const release of publishedReleases) {
      // For pull requests, stop after processing the specified number of releases with assets
      if (isPullRequest && releaseLimit && processedReleasesWithAssets >= releaseLimit) {
        console.log(`PR mode: Reached limit of ${releaseLimit} releases with assets for ${repo.name}`);
        break;
      }

      const result = await processRelease(repo.name, release, packageConfig, maxNewAssets, newAssetsDownloaded + repoNewAssets);
      const assetCount = result.assetCount;
      const newAssets = result.newAssets;

      totalAssets += assetCount;
      repoNewAssets += newAssets;

      if (assetCount > 0) {
        repoData.releases.push({
          tag: release.tag_name,
          url: release.html_url,
          publishedAt: release.published_at,
          assetCount: assetCount,
          assets: result.assets
        });
        processedReleasesWithAssets++;
      }
    }

    if (repoData.releases.length > 0) {
      repositoryData.push(repoData);
    }

  } catch (error) {
    console.error(`Error processing repository ${repo.name}: ${error.message}`);
  }

  return { totalAssets, processedReleases: processedReleasesWithAssets, newAssetsDownloaded: newAssetsDownloaded + repoNewAssets };
}

/**
 * Process a single release, counting all release assets while downloading only configured assets.
 * @param {string} repoName - Repository name.
 * @param {Object} release - GitHub release API response object.
 * @param {Object} packageConfig - Loaded package config.
 * @param {number} maxNewAssets - Maximum new assets to download.
 * @param {number} currentNewAssets - Number of new assets already downloaded.
 * @returns {Promise<{assetCount: number, newAssets: number, assets: Array}>}
 */
async function processRelease(repoName, release, packageConfig, maxNewAssets = 0, currentNewAssets = 0) {
  console.log(`Processing release: ${release.tag_name}`);

  if (release.assets.length === 0) {
    console.log(`No assets found for release ${release.tag_name}`);
    return { assetCount: 0, newAssets: 0, assets: [] };
  }

  const assetCount = release.assets.length;
  const includedAssets = release.assets.filter(asset => shouldIncludeAsset(packageConfig, repoName, asset.name));
  let newAssets = 0;

  if (includedAssets.length === 0) {
    console.log(`No configured assets found for release ${release.tag_name}`);
  } else {
    // Create directory structure
    const releaseDir = path.join(repoName, release.tag_name);
    ensureDir(releaseDir);

    for (const asset of includedAssets) {
      // Check if we've reached the new assets download limit
      if (!canDownloadNewAsset(maxNewAssets, currentNewAssets, newAssets)) {
        console.log(`Reached maximum new assets limit (${maxNewAssets}) for this run. Stopping asset processing for release ${release.tag_name}.`);
        break;
      }

      const result = await processAsset(releaseDir, asset);
      if (result.downloaded && result.isNew) {
        newAssets++;
      }
    }
  }

  const assets = release.assets
    .map(asset => buildAssetMetadata(repoName, release.tag_name, asset))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return { assetCount, newAssets, assets };
}

/**
 * Process a single asset - download and generate hashes if not exists
 * @param {string} releaseDir - Directory where the asset should be stored.
 * @param {Object} asset - GitHub release asset API response object.
 * @returns {Promise<{downloaded: boolean, isNew: boolean}>}
 */
async function processAsset(releaseDir, asset) {
  const assetPath = path.join(releaseDir, asset.name);
  const maxSizeBytes = 50 * 1024 * 1024; // 50MB in bytes

  // Check if asset is too large
  if (asset.size > maxSizeBytes) {
    const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
    console.log(`Skipping ${asset.name} (${sizeMB}MB) - exceeds 50MB limit`);

    // If the file already exists and is over the size limit, remove it
    if (fileExists(assetPath)) {
      console.log(`Removing existing oversized file: ${assetPath}`);
      try {
        removeAsset(assetPath);
      } catch (error) {
        console.error(`Failed to remove oversized file ${assetPath}: ${error.message}`);
      }
    }

    return { downloaded: false, isNew: false };
  }

  // Skip if asset already exists
  if (fileExists(assetPath)) {
    console.log(`Asset already exists: ${assetPath}`);

    // Check if existing file is over size limit and remove it
    try {
      const stats = fs.statSync(assetPath);
      if (stats.size > maxSizeBytes) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`Removing existing oversized file: ${assetPath} (${sizeMB}MB)`);
        removeAsset(assetPath);
        // Continue to download the asset since we removed the oversized one
        // But first check again if the new asset would be over the limit
        if (asset.size > maxSizeBytes) {
          const assetSizeMB = (asset.size / (1024 * 1024)).toFixed(2);
          console.log(`Not re-downloading ${asset.name} (${assetSizeMB}MB) - still exceeds 50MB limit`);
          return { downloaded: false, isNew: false };
        }
      } else {
        return { downloaded: true, isNew: false };
      }
    } catch (error) {
      console.error(`Error checking existing file size for ${assetPath}: ${error.message}`);
      return { downloaded: true, isNew: false };
    }
  }

  const sizeMB = (asset.size / (1024 * 1024)).toFixed(2);
  console.log(`Downloading: ${asset.name} (${sizeMB}MB)`);

  try {
    await downloadAssetWithRetry(
      asset.browser_download_url,
      assetPath,
      process.env.GITHUB_TOKEN
    );

    console.log(`Successfully downloaded: ${assetPath}`);

    // Generate hash files
    const hashSuccess = generateHashFiles(assetPath);

    return { downloaded: hashSuccess, isNew: true };

  } catch (error) {
    console.error(`Failed to download ${asset.name}: ${error.message}`);
    return { downloaded: false, isNew: false };
  }
}

/**
 * Sync package metadata for all release assets and mirror only configured assets to dist.
 * @param {Object} github - GitHub API client.
 * @param {Object} context - GitHub Actions context.
 * @param {boolean} isPullRequest - Whether this is a pull request run.
 * @param {number} maxNewAssets - Maximum new assets to download.
 * @returns {Promise<Array>} Repository metadata for packages.json.
 */
async function syncReleaseAssets(github, context, isPullRequest = false, maxNewAssets = 0) {
  console.log('Getting repositories from organization...');

  if (isPullRequest) {
    console.log('Running in pull request mode - limiting to 2 releases with assets per repository');
  }

  if (maxNewAssets > 0) {
    console.log(`Asset download limit: ${maxNewAssets} new assets per run`);
  } else {
    console.log('Asset download limit: unlimited');
  }

  // Get all repositories with pagination
  const repos = await github.paginate(github.rest.repos.listForOrg, {
    org: context.repo.owner,
    type: 'all',
    per_page: 100
  });

  console.log(`Found ${repos.length} repositories`);

  const packageConfig = loadPackageConfig(process.cwd());
  cleanupNonVPrefixedReleases('.');
  cleanupStoredAssets('.', packageConfig);

  const repositoryData = [];
  let totalAssets = 0;
  let totalProcessedReleases = 0;
  let newAssetsDownloaded = 0;

  // Process each repository
  for (const repo of repos) {
    const result = await processRepository(
      github,
      context,
      repo,
      repositoryData,
      totalAssets,
      packageConfig,
      isPullRequest,
      isPullRequest ? 2 : null,
      maxNewAssets,
      newAssetsDownloaded
    );
    totalAssets = result.totalAssets;
    totalProcessedReleases += result.processedReleases;
    newAssetsDownloaded = result.newAssetsDownloaded;
  }

  if (isPullRequest) {
    console.log(`PR mode: Processed ${repositoryData.length} repositories with ${totalProcessedReleases} releases containing assets`);
  } else {
    console.log(`Processed ${repositoryData.length} repositories with assets`);
  }

  if (maxNewAssets > 0) {
    console.log(`Downloaded ${newAssetsDownloaded} new assets (limit: ${maxNewAssets})`);
  } else {
    console.log(`Downloaded ${newAssetsDownloaded} new assets`);
  }

  // Return repository data with archived status
  return repositoryData;
}

module.exports = {
  canDownloadNewAsset,
  syncReleaseAssets
};
