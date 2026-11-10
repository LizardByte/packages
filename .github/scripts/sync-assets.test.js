const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cleanupNonVPrefixedReleases } = require('./cleanup-releases');
const { syncReleaseAssets } = require('./sync-assets');

const context = { repo: { owner: 'Example' } };

function createFixture(t, config = { defaultInclude: true, repositories: {} }) {
  const originalDir = process.cwd();
  const tempRoot = path.resolve(os.tmpdir());
  const fixturePath = fs.mkdtempSync(path.join(tempRoot, 'packages-sonar-'));
  const distPath = path.join(fixturePath, 'dist');
  fs.mkdirSync(distPath);
  const defaults = { includeAll: config.defaultInclude };
  config.repositories = Object.fromEntries(Object.entries({ Alpha: defaults, Beta: defaults, ...config.repositories })
    .map(([name, entry]) => [name.includes('/') ? name : `Example/${name}`,
      { directory: name.split('/').at(-1), ...entry }]));
  fs.writeFileSync(path.join(fixturePath, 'packages.config.json'), JSON.stringify(config));
  process.chdir(distPath);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  t.after(() => {
    process.chdir(originalDir);
    const resolvedPath = path.resolve(fixturePath);
    assert.equal(path.dirname(resolvedPath), tempRoot);
    assert.ok(path.basename(resolvedPath).startsWith('packages-sonar-'));
    fs.rmSync(resolvedPath, { recursive: true, force: true });
  });

  return function writeFixtureFile(relativePath, content = 'asset') {
    const filePath = path.resolve(distPath, relativePath);
    assert.ok(filePath.startsWith(`${distPath}${path.sep}`));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };
}

function createGithub(releasesByRepo) {
  const listForOrg = () => {};
  const listReleases = () => {};
  return {
    rest: { repos: { listForOrg, listReleases,
      getContent: async () => ({ data: { content: Buffer.from('["Example"]').toString('base64') } }) } },
    async paginate(method, params) {
      if (method === listForOrg) {
        return Object.keys(releasesByRepo).map((name, index) => ({
          id: index + 1, full_name: `Example/${name}`, owner: { login: 'Example' },
          name, archived: false, html_url: `https://example.com/${name}`
        }));
      }
      const releases = releasesByRepo[params.repo];
      if (releases instanceof Error) {
        throw releases;
      }
      return releases;
    }
  };
}

function createRelease(tag, assets = []) {
  return {
    tag_name: tag, draft: false, prerelease: false,
    html_url: `https://example.com/releases/${tag}`,
    published_at: '2026-10-08T00:00:00Z',
    assets: assets.map(asset => ({
      size: 5, browser_download_url: `https://example.com/assets/${asset.name}`, ...asset
    }))
  };
}

function createMultiOrgGithub(organizations, repositories, releases) {
  const calls = [];
  const listForOrg = () => {};
  const listReleases = () => {};
  return {
    calls,
    rest: { repos: { listForOrg, listReleases,
      getContent: async params => {
        calls.push(params);
        return { data: { content: Buffer.from(JSON.stringify(organizations)).toString('base64') } };
      } } },
    async paginate(method, params) {
      calls.push(params);
      if (method === listForOrg) {
        const result = repositories[params.org];
        if (result instanceof Error) throw result;
        return result;
      }
      return releases[`${params.owner}/${params.repo}`] || [];
    }
  };
}

function repository(id, owner, name) {
  return { id, name, full_name: `${owner}/${name}`, owner: { login: owner },
    private: false, archived: false, html_url: `https://github.com/${owner}/${name}` };
}

function mockDownloads(t) {
  const downloads = [];
  t.mock.method(globalThis, 'fetch', async url => {
    downloads.push(url);
    return new Response('asset');
  });
  return downloads;
}

