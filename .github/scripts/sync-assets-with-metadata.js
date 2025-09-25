const fs = require('fs');
const { syncReleaseAssets } = require('./sync-assets.js');

/**
 * Main function to sync assets and store repository metadata
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

        // Store repository data for use in next step
        const metadataPath = 'repo-metadata.json';
        fs.writeFileSync(metadataPath, JSON.stringify(repositoryData, null, 2));

        console.log(`Stored metadata for ${repositoryData.length} repositories in ${metadataPath}`);
        console.log('Asset synchronization completed successfully');

        return repositoryData;

    } catch (error) {
        console.error('Error during asset synchronization:', error);
        throw error;
    }
}

module.exports = {
    syncAssetsWithMetadata
};
