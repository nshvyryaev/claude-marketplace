import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryString, clockMs, networkParams, networkAt, viewportParams, validateEnv, pickEnv } from '../scripts/lib/env.mjs';

const fault = (e) => e.adapterFault === true;

test('query: строка и объект', () => {
  assert.equal(queryString(undefined), '');
  assert.equal(queryString('prod&pf=vk'), '?prod&pf=vk');
  assert.equal(queryString('?prod'), '?prod');
  assert.equal(queryString({ prod: true, api: 'http://h:1/x', pf: 'vk', off: false, none: null }), '?prod&api=http%3A%2F%2Fh%3A1%2Fx&pf=vk');
  assert.equal(queryString({}), '');
  assert.throws(() => queryString(['prod']), fault);
});

test('clock: ISO или мс', () => {
  assert.equal(clockMs('2026-03-01T00:00:00Z'), Date.UTC(2026, 2, 1));
  assert.equal(clockMs(1800000000000.7), 1800000000000);
  assert.throws(() => clockMs('вчера'), fault);
  assert.throws(() => clockMs(null), fault);
});

test('network: offline, online, троттлинг, когда включать', () => {
  assert.deepEqual(networkParams('offline'), { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  assert.deepEqual(networkParams('online'), { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  assert.deepEqual(networkParams({ latency: 300, download: 50000 }), { offline: false, latency: 300, downloadThroughput: 50000, uploadThroughput: -1 });
  assert.throws(() => networkParams({ offline: 1 }), fault);
  assert.throws(() => networkParams({ latency: -1 }), fault);
  assert.throws(() => networkParams('slow'), fault);
  assert.equal(networkAt('offline'), 'boot');
  assert.equal(networkAt({ offline: true, at: 'ready' }), 'ready');
  assert.throws(() => networkAt({ at: 'later' }), fault);
});

test('viewport: ориентация телефона по сторонам', () => {
  assert.deepEqual(viewportParams({ width: 390, height: 844, mobile: true }), {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 },
  });
  assert.equal(viewportParams({ width: 844, height: 390, mobile: true }).screenOrientation.type, 'landscapePrimary');
  assert.equal(viewportParams({ width: 800, height: 600 }).screenOrientation, undefined);
  assert.throws(() => viewportParams({ width: 10.5, height: 10 }), fault);
});

test('validateEnv и pickEnv: только заданные поля', () => {
  validateEnv({});
  validateEnv({ query: 'prod', clock: 0, timezone: 'UTC', network: 'offline', viewport: { width: 1, height: 1 } });
  assert.throws(() => validateEnv({ timezone: '' }), fault);
  assert.deepEqual(pickEnv({ query: 'prod', clock: null, theme: 'x', network: 'offline' }), { query: 'prod', network: 'offline' });
});
