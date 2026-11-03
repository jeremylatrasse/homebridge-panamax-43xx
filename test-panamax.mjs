import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { PanamaxClient, validatePanamaxHost } from './dist/panamaxClient.js';

const schema = JSON.parse(readFileSync('./config.schema.json', 'utf8'));

console.log('Running Panamax unit tests...');

// Test 1: IPv4 4-octet validation
assert.strictEqual(validatePanamaxHost('192.168.1.50').valid, true);
assert.strictEqual(validatePanamaxHost('panamax.local').valid, true);
assert.strictEqual(validatePanamaxHost('192.168.50').valid, false);
assert.strictEqual(validatePanamaxHost('10.0.0').valid, false);
assert.strictEqual(validatePanamaxHost('256.1.1.1').valid, false);

// Test 2: Schema pattern
const hostPattern = new RegExp(schema.schema.properties.devices.items.properties.host.pattern);
assert.strictEqual(hostPattern.test('192.168.1.50'), true);
assert.strictEqual(hostPattern.test('panamax.local'), true);
assert.strictEqual(hostPattern.test('192.168.50'), false);
assert.strictEqual(hostPattern.test('10.0.0'), false);
assert.deepStrictEqual(schema.schema.properties.devices.items.required, ['host']);

// Test 3: Constructor rejection
assert.throws(
  () => new PanamaxClient({ host: '192.168.50', port: 23 }, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  /Invalid IPv4 address/,
);

console.log('✅ All Panamax unit tests passed successfully!');
