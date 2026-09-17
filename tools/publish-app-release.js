'use strict';

// node tools/publish-app-release.js <signed.apk> <release-notes.json> <app-releases-directory>
// Copy + verify APK first, then atomically switch latest.json. Never overwrite a published APK.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateRelease } = require('../src/app-releases');
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function publish(apk, notesFile, output) {
  if (!apk || !notesFile || !output) throw new Error('Usage: node tools/publish-app-release.js <signed.apk> <release-notes.json> <output-dir>');
  const releaseDir = path.resolve(output);
  const notes = JSON.parse(await fs.readFile(notesFile, 'utf8'));
  const release = validateRelease({ ...notes, fileSize: (await fs.stat(apk)).size, sha256: await sha256(apk), releasedAt: notes.releasedAt || new Date().toISOString() });
  const latestPath = path.join(releaseDir, 'latest.json');
  let previous;
  try { previous = JSON.parse(await fs.readFile(latestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (previous && previous.versionCode >= release.versionCode) throw new Error('Release versionCode must increase; current latest was left unchanged.');
  const dir = path.join(releaseDir, release.versionName);
  await fs.mkdir(releaseDir, { recursive: true });
  await fs.mkdir(dir); // EEXIST intentionally fails: published versions are immutable.
  const target = path.join(dir, `kiosk-app-${release.versionName}.apk`);
  await fs.copyFile(apk, target);
  if (await sha256(target) !== release.sha256) throw new Error('APK copy verification failed; latest was left unchanged.');
  const json = JSON.stringify(release, null, 2) + '\n';
  await fs.writeFile(path.join(dir, 'release.json'), json, { flag: 'wx' });
  const temporary = latestPath + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporary, json, { flag: 'wx' });
  await fs.rename(temporary, latestPath);
  console.log(JSON.stringify({ version: release.versionName, versionCode: release.versionCode, directory: dir, sha256: release.sha256 }, null, 2));
}
if (require.main === module) publish(...process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { publish };
