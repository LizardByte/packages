const fs = require('fs');
const path = require('path');

/**
 * Generate packages.json file by scanning the dist directory structure
 * @param {string} distPath - Path to the dist directory
 * @param {Array} repositoryMetadata - Repository metadata from sync process with archived status
 * @returns {Object} Generated packages data
 */
function generatePackagesJson(distPath = '.', repositoryMetadata = []) {
    console.log(`Scanning dist directory: ${distPath}`);

    const repositories = [];

    // Create a map of repository metadata for quick lookup
    const repoMetadataMap = new Map();
    repositoryMetadata.forEach(repo => {
        repoMetadataMap.set(repo.name, repo);
    });

    try {
        // Read the dist directory
        const distDir = fs.readdirSync(distPath, { withFileTypes: true });

        // Process each subdirectory as a potential repository
        for (const dirent of distDir) {
            if (dirent.isDirectory() && dirent.name !== '.git') {
                console.log(`Processing repository: ${dirent.name}`);
                const repoData = scanRepositoryDirectory(path.join(distPath, dirent.name));
                if (repoData) {
                    // Update archived status from metadata if available
                    const metadata = repoMetadataMap.get(dirent.name);
                    if (metadata) {
                        repoData.archived = metadata.archived;
                    }

                    repositories.push(repoData);
                    console.log(`  Found ${repoData.releases.length} releases`);
                } else {
                    console.log(`  No releases with assets found`);
                }
            }
        }

        // Sort repositories by name
        repositories.sort((a, b) => a.name.localeCompare(b.name));

        // Calculate totals
        const totalReleases = repositories.reduce((sum, repo) => sum + repo.releases.length, 0);
        const totalAssets = repositories.reduce((sum, repo) =>
            sum + repo.releases.reduce((releaseSum, release) => releaseSum + release.assetCount, 0), 0
        );

        const packagesData = {
            lastUpdated: new Date().toISOString(),
            repositories: repositories,
            stats: {
                totalRepositories: repositories.length,
                totalReleases: totalReleases,
                totalAssets: totalAssets
            }
        };

        console.log(`Generated packages data:`);
        console.log(`  Repositories: ${repositories.length}`);
        console.log(`  Total Releases: ${totalReleases}`);
        console.log(`  Total Assets: ${totalAssets}`);

        return packagesData;

    } catch (error) {
        console.error('Error scanning dist directory:', error);
        throw error;
    }
}

/**
 * Scan a repository directory to find releases and count assets
 * @param {string} repoPath - Path to the repository directory
 * @returns {Object|null} Repository data with releases or null if no valid releases
 */
function scanRepositoryDirectory(repoPath) {
    const repoName = path.basename(repoPath);
    const releases = [];

    try {
        if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
            return null;
        }

        // Scan for release directories
        const repoDirContents = fs.readdirSync(repoPath, { withFileTypes: true });

        for (const dirent of repoDirContents) {
            if (dirent.isDirectory() && dirent.name.startsWith('v')) { // Only process v-prefixed releases
                const releaseData = scanReleaseDirectory(path.join(repoPath, dirent.name));
                if (releaseData) {
                    releases.push(releaseData);
                }
            }
        }

        // Sort releases by tag name (newest first, assuming semantic versioning)
        releases.sort((a, b) => b.tag.localeCompare(a.tag, undefined, { numeric: true, sensitivity: 'base' }));

        if (releases.length > 0) {
            return {
                name: repoName,
                archived: false, // This will be updated by the sync process with actual GitHub data
                releases: releases
            };
        }

        return null;

    } catch (error) {
        console.error(`Error processing repository ${repoName}:`, error);
        return null;
    }
}

/**
 * Scan a release directory to count asset files
 * @param {string} releasePath - Path to the release directory
 * @returns {Object|null} Release data with asset count or null if no assets
 */
function scanReleaseDirectory(releasePath) {
    const releaseTag = path.basename(releasePath);

    try {
        if (!fs.existsSync(releasePath) || !fs.statSync(releasePath).isDirectory()) {
            return null;
        }

        // Count actual asset files (exclude hash files and README)
        const releaseContents = fs.readdirSync(releasePath, { withFileTypes: true });
        const assetFiles = releaseContents.filter(dirent => {
            if (!dirent.isFile()) return false;

            const filename = dirent.name;
            // Skip hash files and README
            return !(filename.endsWith('.sha256') ||
                    filename.endsWith('.sha512') ||
                    filename.endsWith('.md5') ||
                    filename === 'README.md');
        });

        if (assetFiles.length > 0) {
            return {
                tag: releaseTag,
                assetCount: assetFiles.length
            };
        }

        return null;

    } catch (error) {
        console.error(`Error processing release ${releaseTag}:`, error);
        return null;
    }
}

/**
 * Write packages.json file to the specified path
 * @param {Object} packagesData - The packages data to write
 * @param {string} outputPath - Path where to write the packages.json file
 */
function writePackagesJson(packagesData, outputPath = './packages.json') {
    try {
        const jsonString = JSON.stringify(packagesData, null, 2);
        fs.writeFileSync(outputPath, jsonString, 'utf8');
        console.log(`Generated packages.json: ${outputPath}`);
    } catch (error) {
        console.error('Error writing packages.json:', error);
        throw error;
    }
}

module.exports = {
    generatePackagesJson,
    scanRepositoryDirectory,
    scanReleaseDirectory,
    writePackagesJson
};
