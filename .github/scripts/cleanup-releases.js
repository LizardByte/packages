const fs = require('node:fs');
const path = require('node:path');

/**
 * Remove non-v-prefixed release directories from a single repository.
 * @param {string} repoPath - Path to the repository directory.
 */
function cleanupRepositoryReleases(repoPath) {
    try {
        const repoContents = fs.readdirSync(repoPath, { withFileTypes: true });

        for (const releaseDir of repoContents) {
            if (releaseDir.isDirectory() && !releaseDir.name.startsWith('v')) {
                const releasePath = path.join(repoPath, releaseDir.name);
                console.log(`Removing non-v-prefixed release directory: ${releasePath}`);
                fs.rmSync(releasePath, { recursive: true, force: true });
            }
        }
    } catch (repoError) {
        console.log(`Error processing repository ${path.basename(repoPath)}:`, repoError.message);
    }
}

/**
 * Clean up non-v-prefixed release directories from the dist directory
 * @param {string} distPath - Path to the dist directory (default: current directory)
 */
function cleanupNonVPrefixedReleases(distPath = '.') {
    console.log('Cleaning up non-v-prefixed release directories...');

    try {
        const distContents = fs.readdirSync(distPath, { withFileTypes: true });

        for (const dirent of distContents) {
            if (dirent.isDirectory() &&
                dirent.name !== '.git' &&
                dirent.name !== 'packages.json' &&
                !dirent.name.startsWith('.')) {

                cleanupRepositoryReleases(path.join(distPath, dirent.name));
            }
        }

        console.log('Cleanup completed successfully');

    } catch (error) {
        console.error('Error during cleanup:', error.message);
        throw error;
    }
}

module.exports = {
    cleanupNonVPrefixedReleases
};
