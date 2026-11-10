/**
 * Discover public repositories from the shared LizardByte organization registry.
 * @param {Object} github - GitHub API client.
 * @returns {Promise<Array>} Canonical repository records, deduplicated by GitHub ID.
 */
async function discoverRepositories(github) {
  const { data } = await github.rest.repos.getContent({
    owner: 'LizardByte', repo: '.github', path: 'organizations.json', ref: 'master'
  });
  const organizations = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  if (!Array.isArray(organizations) || organizations.length === 0 ||
      organizations.some(org => typeof org !== 'string' || !org.trim())) {
    throw new Error('Organization registry must contain a non-empty array of organization names');
  }

  const pages = await Promise.all([...new Set(organizations.map(org => org.trim()))].map(org =>
    github.paginate(github.rest.repos.listForOrg, { org, type: 'public', per_page: 100 })
  ));
  const repositories = new Map();
  for (const repo of pages.flat()) {
    if (!repo.private) repositories.set(repo.id, repo);
  }
  return [...repositories.values()];
}

module.exports = { discoverRepositories };
