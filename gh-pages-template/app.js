/**
 * Repository Data Manager
 * Handles loading and managing repository data from the JSON file
 */
class RepositoryDataManager {
    constructor() {
        this.repositoryData = [];
    }

    /**
     * Load repository data from the JSON file or fallback to directory scanning
     */
    async loadRepositoryData() {
        try {
            // Try to load from the generated JSON file
            const response = await fetch('./repository-data.json');
            if (response.ok) {
                const data = await response.json();
                this.repositoryData = data.repositories || [];
                return data;
            } else {
                // Fallback: scan the directory structure
                await this.scanDirectoryStructure();
                return null;
            }
        } catch (error) {
            console.log('Using directory scanning fallback');
            await this.scanDirectoryStructure();
            return null;
        }
    }

    /**
     * Fallback method for scanning directory structure
     * In a real GitHub Pages environment, we'd need the JSON data file
     */
    async scanDirectoryStructure() {
        // This is a simplified version that would work if we can list directories
        // In a real GitHub Pages environment, we'd need the JSON data file
        this.repositoryData = [];
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
    }

    /**
     * Render repositories in the grid
     */
    renderRepositories(repos) {
        if (repos.length === 0) {
            this.repositoryGrid.innerHTML = '<div class="no-results">No repositories found.</div>';
            return;
        }

        this.repositoryGrid.innerHTML = repos.map(repo => `
            <div class="repository-card" data-repo="${repo.name.toLowerCase()}">
                <h3 class="repository-name">${repo.name}</h3>
                <ul class="release-list">
                    ${repo.releases.map(release => `
                        <li class="release-item">
                            <a href="./${repo.name}/${release.tag}/" class="release-link">
                                <span class="release-tag">${release.tag}</span>
                            </a>
                            <span class="asset-count">${release.assetCount} assets</span>
                        </li>
                    `).join('')}
                </ul>
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
        this.repositoryGrid.innerHTML = '<div class="no-results">Loading repository data...</div>';
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
