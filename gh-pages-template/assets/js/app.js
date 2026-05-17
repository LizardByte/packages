const DEFAULT_PAGE_TITLE = document.title || 'Packages';

/**
 * Escape a value for safe insertion into HTML content.
 * @param {unknown} value - Value to escape.
 * @returns {string} Escaped HTML string.
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape a value for safe insertion into an HTML attribute.
 * @param {unknown} value - Value to escape.
 * @returns {string} Escaped attribute string.
 */
function escapeAttribute(value) {
    return escapeHtml(value);
}

/**
 * Build the client-side release route for a repository release.
 * @param {string} repoName - Repository name.
 * @param {string} releaseTag - Release tag.
 * @returns {string} Hash route for the release detail view.
 */
function buildReleaseHash(repoName, releaseTag) {
    return `#/release/${encodeURIComponent(repoName)}/${encodeURIComponent(releaseTag)}`;
}

/**
 * Parse the current hash into a release route, when one is active.
 * @returns {{repoName: string, releaseTag: string}|null} Parsed route or null for the package list.
 */
function parseReleaseHash() {
    const prefix = '#/release/';
    const hash = window.location.hash || '';

    if (!hash.startsWith(prefix)) {
        return null;
    }

    const parts = hash.slice(prefix.length).split('/');
    if (parts.length < 2) {
        return null;
    }

    try {
        return {
            repoName: decodeURIComponent(parts[0]),
            releaseTag: decodeURIComponent(parts.slice(1).join('/'))
        };
    } catch (error) {
        console.warn('Invalid release route:', error);
        return null;
    }
}

/**
 * Repository Data Manager
 * Handles loading and managing repository data from packages.json.
 */
class RepositoryDataManager {
    constructor() {
        this.repositoryData = [];
        this.orgName = 'LizardByte'; // Organization name
        this.packagesPath = 'packages.json';
    }

    /**
     * Fetch the last successful workflow run time from GitHub API.
     */
    async fetchLastWorkflowRun() {
        try {
            console.log('Fetching last successful workflow run...');

            // Fetch workflow runs for the update-pages.yml workflow
            const response = await fetch(`https://api.github.com/repos/${this.orgName}/packages/actions/workflows/update-pages.yml/runs?event=schedule&status=success&branch=master&per_page=1`);

            if (!response.ok) {
                console.warn(`Failed to fetch workflow runs: ${response.status}`);
                return null;
            }

            const data = await response.json();

            if (data.workflow_runs && data.workflow_runs.length > 0) {
                const lastRun = data.workflow_runs[0];
                console.log(`Last successful workflow run: ${lastRun.updated_at}`);
                return lastRun.updated_at;
            }

            return null;

        } catch (error) {
            console.error('Error fetching workflow run:', error);
            return null;
        }
    }

    /**
     * Load repository data from the packages.json published with GitHub Pages.
     */
    async loadRepositoryData() {
        try {
            console.log('Loading repository data from packages.json...');

            const response = await fetch(this.packagesPath);

            if (!response.ok) {
                throw new Error(`Failed to fetch packages.json: ${response.status}`);
            }

            const data = await response.json();

            // Validate the data structure
            if (!data.repositories || !Array.isArray(data.repositories)) {
                throw new Error('Invalid packages.json format: missing repositories array');
            }

            // Normalize optional fields so the UI can handle both old and new packages.json files.
            this.repositoryData = data.repositories.map(repo => ({
                ...repo,
                releases: Array.isArray(repo.releases) ? repo.releases.map(release => ({
                    ...release,
                    assetCount: release.assetCount || (Array.isArray(release.assets) ? release.assets.length : 0),
                    assets: Array.isArray(release.assets) ? release.assets : []
                })) : []
            }));

            console.log(`Loaded data for ${this.repositoryData.length} repositories from packages.json`);

            // Use packages.json time first, then fall back to the workflow API for older package indexes.
            const lastUpdated = data.generatedAt || data.lastUpdated || await this.fetchLastWorkflowRun();

            return {
                repositories: this.repositoryData,
                lastUpdated,
                totalRepositories: data.stats?.totalRepositories ?? this.repositoryData.length,
                totalReleases: data.stats?.totalReleases ?? this.repositoryData.reduce((sum, repo) => sum + repo.releases.length, 0),
                totalAssets: data.stats?.totalAssets ?? this.repositoryData.reduce((sum, repo) =>
                    sum + repo.releases.reduce((releaseSum, release) => releaseSum + release.assetCount, 0), 0)
            };

        } catch (error) {
            console.error('Error loading repository data:', error);
            // Fallback to empty data
            this.repositoryData = [];
            return {
                repositories: [],
                error: error.message,
                lastUpdated: null,
                totalRepositories: 0,
                totalReleases: 0,
                totalAssets: 0
            };
        }
    }

