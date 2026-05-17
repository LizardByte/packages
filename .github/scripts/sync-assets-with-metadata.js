const fs = require('fs');
const { syncReleaseAssets } = require('./sync-assets.js');
const { buildPackagesData, writePackagesJson } = require('./generate-packages.js');

const LEGACY_METADATA_PATH = 'repo-metadata.json';

/**
 * Main function to sync assets and write the package index.
 * @param {Object} github - GitHub API client
 * @param {Object} context - GitHub Actions context
 * @param {boolean} isPullRequest - Whether this is a pull request event
 * @param {number} maxNewAssets - Maximum number of new assets to download
 */
async function syncAssetsWithMetadata(github, context, isPullRequest = false, maxNewAssets = 0) {
    console.log('Starting asset synchronization process...');

    try {
        // Run the asset synchronization
        const repositoryData = await syncReleaseAssets(github, context, isPullRequest, maxNewAssets);

        // Store the public package index directly. This replaces the old
        // repo-metadata.json handoff so GitHub Pages only needs one JSON file.
        const packagesData = buildPackagesData(repositoryData);
        writePackagesJson(packagesData, 'packages.json');

        if (fs.existsSync(LEGACY_METADATA_PATH)) {
            fs.unlinkSync(LEGACY_METADATA_PATH);
            console.log(`Removed legacy metadata file: ${LEGACY_METADATA_PATH}`);
        }

        console.log(`Stored package index for ${repositoryData.length} repositories in packages.json`);
        console.log('Asset synchronization completed successfully');

        return packagesData;

    } catch (error) {
        console.error('Error during asset synchronization:', error);
        throw error;
    }
}

module.exports = {
    syncAssetsWithMetadata
};
