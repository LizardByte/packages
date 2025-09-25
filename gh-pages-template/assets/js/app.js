/**
 * Repository Data Manager
 * Handles loading and managing repository data from a single JSON file
 */
class RepositoryDataManager {
    constructor() {
        this.repositoryData = [];
        this.orgName = 'LizardByte'; // Organization name
        this.distBranch = 'dist';
        this.rawBase = 'https://raw.githubusercontent.com';
    }

    /**
     * Load repository data from packages.json in the dist branch
     */
    async loadRepositoryData() {
        try {
            console.log('Loading repository data from packages.json...');

            // Fetch the packages.json file from the dist branch
            const response = await fetch(`${this.rawBase}/${this.orgName}/packages/${this.distBranch}/packages.json`);

            if (!response.ok) {
                throw new Error(`Failed to fetch packages.json: ${response.status}`);
            }

            const data = await response.json();

            // Validate the data structure
            if (!data.repositories || !Array.isArray(data.repositories)) {
                throw new Error('Invalid packages.json format: missing repositories array');
            }

            this.repositoryData = data.repositories;

            console.log(`Loaded data for ${this.repositoryData.length} repositories from packages.json`);

            return {
                repositories: this.repositoryData,
                lastUpdated: data.lastUpdated || new Date().toISOString(),
                totalRepositories: this.repositoryData.length,
                totalReleases: this.repositoryData.reduce((sum, repo) => sum + (repo.releases ? repo.releases.length : 0), 0),
                totalAssets: this.repositoryData.reduce((sum, repo) =>
                    sum + (repo.releases ? repo.releases.reduce((releaseSum, release) => releaseSum + (release.assetCount || 0), 0) : 0), 0)
            };

        } catch (error) {
            console.error('Error loading repository data:', error);
            // Fallback to empty data
            this.repositoryData = [];
            return {
                repositories: [],
                error: error.message,
                lastUpdated: new Date().toISOString(),
                totalRepositories: 0,
                totalReleases: 0,
                totalAssets: 0
            };
        }
    }

    /**
     * Get all repository data
     */
    getRepositories() {
        return this.repositoryData;
    }

    /**
     * Filter repositories based on search term and archived status
     */
    filterRepositories(searchTerm, showArchived = true) {
        let filteredRepos = this.repositoryData;

        // Filter by archived status first
        if (!showArchived) {
            filteredRepos = filteredRepos.filter(repo => !repo.archived);
        }

        // Then filter by search term if provided
        if (!searchTerm) {
            return filteredRepos;
        }

        return filteredRepos.filter(repo => {
            const repoMatch = repo.name.toLowerCase().includes(searchTerm.toLowerCase());
            const releaseMatch = repo.releases?.some(release =>
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
            this.repositoryGrid.innerHTML = '<div class="col-12 text-center fst-italic py-5">No repositories found.</div>';
            return;
        }

        this.repositoryGrid.innerHTML = repos.map(repo => {
            // Show only the latest 5 releases
            const displayReleases = repo.releases ? repo.releases.slice(0, 5) : [];
            const hasMoreReleases = repo.releases && repo.releases.length > 5;
            const remainingCount = hasMoreReleases ? repo.releases.length - 5 : 0;

            // Extract ternary operation for better readability
            const releaseText = remainingCount > 1 ? 's' : '';

            return `
                <div class="col-lg-4 col-md-6 mb-4" data-repo="${repo.name.toLowerCase()}" ${repo.archived ? 'data-archived="true"' : ''}>
                    <div class="card h-100 shadow border-0 rounded-0">
                        <div class="card-body text-white p-4 rounded-0">
                            <h5 class="card-title text-info mb-3">
                                ${repo.name}
                                ${repo.archived ? '<span class="badge bg-warning text-dark ms-2">Archived</span>' : ''}
                            </h5>
                            <ul class="list-group list-group-flush">
                                ${displayReleases.length > 0 ? displayReleases.map(release => `
                                    <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                                        <a href="https://github.com/${this.orgName}/packages/tree/dist/${repo.name}/${release.tag}"
                                           class="text-decoration-none fw-medium" target="_blank" rel="noopener">
                                            ${release.tag}
                                        </a>
                                        <span class="badge bg-secondary rounded-pill">${release.assetCount}</span>
                                    </li>
                                `).join('') : '<li class="list-group-item">No releases found</li>'}
                                ${hasMoreReleases ? `
                                    <li class="list-group-item px-0 text-center">
                                        <a href="https://github.com/${this.orgName}/packages/tree/dist/${repo.name}"
                                           class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener">
                                            Show ${remainingCount} more release${releaseText}
                                        </a>
                                    </li>
                                ` : ''}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Update statistics display
     */
    updateStats(repos) {
        const repoCount = repos.length;
        const releaseCount = repos.reduce((sum, repo) => sum + (repo.releases ? repo.releases.length : 0), 0);
        const assetCount = repos.reduce((sum, repo) =>
            sum + (repo.releases ? repo.releases.reduce((releaseSum, release) => releaseSum + (release.assetCount || 0), 0) : 0), 0);

        this.repoCountElement.textContent = repoCount;
        this.releaseCountElement.textContent = releaseCount;
        this.assetCountElement.textContent = assetCount;
        this.updateTimeElement.textContent = new Date().toLocaleString();
    }

    /**
     * Show loading state
     */
    showLoading() {
        this.repositoryGrid.innerHTML = '<div class="col-12 text-center fst-italic py-5">Loading repository data...</div>';
        this.repoCountElement.textContent = '-';
        this.releaseCountElement.textContent = '-';
        this.assetCountElement.textContent = '-';
        this.updateTimeElement.textContent = '-';
    }
}

/**
 * Filter Manager
 * Handles search and archived repository filtering functionality
 */
class FilterManager {
    constructor(dataManager, uiManager) {
        this.dataManager = dataManager;
        this.uiManager = uiManager;
        this.searchInput = document.getElementById('searchInput');
        this.archivedToggle = document.getElementById('showArchivedToggle');
        this.initializeFilters();
    }

    /**
     * Initialize filter functionality
     */
    initializeFilters() {
        // Search input handler
        this.searchInput.addEventListener('input', (e) => {
            this.applyFilters();
        });

        // Archived toggle handler
        this.archivedToggle.addEventListener('change', (e) => {
            this.applyFilters();
        });
    }

    /**
     * Apply all filters and update UI
     */
    applyFilters() {
        const searchTerm = this.searchInput.value;
        const showArchived = this.archivedToggle.checked;

        const filteredRepos = this.dataManager.filterRepositories(searchTerm, showArchived);
        this.uiManager.renderRepositories(filteredRepos);
        this.uiManager.updateStats(filteredRepos);
    }

    /**
     * Reset all filters
     */
    resetFilters() {
        this.searchInput.value = '';
        this.archivedToggle.checked = true;
        this.applyFilters();
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
        this.filterManager = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Show loading state
            this.uiManager.showLoading();

            // Load repository data from packages.json
            await this.dataManager.loadRepositoryData();
            const repositories = this.dataManager.getRepositories();

            // Render repositories and update stats
            this.uiManager.renderRepositories(repositories);
            this.uiManager.updateStats(repositories);

            // Initialize filter functionality
            this.filterManager = new FilterManager(this.dataManager, this.uiManager);

            console.log(`Loaded ${repositories.length} repositories`);

        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.uiManager.repositoryGrid.innerHTML =
                '<div class="col-12 text-center fst-italic py-5">Failed to load repository data. Please try again later.</div>';
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new LizardByteAssetsApp();
    app.init();
});
