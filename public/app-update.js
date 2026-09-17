/* Global App releases: intentionally outside the current site's BASE prefix. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const overlay = byId('appDownloadModal');
  const trigger = byId('appDownloadBtn');
  if (!overlay || !trigger) return;
  const status = byId('appDownloadStatus');
  const details = byId('appDownloadDetails');
  const download = byId('appDownloadFile');
  const retry = byId('appDownloadRetry');
  const closeButton = byId('appDownloadClose');
  let request, lastFocus, isolated = [], closeTimer;

  async function load() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    status.hidden = false;
    status.classList.remove('is-error');
    status.textContent = '正在取得最新版本…';
    details.hidden = download.hidden = retry.hidden = true;
    download.removeAttribute('href');
    try {
      const response = await fetch('/api/app/releases/latest', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? '尚未發布 App 版本。' : '暫時無法取得版本資訊，請稍後重試。');
      const release = await response.json();
      if (request !== controller || !overlay.classList.contains('is-visible')) return;
      const version = release.versionName;
      const expectedPath = `/downloads/app/${version}/kiosk-app-${version}.apk`;
      if (!/^\d+\.\d+(?:\.\d+)?$/.test(version) || release.packageName !== 'com.kioskapp' ||
          release.apkUrl !== expectedPath || !Number.isSafeInteger(release.fileSize) || release.fileSize <= 0 ||
          !Number.isFinite(Date.parse(release.releasedAt)) || !Array.isArray(release.changelog) ||
          !release.changelog.every(item => typeof item === 'string')) throw new Error('版本資訊格式不正確，請稍後重試。');
      byId('appReleaseVersion').textContent = `版本 ${version}`;
      const date = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeZone: 'Asia/Taipei' }).format(new Date(release.releasedAt));
      byId('appReleaseMeta').textContent = `${date} · ${(release.fileSize / 1024 / 1024).toFixed(1)} MB · Android APK`;
      byId('appReleaseNotes').replaceChildren(...release.changelog.map(note => {
        const li = document.createElement('li'); li.textContent = note; return li;
      }));
      download.href = expectedPath;
      download.download = `kiosk-app-${version}.apk`;
      download.textContent = '下載 APK';
      details.hidden = download.hidden = false;
      status.textContent = `最新版本 ${version} 已載入。`;
      status.hidden = true;
    } catch (error) {
      if (request !== controller || !overlay.classList.contains('is-visible')) return;
      status.textContent = error.name === 'AbortError' ? '連線逾時，請檢查網路後重新載入。' : error.message;
      status.classList.add('is-error');
      retry.hidden = false;
    } finally { clearTimeout(timeout); }
  }

  function finishClose() {
    clearTimeout(closeTimer);
    if (!overlay.classList.contains('is-closing')) return;
    overlay.removeEventListener('animationend', onCloseAnimationEnd);
    overlay.classList.remove('is-visible', 'is-open', 'is-closing');
    isolated.forEach(([element, previous]) => { element.inert = previous; });
    isolated = [];
    lastFocus?.focus();
    overlay.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.b-modal-overlay.is-visible')) document.body.classList.remove('b-modal-lock');
  }

  function onCloseAnimationEnd(event) {
    if (event.target === overlay && event.animationName === 'ws-overlay-out') finishClose();
  }

  function close() {
    if (!overlay.classList.contains('is-visible') || overlay.classList.contains('is-closing')) return;
    request?.abort(); request = null;
    overlay.addEventListener('animationend', onCloseAnimationEnd);
    overlay.classList.add('is-closing');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishClose();
    else closeTimer = setTimeout(finishClose, 200); // Fallback if an animation is interrupted.
  }

  trigger.addEventListener('click', () => {
    if (overlay.classList.contains('is-closing')) finishClose();
    if (overlay.classList.contains('is-visible')) return;
    lastFocus = document.activeElement;
    isolated = [...overlay.parentElement.children].filter(el => el !== overlay).map(el => [el, el.inert]);
    isolated.forEach(([element]) => { element.inert = true; });
    overlay.classList.remove('is-closing');
    overlay.classList.add('is-visible', 'is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('b-modal-lock');
    closeButton.focus();
    load();
  });
  closeButton.addEventListener('click', close);
  retry.addEventListener('click', load);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const targets = [...overlay.querySelectorAll('button:not(:disabled), a[href]')].filter(el => el.getClientRects().length);
    const first = targets[0], last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
