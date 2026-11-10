const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('application startup handles an unexpected initialization rejection', async () => {
  let onReady;
  const errors = [];
  const sandbox = vm.createContext({
    document: {
      title: 'Packages',
      addEventListener(event, handler) {
        assert.equal(event, 'DOMContentLoaded');
        onReady = handler;
      }
    },
    console: { error: (...args) => errors.push(args) }
  });
  const appPath = path.resolve(__dirname, '../../gh-pages-template/assets/js/app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), sandbox);
  vm.runInContext(`
    UIManager = class {};
    LizardByteAssetsApp.prototype.init = () => Promise.reject(new Error('startup failed'));
  `, sandbox);

  onReady();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'Failed to start application:');
  assert.equal(errors[0][1].message, 'startup failed');
});

test('release routes distinguish duplicate names, survive owner changes, and retain unambiguous legacy links', () => {
  const sandbox = vm.createContext({
    document: { title: 'Packages', addEventListener() {} }, console
  });
  const appPath = path.resolve(__dirname, '../../gh-pages-template/assets/js/app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), sandbox);
  const manager = vm.runInContext('new RepositoryDataManager()', sandbox);
  manager.repositoryData = [
    { id: 101, fullName: 'First/Shared', name: 'Shared', releases: [{ tag: 'v1' }] },
    { id: 202, fullName: 'Second/Shared', name: 'Shared', releases: [{ tag: 'v1' }] },
    { id: 303, fullName: 'SunshineStream/Sunshine', name: 'Sunshine', releases: [{ tag: 'v1' }] }
  ];
  assert.equal(manager.findRelease('101', 'v1').repo.fullName, 'First/Shared');
  assert.equal(manager.findRelease('202', 'v1').repo.fullName, 'Second/Shared');
  assert.equal(manager.findRelease('Shared', 'v1'), null);
  assert.equal(manager.findRelease('Sunshine', 'v1').repo.id, 303);
  manager.repositoryData[0].fullName = 'NewOwner/Shared';
  assert.equal(manager.findRelease('101', 'v1').repo.fullName, 'NewOwner/Shared');
  assert.equal(manager.filterRepositories('newowner').length, 1);
});
