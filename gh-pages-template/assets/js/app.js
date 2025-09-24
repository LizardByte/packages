/**
 * Repository Data Manager
 * Handles loading and managing repository data from GitHub API
 */
class RepositoryDataManager {
    constructor() {
        this.repositoryData = [];
        this.orgName = 'LizardByte'; // Organization name
        this.distBranch = 'dist';
        this.apiBase = 'https://api.github.com';
        this.rawBase = 'https://raw.githubusercontent.com';
    }

    /**
     * Load repository data by scanning the dist branch via GitHub API
     */
    async loadRepositoryData() {
        try {
            console.log('Loading repository data from GitHub API...');

            // Get the contents of the dist branch
            const response = await fetch(`${this.apiBase}/repos/${this.orgName}/packages/contents?ref=${this.distBranch}`);

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const contents = await response.json();

            // Filter for directories (repositories)
            const repoDirs = contents.filter(item => item.type === 'dir');

            console.log(`Found ${repoDirs.length} repository directories`);

            this.repositoryData = [];

            // Process each repository directory
            for (const repoDir of repoDirs) {
                const repoData = await this.processRepository(repoDir.name);
                if (repoData && repoData.releases.length > 0) {
                    this.repositoryData.push(repoData);
                }
            }

            console.log(`Loaded data for ${this.repositoryData.length} repositories with releases`);

            return {
                repositories: this.repositoryData,
                lastUpdated: new Date().toISOString(),
                totalRepositories: this.repositoryData.length,
                totalReleases: this.repositoryData.reduce((sum, repo) => sum + repo.releases.length, 0),
                totalAssets: this.repositoryData.reduce((sum, repo) =>
                    sum + repo.releases.reduce((releaseSum, release) => releaseSum + release.assetCount, 0), 0)
            };

        } catch (error) {
            console.error('Error loading repository data:', error);
            // Fallback to empty data
            this.repositoryData = [];
            return null;
        }
    }

    /**
     * Process a single repository directory to get release information
     */
    async processRepository(repoName) {
        try {
            console.log(`Processing repository: ${repoName}`);

            // Get repository directory contents
            const response = await fetch(`${this.apiBase}/repos/${this.orgName}/packages/contents/${repoName}?ref=${this.distBranch}`);

            if (!response.ok) {
                console.warn(`Could not fetch contents for ${repoName}: ${response.status}`);
                return null;
            }

            const contents = await response.json();

            // Filter for directories (releases)
            const releaseDirs = contents.filter(item => item.type === 'dir');

            if (releaseDirs.length === 0) {
                console.log(`No release directories found for ${repoName}`);
                return null;
            }

            const repoData = {
                name: repoName,
                releases: []
            };

            // Process each release directory
            for (const releaseDir of releaseDirs) {
                const releaseData = await this.processRelease(repoName, releaseDir.name);
                if (releaseData) {
                    repoData.releases.push(releaseData);
                }
            }

            // Sort releases by tag name (newest first, assuming semantic versioning)
            repoData.releases.sort((a, b) => b.tag.localeCompare(a.tag, undefined, { numeric: true, sensitivity: 'base' }));

            return repoData;

        } catch (error) {
            console.error(`Error processing repository ${repoName}:`, error);
            return null;
        }
    }

    /**
     * Process a single release directory to count assets
     */
    async processRelease(repoName, releaseTag) {
        try {
            // Get release directory contents
            const response = await fetch(`${this.apiBase}/repos/${this.orgName}/packages/contents/${repoName}/${releaseTag}?ref=${this.distBranch}`);

            if (!response.ok) {
                console.warn(`Could not fetch release contents for ${repoName}/${releaseTag}: ${response.status}`);
                return null;
            }

            const contents = await response.json();

            // Count actual asset files (exclude hash files)
            const assetFiles = contents.filter(item =>
                item.type === 'file' &&
                !item.name.endsWith('.sha256') &&
                !item.name.endsWith('.sha512') &&
                !item.name.endsWith('.md5') &&
                item.name !== 'README.md'
            );

            if (assetFiles.length === 0) {
                return null;
            }

            return {
                tag: releaseTag,
                assetCount: assetFiles.length
            };

        } catch (error) {
            console.error(`Error processing release ${repoName}/${releaseTag}:`, error);
            return null;
        }
    }

    /**
     * Get all repository data
     */
    getRepositories() {
        return this.repositoryData;
    }

