const fs = require('fs');
const { generatePackagesJson, writePackagesJson } = require('./generate-packages.js');
const { cleanupNonVPrefixedReleases } = require('./cleanup-releases.js');

/**
 * Main function to generate packages.json with cleanup
 * @param {string} distPath - Path to the dist directory (default: current directory)
 */
function generatePackagesWithCleanup(distPath = '.') {
    console.log('Starting packages.json generation process...');

    try {
        // Step 1: Clean up non-v-prefixed release directories
        cleanupNonVPrefixedReleases(distPath);

        // Step 2: Read repository metadata from previous step
        let repositoryMetadata = [];
        const metadataPath = 'repo-metadata.json';

        try {
            const metadataContent = fs.readFileSync(metadataPath, 'utf8');
            repositoryMetadata = JSON.parse(metadataContent);
            console.log(`Loaded metadata for ${repositoryMetadata.length} repositories`);
        } catch (error) {
            console.log('No repository metadata found, continuing without archived status');
        }

        // Step 3: Generate the packages data
        const packagesData = generatePackagesJson(distPath, repositoryMetadata);

        // Step 4: Write the packages.json file
        writePackagesJson(packagesData, './packages.json');

        console.log('Packages.json generation completed successfully');
        return packagesData;

    } catch (error) {
        console.error('Error during packages.json generation:', error);
        throw error;
    }
}

module.exports = {
    generatePackagesWithCleanup
};
