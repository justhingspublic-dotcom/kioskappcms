'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');

// Sibling of BOTH site installations. App releases are global, not tenant data.
const DEFAULT_RELEASE_DIR = path.resolve(__dirname, '..', '..', 'app-releases');
const VERSION = /^\d+\.\d+(?:\.\d+)?$/;

function validateRelease(data) {
  if (!data || data.packageName !== 'com.kioskapp' || typeof data.versionName !== 'string' || data.versionName.length > 64 || !VERSION.test(data.versionName) ||
      !Number.isSafeInteger(data.versionCode) || data.versionCode < 1 || data.versionCode > 2147483647 ||
      !Number.isSafeInteger(data.fileSize) || data.fileSize < 1 || data.fileSize > 512 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/i.test(data.sha256) || !Number.isInteger(data.minSdk) || data.minSdk < 24 ||
      !Number.isFinite(Date.parse(data.releasedAt)) ||
      !Array.isArray(data.changelog) || data.changelog.length > 100 || !data.changelog.every(s => typeof s === 'string' && s.length <= 2000)) {
    throw new Error('Invalid App release metadata');
  }
  const fileName = `kiosk-app-${data.versionName}.apk`;
  return {
    packageName: data.packageName, versionCode: data.versionCode, versionName: data.versionName,
    minSdk: data.minSdk, releasedAt: data.releasedAt, fileSize: data.fileSize,
    sha256: data.sha256.toLowerCase(), changelog: data.changelog,
    apkUrl: `/downloads/app/${data.versionName}/${fileName}`,
  };
}

function createReleaseRouter(directory = process.env.APP_RELEASE_DIR || DEFAULT_RELEASE_DIR) {
  const router = express.Router();
  const releaseDir = path.resolve(directory);
  router.get('/api/app/releases/latest', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const release = validateRelease(JSON.parse(await fs.readFile(path.join(releaseDir, 'latest.json'), 'utf8')));
      const apk = path.join(releaseDir, release.versionName, `kiosk-app-${release.versionName}.apk`);
      if ((await fs.stat(apk)).size !== release.fileSize) throw new Error('Incomplete App release');
      res.json(release);
    } catch (error) {
      res.status(error.code === 'ENOENT' ? 404 : 503).json({ error: error.code === 'ENOENT' ? '尚未發布 App 版本。' : '更新版本暫時無法使用，請稍後再試。' });
    }
  });
  router.get('/downloads/app/:version/:file', (req, res) => {
    const { version, file } = req.params;
    if (!VERSION.test(version) || file !== `kiosk-app-${version}.apk`) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff');
    res.type('application/vnd.android.package-archive');
    res.download(path.join(releaseDir, version, file), file, { dotfiles: 'deny', maxAge: '1y', immutable: true }, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: '找不到此版本的安裝檔。' });
    });
  });
  return router;
}

module.exports = { createReleaseRouter, validateRelease, DEFAULT_RELEASE_DIR };
