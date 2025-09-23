/**
 * Asset Synchronization Script
 * Main script for downloading and organizing release assets
 */
const path = require('path');
const { ensureDir, fileExists, writeFile } = require('./file-utils');
const { generateHashFiles } = require('./hash-utils');
const { downloadAssetWithRetry } = require('./download-utils');

/**
 * Process a single repository and download its release assets
 */
async function processRepository(github, context, repo, repositoryData, totalAssets, isPullRequest = false, releaseLimit = null, maxNewAssets = 0, newAssetsDownloaded = 0) {
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

    // Filter out draft and prerelease
    const publishedReleases = releases.filter(release => !release.draft && !release.prerelease);

    if (publishedReleases.length === 0) {
      console.log(`No published releases found for ${repo.name}`);
      return { totalAssets, processedReleases: 0, newAssetsDownloaded };
    }

    const repoData = {
      name: repo.name,
      releases: []
    };

    for (const release of publishedReleases) {
      // Check if we've reached the asset limit globally
      if (maxNewAssets > 0 && (newAssetsDownloaded + repoNewAssets) >= maxNewAssets) {
        console.log(`Reached maximum new assets limit (${maxNewAssets}). Stopping processing for ${repo.name}.`);
        break;
      }

      // For pull requests, stop after processing the specified number of releases with assets
      if (isPullRequest && releaseLimit && processedReleasesWithAssets >= releaseLimit) {
        console.log(`PR mode: Reached limit of ${releaseLimit} releases with assets for ${repo.name}`);
        break;
      }

      const result = await processRelease(repo.name, release, maxNewAssets, newAssetsDownloaded + repoNewAssets);
      const assetCount = result.assetCount;
      const newAssets = result.newAssets;

      totalAssets += assetCount;
      repoNewAssets += newAssets;

      if (assetCount > 0) {
        repoData.releases.push({
          tag: release.tag_name,
          assetCount: assetCount
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
 * Process a single release and download its assets
 */
async function processRelease(repoName, release, maxNewAssets = 0, currentNewAssets = 0) {
  console.log(`Processing release: ${release.tag_name}`);

  if (release.assets.length === 0) {
    console.log(`No assets found for release ${release.tag_name}`);
    return { assetCount: 0, newAssets: 0 };
  }

  // Create directory structure
  const releaseDir = path.join(repoName, release.tag_name);
  ensureDir(releaseDir);

  let assetCount = 0;
  let newAssets = 0;

  for (const asset of release.assets) {
    // Check if we've reached the new assets download limit
    if (maxNewAssets > 0 && (currentNewAssets + newAssets) >= maxNewAssets) {
      console.log(`Reached maximum new assets limit (${maxNewAssets}) for this run. Stopping asset processing for release ${release.tag_name}.`);
      break;
    }

    const result = await processAsset(releaseDir, asset);
    if (result.downloaded) {
      assetCount++;
      if (result.isNew) {
        newAssets++;
      }
    }
  }

  return { assetCount, newAssets };
}

/**
 * Process a single asset - download and generate hashes if not exists
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
        const fs = require('fs');
        fs.unlinkSync(assetPath);
        // Also remove associated hash files
        ['sha256', 'sha512', 'md5'].forEach(hashType => {
          const hashFile = `${assetPath}.${hashType}`;
          if (fileExists(hashFile)) {
            fs.unlinkSync(hashFile);
            console.log(`Removed hash file: ${hashFile}`);
          }
        });
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
      const fs = require('fs');
      const stats = fs.statSync(assetPath);
      if (stats.size > maxSizeBytes) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`Removing existing oversized file: ${assetPath} (${sizeMB}MB)`);
        fs.unlinkSync(assetPath);
        // Also remove associated hash files
        ['sha256', 'sha512', 'md5'].forEach(hashType => {
          const hashFile = `${assetPath}.${hashType}`;
          if (fileExists(hashFile)) {
            fs.unlinkSync(hashFile);
            console.log(`Removed hash file: ${hashFile}`);
          }
        });
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
 * Main function to sync all release assets
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

  const repositoryData = [];
  let totalAssets = 0;
  let totalProcessedReleases = 0;
  let newAssetsDownloaded = 0;

  // Process each repository
  for (const repo of repos) {
    // Check if we've reached the asset limit
    if (maxNewAssets > 0 && newAssetsDownloaded >= maxNewAssets) {
      console.log(`Reached maximum new assets limit (${maxNewAssets}). Stopping processing.`);
      break;
    }

    const result = await processRepository(
      github,
      context,
      repo,
      repositoryData,
      totalAssets,
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
}

module.exports = {
  syncReleaseAssets
};