    /**
     * Get all repository data.
     */
    getRepositories() {
        return this.repositoryData;
    }

    /**
     * Find a release by repository name and tag.
     */
    findRelease(repoName, releaseTag) {
        const repo = this.repositoryData.find(candidate => candidate.name === repoName);
        if (!repo) {
            return null;
        }

        const release = repo.releases.find(candidate => candidate.tag === releaseTag);
        if (!release) {
            return null;
        }

        return { repo, release };
    }

    /**
     * Filter repositories based on search term and archived status.
     */
    filterRepositories(searchTerm, showArchived = false) {
        let filteredRepos = this.repositoryData;

        // Filter by archived status first
        if (!showArchived) {
            filteredRepos = filteredRepos.filter(repo => !repo.archived);
        }

        // Then filter by search term if provided
        if (!searchTerm) {
            return filteredRepos;
        }

        const normalizedSearch = searchTerm.toLowerCase();

        return filteredRepos.filter(repo => {
            const repoMatch = repo.name.toLowerCase().includes(normalizedSearch);
            const releaseMatch = repo.releases?.some(release => {
                const tagMatch = release.tag.toLowerCase().includes(normalizedSearch);
                const assetMatch = release.assets?.some(asset =>
                    String(asset.name || '').toLowerCase().includes(normalizedSearch));
                return tagMatch || assetMatch;
            });

            return repoMatch || releaseMatch;
        });
    }
}

/**
 * UI Manager
 * Handles all DOM manipulation and rendering.
 */
class UIManager {
    constructor() {
        this.repositoryGrid = document.getElementById('repositoryGrid');
        this.searchInput = document.getElementById('searchInput');
        this.repoCountElement = document.getElementById('repoCount');
        this.releaseCountElement = document.getElementById('releaseCount');
        this.assetCountElement = document.getElementById('assetCount');
        this.updateTimeElement = document.getElementById('updateTime');
        this.homeSections = [
            document.getElementById('browseControls'),
            document.getElementById('archiveControls'),
            document.getElementById('statsGrid')
        ].filter(Boolean);
        this.orgName = 'LizardByte';
        this.lastUpdated = null; // Store lastUpdated from packages.json
        this.expandedRepositories = new Set();
        this.currentRepos = [];
    }

    /**
     * Show or hide controls that only apply to the repository list view.
     * @param {boolean} visible - Whether home controls should be visible.
     */
    setHomeControlsVisible(visible) {
        this.homeSections.forEach(section => {
            section.classList.toggle('d-none', !visible);
        });
    }

    /**
     * Get a release asset count from either explicit count or asset details.
     * @param {Object} release - Release data.
     * @returns {number} Asset count.
     */
    getReleaseAssetCount(release) {
        return release.assetCount || (Array.isArray(release.assets) ? release.assets.length : 0);
    }

