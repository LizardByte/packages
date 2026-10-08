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
