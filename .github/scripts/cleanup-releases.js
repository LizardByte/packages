const fs = require('fs');
const path = require('path');

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

                const repoPath = path.join(distPath, dirent.name);

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
                    console.log(`Error processing repository ${dirent.name}:`, repoError.message);
                }
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