    /**
     * Render repositories in the grid.
     */
    renderRepositories(repos) {
        this.setHomeControlsVisible(true);
        this.currentRepos = repos;

        if (repos.length === 0) {
            this.repositoryGrid.innerHTML = '<div class="col-12 text-center fst-italic py-5">No repositories found.</div>';
            return;
        }

        this.repositoryGrid.innerHTML = repos.map(repo => {
            const releases = Array.isArray(repo.releases) ? repo.releases : [];
            const isExpanded = this.expandedRepositories.has(repo.name);
            // Show only the latest 5 releases unless the repository card is expanded.
            const displayReleases = isExpanded ? releases : releases.slice(0, 5);
            const hasMoreReleases = releases.length > 5;
            const remainingCount = Math.max(releases.length - 5, 0);

            // Extract ternary operation for better readability
            const releaseText = remainingCount === 1 ? '' : 's';

            return `
                <div class="col-lg-4 col-md-6 mb-4" data-repo="${escapeAttribute(repo.name.toLowerCase())}" ${repo.archived ? 'data-archived="true"' : ''}>
                    <div class="card h-100 shadow border-0 rounded-0">
                        <div class="card-body p-4 rounded-0">
                            <h5 class="card-title text-info mb-3">
                                ${escapeHtml(repo.name)}
                                ${repo.archived ? '<span class="badge bg-warning text-dark ms-2">Archived</span>' : ''}
                            </h5>
                            <ul class="list-group list-group-flush">
                                ${displayReleases.length > 0 ? displayReleases.map(release => `
                                    <li class="list-group-item d-flex justify-content-between align-items-center px-0 gap-3">
                                        <a href="${escapeAttribute(buildReleaseHash(repo.name, release.tag))}"
                                           class="text-decoration-none fw-medium">
                                            ${escapeHtml(release.tag)}
                                        </a>
                                        <span class="badge bg-secondary rounded-pill">${this.getReleaseAssetCount(release)}</span>
                                    </li>
                                `).join('') : '<li class="list-group-item">No releases found</li>'}
                                ${hasMoreReleases ? `
                                    <li class="list-group-item px-0 text-center">
                                        <button type="button"
                                                class="btn btn-outline-primary btn-sm js-toggle-releases"
                                                data-repo="${escapeAttribute(repo.name)}">
                                            ${isExpanded ? 'Show fewer releases' : `Show ${remainingCount} more release${releaseText}`}
                                        </button>
                                    </li>
                                ` : ''}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this.bindReleaseToggleButtons();
    }

    /**
     * Bind show-more/show-fewer handlers for repository release lists.
     */
    bindReleaseToggleButtons() {
        this.repositoryGrid.querySelectorAll('.js-toggle-releases').forEach(button => {
            button.addEventListener('click', () => {
                const repoName = button.dataset.repo;
                if (this.expandedRepositories.has(repoName)) {
                    this.expandedRepositories.delete(repoName);
                } else {
                    this.expandedRepositories.add(repoName);
                }

                this.renderRepositories(this.currentRepos);
            });
        });
    }

    /**
     * Render one release's asset links.
     */
    renderReleaseDetail(repo, release) {
        this.setHomeControlsVisible(false);

        const assets = Array.isArray(release.assets) ? release.assets : [];
        const releaseUrl = release.url || `https://github.com/${this.orgName}/${encodeURIComponent(repo.name)}/releases/tag/${encodeURIComponent(release.tag)}`;
        const publishedAt = release.publishedAt ? this.formatUpdateTime(release.publishedAt) : null;
        const mirroredCount = assets.filter(asset => asset.directUrl).length;
        const assetCount = this.getReleaseAssetCount(release);
        const assetLabel = assetCount === 1 ? 'asset' : 'assets';
        const assetRows = assets.map(asset => this.renderAssetRow(asset)).join('');

        document.title = `${repo.name} ${release.tag} - ${DEFAULT_PAGE_TITLE}`;

        this.repositoryGrid.innerHTML = `
            <div class="col-12">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
                    <a href="#" class="btn btn-outline-secondary btn-sm">All packages</a>
                    <a href="${escapeAttribute(releaseUrl)}" class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener">
                        GitHub Release
                    </a>
                </div>

                <div class="release-heading mb-4">
                    <h2 class="h3 mb-2">
                        ${escapeHtml(repo.name)} ${escapeHtml(release.tag)}
                        ${repo.archived ? '<span class="badge bg-warning text-dark ms-2 align-middle">Archived</span>' : ''}
                    </h2>
                    <div class="text-muted small">
                        ${assetCount} ${assetLabel}${publishedAt ? ` published ${escapeHtml(publishedAt)}` : ''}
                        ${mirroredCount > 0 ? `, ${mirroredCount} mirrored` : ''}
                    </div>
                </div>

                ${assets.length > 0 ? `
                    <div class="table-responsive">
                        <table class="table table-hover align-middle release-assets-table">
                            <thead>
                                <tr>
                                    <th scope="col">Asset</th>
                                    <th scope="col" class="text-nowrap">Size</th>
                                    <th scope="col" class="text-end">Links</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${assetRows}
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <div class="text-center fst-italic py-5">
                        Asset details are not available in this package index yet.
                    </div>
                `}
            </div>
        `;
    }

    /**
     * Render one release asset table row.
     * @param {Object} asset - Asset data from packages.json.
     * @returns {string} Table row markup.
     */
    renderAssetRow(asset) {
        const githubUrl = asset.githubUrl || asset.browserDownloadUrl;

        return `
            <tr>
                <td class="asset-name">${escapeHtml(asset.name)}</td>
                <td class="text-nowrap">${escapeHtml(this.formatBytes(asset.size))}</td>
                <td>
                    <div class="asset-actions">
                        ${githubUrl ? `
                            <a href="${escapeAttribute(githubUrl)}" class="btn btn-outline-primary btn-sm" target="_blank" rel="noopener">
                                GitHub
                            </a>
                        ` : '<span class="text-muted small">Unavailable</span>'}
                        ${asset.directUrl ? `
                            <a href="${escapeAttribute(asset.directUrl)}" class="btn btn-primary btn-sm" target="_blank" rel="noopener">
                                Direct
                            </a>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    /**
     * Render the not-found state for an invalid release route.
     * @param {{repoName: string, releaseTag: string}} route - Requested route.
     */
    renderReleaseNotFound(route) {
        this.setHomeControlsVisible(false);
        document.title = DEFAULT_PAGE_TITLE;
        this.repositoryGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <p class="fst-italic">Release not found: ${escapeHtml(route.repoName)} ${escapeHtml(route.releaseTag)}</p>
                <a href="#" class="btn btn-outline-secondary btn-sm">All packages</a>
            </div>
        `;
    }

    /**
     * Update statistics display.
     */
    updateStats(repos) {
        const repoCount = repos.length;
        const releaseCount = repos.reduce((sum, repo) => sum + (repo.releases ? repo.releases.length : 0), 0);
        const assetCount = repos.reduce((sum, repo) =>
            sum + (repo.releases ? repo.releases.reduce((releaseSum, release) => releaseSum + this.getReleaseAssetCount(release), 0) : 0), 0);

        this.repoCountElement.textContent = repoCount;
        this.releaseCountElement.textContent = releaseCount;
        this.assetCountElement.textContent = assetCount;

        if (this.lastUpdated) {
            this.updateTimeElement.textContent = this.formatUpdateTime(this.lastUpdated);
        }
    }

    /**
     * Set the last updated time from packages.json.
     */
    setUpdateTime(lastUpdated) {
        this.lastUpdated = lastUpdated;
        this.updateTimeElement.textContent = this.formatUpdateTime(lastUpdated);
    }

    /**
     * Format the update time for display.
     */
    formatUpdateTime(isoString) {
        if (!isoString) return '-';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return isoString;
        return date.toLocaleString();
    }

    /**
     * Format a byte count for display.
     * @param {number} bytes - Size in bytes.
     * @returns {string} Human-readable file size.
     */
    formatBytes(bytes) {
        if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
            return '-';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    /**
     * Show loading state.
     */
    showLoading() {
        this.setHomeControlsVisible(true);
        this.repositoryGrid.innerHTML = '<div class="col-12 text-center fst-italic py-5">Loading repository data...</div>';
        this.repoCountElement.textContent = '-';
        this.releaseCountElement.textContent = '-';
        this.assetCountElement.textContent = '-';
        this.updateTimeElement.textContent = '-';
        this.lastUpdated = null;
    }
}

/**
 * Filter Manager
 * Handles search and archived repository filtering functionality.
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
     * Initialize filter functionality.
     */
    initializeFilters() {
        // Search input handler
        this.searchInput.addEventListener('input', () => {
            this.applyFilters();
        });

        // Archived toggle handler
        this.archivedToggle.addEventListener('change', () => {
            this.applyFilters();
        });
    }

    /**
     * Apply all filters and update UI.
     */
    applyFilters() {
        const searchTerm = this.searchInput.value;
        const showArchived = this.archivedToggle.checked;

        const filteredRepos = this.dataManager.filterRepositories(searchTerm, showArchived);
        this.uiManager.renderRepositories(filteredRepos);
        this.uiManager.updateStats(filteredRepos);
        document.title = DEFAULT_PAGE_TITLE;
    }

    /**
     * Reset all filters.
     */
    resetFilters() {
        this.searchInput.value = '';
        this.archivedToggle.checked = false;
        this.applyFilters();
    }
}

/**
 * Main Application
 * Coordinates all components and manages application state.
 */
class LizardByteAssetsApp {
    constructor() {
        this.dataManager = new RepositoryDataManager();
        this.uiManager = new UIManager();
        this.filterManager = null;
    }

    /**
     * Initialize the application.
     */
    async init() {
        try {
            // Show loading state
            this.uiManager.showLoading();

            // Load repository data from packages.json
            const data = await this.dataManager.loadRepositoryData();
            this.uiManager.setUpdateTime(data.lastUpdated);

            // Initialize filter functionality before rendering the current route
            this.filterManager = new FilterManager(this.dataManager, this.uiManager);
            window.addEventListener('hashchange', () => this.renderRoute());
            this.renderRoute();

            const repositories = this.dataManager.getRepositories();
            console.log(`Loaded ${repositories.length} repositories`);

        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.uiManager.repositoryGrid.innerHTML =
                '<div class="col-12 text-center fst-italic py-5">Failed to load repository data. Please try again later.</div>';
        }
    }

    /**
     * Render the current client-side route.
     */
    renderRoute() {
        const route = parseReleaseHash();

        if (!route) {
            this.filterManager.applyFilters();
            return;
        }

        const match = this.dataManager.findRelease(route.repoName, route.releaseTag);
        if (!match) {
            this.uiManager.renderReleaseNotFound(route);
            return;
        }

        this.uiManager.renderReleaseDetail(match.repo, match.release);
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new LizardByteAssetsApp();
    app.init();
});