    /**
     * Filter repositories based on search term
     */
    filterRepositories(searchTerm) {
        if (!searchTerm) {
            return this.repositoryData;
        }

        return this.repositoryData.filter(repo => {
            const repoMatch = repo.name.toLowerCase().includes(searchTerm.toLowerCase());
            const releaseMatch = repo.releases.some(release =>
                release.tag.toLowerCase().includes(searchTerm.toLowerCase()));
            return repoMatch || releaseMatch;
        });
    }
}

/**
 * UI Manager
 * Handles all DOM manipulation and rendering
 */
class UIManager {
    constructor() {
        this.repositoryGrid = document.getElementById('repositoryGrid');
        this.searchInput = document.getElementById('searchInput');
        this.repoCountElement = document.getElementById('repoCount');
        this.releaseCountElement = document.getElementById('releaseCount');
        this.assetCountElement = document.getElementById('assetCount');
        this.updateTimeElement = document.getElementById('updateTime');
        this.orgName = 'LizardByte';
    }

    /**
     * Render repositories in the grid
     */
    renderRepositories(repos) {
        if (repos.length === 0) {
            this.repositoryGrid.innerHTML = '<div class="col-12 text-center text-muted fst-italic py-5">No repositories found.</div>';
            return;
        }

        this.repositoryGrid.innerHTML = repos.map(repo => `
            <div class="col-lg-4 col-md-6 mb-4" data-repo="${repo.name.toLowerCase()}">
                <div class="card h-100">
                    <div class="card-body">
                        <h5 class="card-title text-primary mb-3">${repo.name}</h5>
                        <ul class="list-group list-group-flush">
                            ${repo.releases.map(release => `
                                <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                                    <a href="https://github.com/${this.orgName}/packages/tree/dist/${repo.name}/${release.tag}"
                                       class="text-decoration-none fw-medium" target="_blank" rel="noopener">
                                        ${release.tag}
                                    </a>
                                    <span class="badge bg-secondary rounded-pill">${release.assetCount}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Update statistics display
     */
    updateStats(repos) {
        const repoCount = repos.length;
        const releaseCount = repos.reduce((sum, repo) => sum + repo.releases.length, 0);
        const assetCount = repos.reduce((sum, repo) =>
            sum + repo.releases.reduce((releaseSum, release) => releaseSum + release.assetCount, 0), 0);

        this.repoCountElement.textContent = repoCount;
        this.releaseCountElement.textContent = releaseCount;
        this.assetCountElement.textContent = assetCount;
        this.updateTimeElement.textContent = new Date().toLocaleString();
    }

    /**
     * Show loading state
     */
    showLoading() {
        this.repositoryGrid.innerHTML = '<div class="col-12 text-center text-muted fst-italic py-5">Loading repository data...</div>';
        this.repoCountElement.textContent = '-';
        this.releaseCountElement.textContent = '-';
        this.assetCountElement.textContent = '-';
        this.updateTimeElement.textContent = '-';
    }
}

/**
 * Search Manager
 * Handles search functionality
 */
class SearchManager {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.searchInput = document.getElementById('searchInput');
        this.initializeSearch();
    }

    /**
     * Initialize search functionality
     */
    initializeSearch() {
        this.searchInput.addEventListener('input', (e) => {
            this.performSearch(e.target.value);
        });
    }

    /**
     * Perform search and update UI
     */
    performSearch(searchTerm) {
        const filteredRepos = this.dataManager.filterRepositories(searchTerm);
        this.uiManager.renderRepositories(filteredRepos);
    }
}

/**
 * Main Application
 * Coordinates all components and manages application state
 */
class LizardByteAssetsApp {
    constructor() {
        this.dataManager = new RepositoryDataManager();
        this.uiManager = new UIManager();
        this.searchManager = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Show loading state
            this.uiManager.showLoading();

            // Load repository data
            const data = await this.dataManager.loadRepositoryData();
            const repositories = this.dataManager.getRepositories();

            // Render repositories and update stats
            this.uiManager.renderRepositories(repositories);
            this.uiManager.updateStats(repositories);

            // Initialize search functionality
            this.searchManager = new SearchManager(this.dataManager, this.uiManager);

            console.log(`Loaded ${repositories.length} repositories`);

        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.uiManager.repositoryGrid.innerHTML =
                '<div class="no-results">Failed to load repository data. Please try again later.</div>';
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new LizardByteAssetsApp();
    app.init();
});