test('cleanup retains v-prefixed releases, hidden roots, and repository files', t => {
  const write = createFixture(t);
  write('Alpha/v1/keep.zip');
  write('Alpha/nightly/remove.zip');
  write('Alpha/README.md');
  write('.git/refs/heads/dist');
  write('.hidden/nightly/keep.zip');
  write('packages.json');

  cleanupNonVPrefixedReleases('.');

  for (const retained of ['Alpha/v1/keep.zip', 'Alpha/README.md', '.git/refs/heads/dist',
    '.hidden/nightly/keep.zip', 'packages.json']) {
    assert.ok(fs.existsSync(retained), retained);
  }
  assert.equal(fs.existsSync('Alpha/nightly'), false);
});

test('cleanup continues after a repository read error and propagates a root read error', t => {
  const write = createFixture(t);
  write('Alpha/nightly/keep.zip');
  write('Beta/nightly/remove.zip');
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (directory, options) => {
    if (directory === 'Alpha' || directory === 'missing') {
      throw new Error('read failed');
    }
    return readDirectory(directory, options);
  });

  cleanupNonVPrefixedReleases('.');
  assert.ok(fs.existsSync('Alpha/nightly/keep.zip'));
  assert.equal(fs.existsSync('Beta/nightly'), false);
  assert.throws(() => cleanupNonVPrefixedReleases('missing'), /read failed/);
});

test('config cleanup preserves retained assets and hashes while removing excluded files and empty directories', async t => {
  const write = createFixture(t, {
    defaultInclude: false, repositories: { Alpha: { includeAssets: ['keep.zip'] } }
  });
  write('Alpha/v1/keep.zip');
  write('Alpha/v1/drop.zip');
  for (const suffix of ['sha256', 'sha512', 'md5']) {
    write(`Alpha/v1/keep.zip.${suffix}`);
    write(`Alpha/v1/drop.zip.${suffix}`);
    write(`Alpha/v1/orphan.zip.${suffix}`);
  }
  write('Alpha/v2/drop.zip');
  write('Beta/v1/drop.zip');
  write('.git/keep');
  write('.hidden/v1/keep');
  write('packages.json');

  await syncReleaseAssets(createGithub({}), context);

  for (const retained of ['Alpha/v1/keep.zip', '.git/keep', '.hidden/v1/keep', 'packages.json']) {
    assert.ok(fs.existsSync(retained), retained);
  }
  for (const suffix of ['sha256', 'sha512', 'md5']) {
    assert.ok(fs.existsSync(`Alpha/v1/keep.zip.${suffix}`));
    assert.equal(fs.existsSync(`Alpha/v1/drop.zip.${suffix}`), false);
    assert.equal(fs.existsSync(`Alpha/v1/orphan.zip.${suffix}`), false);
  }
  for (const removed of ['Alpha/v1/drop.zip', 'Alpha/v2', 'Beta']) {
    assert.equal(fs.existsSync(removed), false, removed);
  }
});

test('the download budget is shared across assets, releases, and repositories while metadata remains complete', async t => {
  createFixture(t);
  const downloads = mockDownloads(t);
  const github = createGithub({
    Alpha: [createRelease('v3', [{ name: 'a.zip' }, { name: 'b.zip' }]),
      createRelease('v2', [{ name: 'c.zip' }])],
    Beta: [createRelease('v1', [{ name: 'd.zip' }])]
  });

  const data = await syncReleaseAssets(github, context, false, 2);

  assert.equal(downloads.length, 2);
  assert.deepEqual(data.map(repo => repo.releases.map(release => release.assetCount)), [[2, 1], [1]]);
  assert.equal(data[0].releases[0].assets[0].directUrl, 'Alpha/v3/a.zip');
  assert.equal(data[0].releases[1].assets[0].directUrl, undefined);
  assert.equal(data[1].releases[0].assets[0].directUrl, undefined);
  for (const name of ['a.zip', 'b.zip']) {
    assert.ok(fs.existsSync(`Alpha/v3/${name}`));
    for (const suffix of ['sha256', 'sha512', 'md5']) {
      assert.ok(fs.existsSync(`Alpha/v3/${name}.${suffix}`));
    }
  }
});

