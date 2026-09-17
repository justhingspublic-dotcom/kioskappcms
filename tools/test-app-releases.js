'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const { createReleaseRouter, validateRelease } = require('../src/app-releases');
const { publish } = require('./publish-app-release');
const bytes = Buffer.from('TEST ONLY: not a real APK');
const notes = { packageName: 'com.kioskapp', versionName: '1.49', versionCode: 50, minSdk: 24,
  releasedAt: '2026-09-17T09:00:00.000Z', changelog: ['新增 App 內更新'] };
const metadata = { ...notes, fileSize: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };

test('release metadata is allowlisted and bounded', () => {
  assert.equal(validateRelease({ ...metadata, apkUrl: 'https://evil.invalid/app.apk', secret: 'no' }).apkUrl,
    '/downloads/app/1.49/kiosk-app-1.49.apk');
  assert.equal(validateRelease({ ...metadata, secret: 'no' }).secret, undefined);
  for (const invalid of [{ versionName: '../escape' }, { versionCode: 0 }, { versionCode: 50.5 },
    { packageName: 'other.app' }, { sha256: 'bad' }, { fileSize: 0 }, { fileSize: 513 * 1024 * 1024 },
    { minSdk: 23 }, { releasedAt: 'not-a-date' }, { changelog: [null] }, { changelog: Array(101).fill('a') }]) {
    assert.throws(() => validateRelease({ ...metadata, ...invalid }));
  }
});

test('publish + public API + attachment/range downloads + error handling', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'kiosk-release-test-'));
  t.after(async () => {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('kiosk-release-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const releases = path.join(temporary, 'app-releases');
  const app = express().use(createReleaseRouter(releases));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/app/releases/latest')).status, 404);
  const apk = path.join(temporary, 'source.apk'), spec = path.join(temporary, 'notes.json');
  await fs.writeFile(apk, bytes);
  await fs.writeFile(spec, JSON.stringify(notes));
  await publish(apk, spec, releases);
  const response = await fetch(base + '/api/app/releases/latest');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const release = await response.json();
  assert.deepEqual(release, validateRelease(metadata));
  const download = await fetch(base + release.apkUrl);
  assert.match(download.headers.get('content-type'), /^application\/vnd.android.package-archive/);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="kiosk-app-1.49.apk"/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const range = await fetch(base + release.apkUrl, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 4));
  for (const invalid of ['/downloads/app/1.49/latest.json', '/downloads/app/1.48/kiosk-app-1.48.apk',
    '/downloads/app/..%2F/kiosk-app-1.49.apk', '/downloads/app/1.49/%2e%2e%2fnotes.json']) {
    assert.equal((await fetch(base + invalid)).status, 404);
  }
  await assert.rejects(publish(apk, spec, releases), /must increase/);
  assert.equal(JSON.parse(await fs.readFile(path.join(releases, 'latest.json'), 'utf8')).versionCode, 50);
  await fs.appendFile(path.join(releases, '1.49', 'kiosk-app-1.49.apk'), 'bad size');
  assert.equal((await fetch(base + '/api/app/releases/latest')).status, 503);
  await fs.writeFile(path.join(releases, 'latest.json'), '{invalid json');
  assert.equal((await fetch(base + '/api/app/releases/latest')).status, 503);
});
