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
async function processRepository(github, context, repo, repositoryData, totalAssets, isPullRequest = false, releaseLimit = null) {
  console.log(`Processing repository: ${repo.name}`);

  let processedReleasesWithAssets = 0;

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
      return { totalAssets, processedReleases: 0 };
    }

    const repoData = {
      name: repo.name,
      releases: []
    };

    for (const release of publishedReleases) {
      // For pull requests, stop after processing the specified number of releases with assets
      if (isPullRequest && releaseLimit && processedReleasesWithAssets >= releaseLimit) {
        console.log(`PR mode: Reached limit of ${releaseLimit} releases with assets for ${repo.name}`);
        break;
      }

      const assetCount = await processRelease(repo.name, release);
      totalAssets += assetCount;

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

  return { totalAssets, processedReleases: processedReleasesWithAssets };
}

/**
 * Process a single release and download its assets
 */
async function processRelease(repoName, release) {
  console.log(`Processing release: ${release.tag_name}`);

  if (release.assets.length === 0) {
    console.log(`No assets found for release ${release.tag_name}`);
    return 0;
  }

  // Create directory structure
  const releaseDir = path.join(repoName, release.tag_name);
  ensureDir(releaseDir);

  let assetCount = 0;

  for (const asset of release.assets) {
    const downloaded = await processAsset(releaseDir, asset);
    if (downloaded) {
      assetCount++;
    }
  }

  return assetCount;
}

/**
 * Process a single asset - download and generate hashes if not exists
 */
async function processAsset(releaseDir, asset) {
  const assetPath = path.join(releaseDir, asset.name);

  // Skip if asset already exists
  if (fileExists(assetPath)) {
    console.log(`Asset already exists: ${assetPath}`);
    return true;
  }

  console.log(`Downloading: ${asset.name}`);

  try {
    await downloadAssetWithRetry(
      asset.browser_download_url,
      assetPath,
      process.env.GITHUB_TOKEN
    );

    console.log(`Successfully downloaded: ${assetPath}`);

    // Generate hash files
    const hashSuccess = generateHashFiles(assetPath);

    return hashSuccess;

  } catch (error) {
    console.error(`Failed to download ${asset.name}: ${error.message}`);
    return false;
  }
}

/**
 * Generate repository data JSON for the web interface
 */
function generateRepositoryDataJson(repositoryData, totalAssets) {
  const dataJson = {
    repositories: repositoryData,
    lastUpdated: new Date().toISOString(),
    totalRepositories: repositoryData.length,
    totalReleases: repositoryData.reduce((sum, repo) => sum + repo.releases.length, 0),
    totalAssets: totalAssets
  };

  writeFile('repository-data.json', JSON.stringify(dataJson, null, 2));
  console.log('Generated repository-data.json');
}

/**
 * Main function to sync all release assets
 */
async function syncReleaseAssets(github, context, isPullRequest = false) {
  console.log('Getting repositories from organization...');

  if (isPullRequest) {
    console.log('Running in pull request mode - limiting to 2 releases with assets per repository');
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

  // Process each repository
  for (const repo of repos) {
    const result = await processRepository(
      github,
      context,
      repo,
      repositoryData,
      totalAssets,
      isPullRequest,
      isPullRequest ? 2 : null
    );
    totalAssets = result.totalAssets;
    totalProcessedReleases += result.processedReleases;
  }

  // Generate repository data JSON for the index.html
  generateRepositoryDataJson(repositoryData, totalAssets);

  if (isPullRequest) {
    console.log(`PR mode: Processed ${repositoryData.length} repositories with ${totalProcessedReleases} releases containing assets`);
  } else {
    console.log(`Processed ${repositoryData.length} repositories with assets`);
  }
}

module.exports = {
  syncReleaseAssets
};