test('PR mode counts only published v-prefixed releases with assets toward the two-release limit', async t => {
  createFixture(t, { defaultInclude: false, repositories: {} });
  const downloads = mockDownloads(t);
  const github = createGithub({ Alpha: [
    { ...createRelease('v6', [{ name: 'draft.zip' }]), draft: true },
    { ...createRelease('v5', [{ name: 'preview.zip' }]), prerelease: true },
    createRelease('nightly', [{ name: 'nightly.zip' }]),
    createRelease('v4'),
    createRelease('v3', [{ name: 'a.zip' }]),
    createRelease('v2', [{ name: 'b.zip' }]),
    createRelease('v1', [{ name: 'c.zip' }])
  ] });

  const data = await syncReleaseAssets(github, context, true);

  assert.deepEqual(data[0].releases.map(release => release.tag), ['v3', 'v2']);
  assert.equal(downloads.length, 0);
});

test('a failed repository does not prevent the next repository from being processed', async t => {
  createFixture(t, { defaultInclude: false, repositories: {} });
  const data = await syncReleaseAssets(createGithub({
    Alpha: new Error('API unavailable'), Beta: [createRelease('v1', [{ name: 'b.zip' }])]
  }), context);
  assert.deepEqual(data.map(repo => repo.name), ['Beta']);
});

test('oversized stored assets and their hashes are removed without consuming the download budget', async t => {
  const write = createFixture(t);
  write('Alpha/v1/huge.zip');
  for (const suffix of ['sha256', 'sha512', 'md5']) {
    write(`Alpha/v1/huge.zip.${suffix}`);
  }
  const downloads = mockDownloads(t);
  const data = await syncReleaseAssets(createGithub({ Alpha: [createRelease('v1', [
    { name: 'huge.zip', size: 51 * 1024 * 1024 }, { name: 'small.zip' }
  ])] }), context, false, 1);

  assert.equal(downloads.length, 1);
  assert.equal(fs.existsSync('Alpha/v1/huge.zip'), false);
  for (const suffix of ['sha256', 'sha512', 'md5']) {
    assert.equal(fs.existsSync(`Alpha/v1/huge.zip.${suffix}`), false);
  }
  assert.equal(data[0].releases[0].assets.find(asset => asset.name === 'huge.zip').directUrl, undefined);
  assert.ok(fs.existsSync('Alpha/v1/small.zip'));
});

test('oversized removal failures are contained and subsequent assets are downloaded', async t => {
  const write = createFixture(t);
  write('Alpha/v1/huge.zip');
  const unlink = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', filePath => {
    if (filePath === path.join('Alpha', 'v1', 'huge.zip')) {
      throw new Error('file locked');
    }
    return unlink(filePath);
  });
  const downloads = mockDownloads(t);

  await syncReleaseAssets(createGithub({ Alpha: [createRelease('v1', [
    { name: 'huge.zip', size: 51 * 1024 * 1024 }, { name: 'small.zip' }
  ])] }), context, false, 1);

  assert.equal(downloads.length, 1);
  assert.ok(fs.existsSync('Alpha/v1/huge.zip'));
  assert.ok(fs.existsSync('Alpha/v1/small.zip'));
});

test('registry discovery uses canonical release owners and isolates same-name repositories by ID', async t => {
  createFixture(t);
  const downloads = mockDownloads(t);
  const alpha = repository(101, 'First', 'Shared');
  const beta = repository(202, 'Second', 'Shared');
  const github = createMultiOrgGithub(['First', 'Second', 'First'], {
    First: [alpha], Second: [alpha, beta, { ...repository(303, 'Second', 'Private'), private: true }]
  }, {
    'First/Shared': [createRelease('v1', [{ name: 'same.zip' }])],
    'Second/Shared': [createRelease('v1', [{ name: 'same.zip' }])]
  });

  const data = await syncReleaseAssets(github, context);

  assert.deepEqual(data.map(repo => repo.fullName), ['First/Shared', 'Second/Shared']);
  assert.deepEqual(data.map(repo => repo.releases[0].assets[0].directUrl),
    ['101/v1/same.zip', '202/v1/same.zip']);
  assert.equal(downloads.length, 2);
  assert.deepEqual(github.calls.filter(call => call.org).map(call => call.org), ['First', 'Second']);
  assert.deepEqual(github.calls.filter(call => call.owner && call.repo === 'Shared').map(call => call.owner),
    ['First', 'Second']);
});

test('a transferred repository retains its policy, stored asset bytes, hashes, and public directory', async t => {
  const write = createFixture(t, { defaultInclude: false, repositories: {
    'OldOrg/Sunshine': { repositoryId: 438803890, directory: 'Sunshine', includeAssets: ['*.exe'] }
  } });
  write('Sunshine/v1/installer.exe', 'existing installer');
  write('Sunshine/v1/installer.exe.sha256', 'existing hash');
  const downloads = mockDownloads(t);
  const github = createMultiOrgGithub(['SunshineStream'], {
    SunshineStream: [repository(438803890, 'SunshineStream', 'Sunshine')]
  }, { 'SunshineStream/Sunshine': [createRelease('v1', [{ name: 'installer.exe' }])] });

  const data = await syncReleaseAssets(github, context);

  assert.equal(downloads.length, 0);
  assert.equal(fs.readFileSync('Sunshine/v1/installer.exe', 'utf8'), 'existing installer');
  assert.equal(fs.readFileSync('Sunshine/v1/installer.exe.sha256', 'utf8'), 'existing hash');
  assert.equal(data[0].releases[0].assets[0].directUrl, 'Sunshine/v1/installer.exe');
  assert.equal(data[0].fullName, 'SunshineStream/Sunshine');
  const { getRepositoryConfig } = require('./package-config');
  assert.equal(getRepositoryConfig({ repositories: {
    'OldOrg/Sunshine': { repositoryId: 438803890, directory: 'Sunshine' }
  } }, repository(999, 'OldOrg', 'Sunshine')), undefined);
});

test('invalid registries and failed organization discovery stop before changing stored assets', async t => {
  const write = createFixture(t);
  write('Alpha/nightly/keep.zip');
  for (const invalid of [[], null, [''], [42], {}]) {
    await assert.rejects(syncReleaseAssets(createMultiOrgGithub(invalid, {}, {}), context), /registry/);
  }
  const github = createMultiOrgGithub(['First', 'Second'], {
    First: [], Second: new Error('discovery unavailable')
  }, {});
  await assert.rejects(syncReleaseAssets(github, context), /discovery unavailable/);
  assert.ok(fs.existsSync('Alpha/nightly/keep.zip'));
});

test('unsafe and colliding storage directories are rejected before cleanup', async t => {
  const write = createFixture(t, { defaultInclude: false, repositories: {
    'First/A': { directory: 'same' }, 'Second/B': { directory: 'SAME' }
  } });
  write('Alpha/nightly/keep.zip');
  const github = createMultiOrgGithub(['First', 'Second'], {
    First: [repository(101, 'First', 'A')], Second: [repository(202, 'Second', 'B')]
  }, {});
  await assert.rejects(syncReleaseAssets(github, context), /Duplicate package directory/);
  const { getRepositoryDirectory } = require('./package-config');
  for (const directory of ['../escape', '.git', 'C:\\escape', '/absolute', '']) {
    assert.throws(() => getRepositoryDirectory({ repositories: { 'First/A': { directory } } },
      repository(101, 'First', 'A')), /Invalid package directory/);
  }
  assert.ok(fs.existsSync('Alpha/nightly/keep.zip'));
});
