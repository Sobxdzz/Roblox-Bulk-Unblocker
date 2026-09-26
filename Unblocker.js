// ==UserScript==
// @name         Roblox Mass Unblock
// @namespace    personal-use
// @version      2.0
// @description  Browse, search, select, and mass-unblock users from your Roblox blocked list, with backups and live progress.
// @match        https://www.roblox.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  // Guard against double-injection (e.g. Tampermonkey re-running on SPA navigation).
  if (window.__rbxMassUnblockLoaded) return;
  window.__rbxMassUnblockLoaded = true;

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  const PAGE_SIZE = 49;          // page size for get-blocked-users
  const NAME_BATCH_SIZE = 100;   // users.roblox.com/v1/users accepts a batch of IDs
  const DEFAULT_DELAY_MS = 300;  // pause between unblock calls
  const MAX_RETRIES = 5;         // per-user retry ceiling (429 / 403 / network)
  const MAX_LOG_LINES = 300;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let allUsers = [];          // [{ id, name, __unblocked }]
  let selected = new Set();   // ids currently checked
  let failedIds = new Set();  // ids that failed on the last run
  let csrfToken = null;
  let running = false;
  let cancelRequested = false;
  let panelOpen = false;
  let loadedOnce = false;

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function backoffDelay(attempt) {
    const base = 1000 * Math.pow(1.6, attempt);
    const jitter = Math.random() * 400;
    return Math.min(base + jitter, 15000);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // ---------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #rbxmu-toggle{position:fixed;bottom:20px;right:20px;z-index:999999;padding:10px 16px;background:#e2242a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:Arial,Helvetica,sans-serif;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.35);}
      #rbxmu-toggle:hover{background:#c91f25;}
      #rbxmu-panel{position:fixed;top:80px;right:20px;width:380px;max-height:75vh;background:#1a1a1d;color:#eee;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:999999;display:flex;flex-direction:column;font-family:Arial,Helvetica,sans-serif;font-size:13px;overflow:hidden;border:1px solid #333;}
      #rbxmu-panel.hidden{display:none;}
      #rbxmu-header{background:#e2242a;color:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none;flex-shrink:0;}
      #rbxmu-header b{font-size:14px;}
      #rbxmu-header button{background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;}
      #rbxmu-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px;overflow:hidden;flex:1;min-height:0;}
      .rbxmu-toolbar{display:flex;flex-wrap:wrap;gap:6px;flex-shrink:0;}
      .rbxmu-toolbar button,#rbxmu-footer button{background:#2c2c31;color:#eee;border:1px solid #444;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:12px;}
      .rbxmu-toolbar button:hover,#rbxmu-footer button:hover{background:#3a3a40;}
      .rbxmu-toolbar button:disabled,#rbxmu-footer button:disabled{opacity:.45;cursor:default;}
      #rbxmu-search{flex:1;min-width:120px;background:#2c2c31;border:1px solid #444;border-radius:6px;color:#eee;padding:5px 8px;font-size:12px;}
      #rbxmu-counts{color:#999;font-size:11px;flex-shrink:0;}
      #rbxmu-list{flex:1;overflow-y:auto;border:1px solid #333;border-radius:6px;background:#111113;min-height:120px;max-height:260px;}
      .rbxmu-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #232326;}
      .rbxmu-row:last-child{border-bottom:none;}
      .rbxmu-row:hover{background:#18181b;}
      .rbxmu-row.unblocked{opacity:.4;}
      .rbxmu-row.unblocked .rbxmu-name{text-decoration:line-through;}
      .rbxmu-row.failed{box-shadow:inset 0 0 0 1px #e2242a;}
      .rbxmu-row input[type=checkbox]{flex-shrink:0;cursor:pointer;}
      .rbxmu-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .rbxmu-id{color:#888;font-size:11px;flex-shrink:0;}
      #rbxmu-empty{padding:24px 10px;text-align:center;color:#888;}
      #rbxmu-footer{display:flex;flex-direction:column;gap:6px;border-top:1px solid #333;padding-top:8px;flex-shrink:0;}
      .rbxmu-delay-row{display:flex;align-items:center;gap:6px;color:#aaa;}
      #rbxmu-delay{width:64px;background:#2c2c31;border:1px solid #444;border-radius:6px;color:#eee;padding:4px 6px;font-size:12px;}
      #rbxmu-run{background:#e2242a;color:#fff;border:none;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;flex:1;}
      #rbxmu-run:hover{background:#c91f25;}
      #rbxmu-run:disabled{opacity:.5;cursor:default;}
      #rbxmu-cancel{background:#444;color:#fff;border:none;border-radius:6px;padding:8px 10px;cursor:pointer;display:none;}
      #rbxmu-progress-wrap{height:6px;background:#2c2c31;border-radius:3px;overflow:hidden;display:none;flex-shrink:0;}
      #rbxmu-progress-bar{height:100%;width:0%;background:#e2242a;transition:width .15s;}
      #rbxmu-status{color:#ccc;font-size:11px;min-height:14px;}
      #rbxmu-logwrap summary{cursor:pointer;color:#999;font-size:11px;}
      #rbxmu-log{max-height:100px;overflow-y:auto;background:#0d0d0f;border:1px solid #262626;border-radius:6px;padding:6px;margin-top:4px;font-family:Consolas,Menlo,monospace;font-size:11px;color:#9ad1ff;}
      #rbxmu-log div{white-space:pre-wrap;margin-bottom:2px;}
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // UI construction
  // ---------------------------------------------------------------------
  let els = {}; // cached element references

  function buildUI() {
    const toggle = document.createElement('button');
    toggle.id = 'rbxmu-toggle';
    toggle.textContent = 'Mass Unblock';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'rbxmu-panel';
    panel.className = 'hidden';
    panel.innerHTML = `
      <div id="rbxmu-header">
        <b>Roblox Mass Unblock</b>
        <button id="rbxmu-close" title="Close">&#10005;</button>
      </div>
      <div id="rbxmu-body">
        <div class="rbxmu-toolbar">
          <button id="rbxmu-load">&#8635; Load / Refresh</button>
          <input id="rbxmu-search" type="text" placeholder="Search name or ID..." />
        </div>
        <div class="rbxmu-toolbar">
          <button id="rbxmu-sel-all">Select all</button>
          <button id="rbxmu-sel-none">Select none</button>
          <button id="rbxmu-sel-invert">Invert</button>
          <button id="rbxmu-export">&#8681; Export backup</button>
        </div>
        <div id="rbxmu-counts">Click "Load / Refresh" to begin.</div>
        <div id="rbxmu-list"></div>
        <div id="rbxmu-footer">
          <div class="rbxmu-delay-row">
            <label for="rbxmu-delay">Delay (ms)</label>
            <input id="rbxmu-delay" type="number" min="50" max="5000" step="50" value="${DEFAULT_DELAY_MS}" />
            <button id="rbxmu-retry-failed" style="display:none;margin-left:auto;">Retry failed</button>
          </div>
          <div id="rbxmu-progress-wrap"><div id="rbxmu-progress-bar"></div></div>
          <div id="rbxmu-status"></div>
          <div style="display:flex;gap:6px;">
            <button id="rbxmu-run">Unblock selected</button>
            <button id="rbxmu-cancel">Stop</button>
          </div>
          <details id="rbxmu-logwrap">
            <summary>Activity log</summary>
            <div id="rbxmu-log"></div>
          </details>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    els = {
      toggle, panel,
      close: panel.querySelector('#rbxmu-close'),
      load: panel.querySelector('#rbxmu-load'),
      search: panel.querySelector('#rbxmu-search'),
      selAll: panel.querySelector('#rbxmu-sel-all'),
      selNone: panel.querySelector('#rbxmu-sel-none'),
      selInvert: panel.querySelector('#rbxmu-sel-invert'),
      exportBtn: panel.querySelector('#rbxmu-export'),
      counts: panel.querySelector('#rbxmu-counts'),
      list: panel.querySelector('#rbxmu-list'),
      delay: panel.querySelector('#rbxmu-delay'),
      retryFailed: panel.querySelector('#rbxmu-retry-failed'),
      progressWrap: panel.querySelector('#rbxmu-progress-wrap'),
      progressBar: panel.querySelector('#rbxmu-progress-bar'),
      status: panel.querySelector('#rbxmu-status'),
      run: panel.querySelector('#rbxmu-run'),
      cancel: panel.querySelector('#rbxmu-cancel'),
      log: panel.querySelector('#rbxmu-log'),
      header: panel.querySelector('#rbxmu-header'),
    };
  }

  // ---------------------------------------------------------------------
  // Logging / status
  // ---------------------------------------------------------------------
  function log(msg) {
    const line = document.createElement('div');
    const t = new Date().toLocaleTimeString();
    line.textContent = `[${t}] ${msg}`;
    els.log.appendChild(line);
    while (els.log.children.length > MAX_LOG_LINES) els.log.removeChild(els.log.firstChild);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus(msg) {
    els.status.textContent = msg;
  }

  // ---------------------------------------------------------------------
  // Roblox API calls
  // ---------------------------------------------------------------------
  async function getCsrfToken(force) {
    if (csrfToken && !force) return csrfToken;
    const r = await fetch('https://apis.roblox.com/user-blocking-api/v1/users/dummy/unblock-user', {
      method: 'POST',
      credentials: 'include',
    });
    csrfToken = r.headers.get('x-csrf-token');
    return csrfToken;
  }

  async function fetchBlockedPage(cursor) {
    const u = new URL('https://apis.roblox.com/user-blocking-api/v1/users/get-blocked-users');
    u.searchParams.set('count', String(PAGE_SIZE));
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { credentials: 'include' });
    if (!r.ok) throw new Error('get-blocked-users failed: ' + r.status);
    const j = await r.json();
    return j.data || j;
  }

  async function fetchAllBlocked(onProgress) {
    let raw = [];
    let cursor = '';
    do {
      const p = await fetchBlockedPage(cursor);
      const list = p.blockedUsers || [];
      if (!list.length) break;
      raw = raw.concat(list);
      if (onProgress) onProgress(raw.length);
      cursor = p.cursor || '';
    } while (cursor);
    return raw;
  }

  async function resolveNames(ids) {
    const map = {};
    for (let i = 0; i < ids.length; i += NAME_BATCH_SIZE) {
      const chunk = ids.slice(i, i + NAME_BATCH_SIZE);
      try {
        const r = await fetch('https://users.roblox.com/v1/users', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userIds: chunk, excludeBannedUsers: false }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        (j.data || []).forEach((u) => {
          const id = u.id ?? u.requestedUserId;
          const name = u.name || u.displayName;
          if (id != null && name) map[id] = name;
        });
      } catch (e) {
        // Name resolution is a nice-to-have; fall back to showing raw IDs.
      }
    }
    return map;
  }

  async function unblockOne(id) {
    let token = await getCsrfToken(false);
    if (!token) return { ok: false, reason: 'no CSRF token' };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let r;
      try {
        r = await fetch(`https://apis.roblox.com/user-blocking-api/v1/users/${id}/unblock-user`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'x-csrf-token': token, 'content-type': 'application/json' },
        });
      } catch (networkErr) {
        if (attempt === MAX_RETRIES) return { ok: false, reason: 'network error' };
        await sleep(backoffDelay(attempt));
        continue;
      }

      if (r.ok) return { ok: true };

      if (r.status === 403) {
        token = await getCsrfToken(true); // token likely stale — refresh and retry
        if (attempt === MAX_RETRIES) return { ok: false, reason: '403 forbidden' };
        continue;
      }
      if (r.status === 429) {
        if (attempt === MAX_RETRIES) return { ok: false, reason: 'rate limited' };
        await sleep(backoffDelay(attempt));
        continue;
      }
      return { ok: false, reason: 'HTTP ' + r.status };
    }
    return { ok: false, reason: 'max retries exceeded' };
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  async function loadBlockedList() {
    setStatus('Loading blocked list...');
    log('Fetching blocked users...');

    const raw = await fetchAllBlocked((count) => setStatus(`Loading... ${count} found so far`));
    const ids = raw.map((u) => u.blockedUserId).filter((v) => v != null);

    const nameMap = {};
    raw.forEach((u) => {
      const inline = u.name || u.username || u.blockedUserName || u.displayName;
      if (inline) nameMap[u.blockedUserId] = inline;
    });

    const unresolved = ids.filter((id) => !nameMap[id]);
    if (unresolved.length) {
      log(`Resolving ${unresolved.length} display name(s)...`);
      Object.assign(nameMap, await resolveNames(unresolved));
    }

    allUsers = ids.map((id) => ({ id, name: nameMap[id] || null, __unblocked: false }));
    selected = new Set(ids); // default: everything selected
    failedIds = new Set();
    loadedOnce = true;

    log(`Loaded ${allUsers.length} blocked user(s).`);
    setStatus(`${allUsers.length} blocked user(s) loaded.`);
    renderList();
    updateRetryButton();
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function matchesFilter(u, q) {
    if (!q) return true;
    const label = (u.name || String(u.id)).toLowerCase();
    return label.includes(q) || String(u.id).includes(q);
  }

  function forEachVisible(fn) {
    const q = els.search.value.trim().toLowerCase();
    allUsers.forEach((u) => {
      if (u.__unblocked) return;
      if (matchesFilter(u, q)) fn(u);
    });
  }

  function buildRow(u) {
    const row = document.createElement('div');
    row.className = 'rbxmu-row';
    if (u.__unblocked) row.classList.add('unblocked');
    if (failedIds.has(u.id)) row.classList.add('failed');
    row.dataset.id = String(u.id);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(u.id);
    cb.disabled = u.__unblocked;
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(u.id);
      else selected.delete(u.id);
      updateCounts();
    });

    const nameEl = document.createElement('span');
    nameEl.className = 'rbxmu-name';
    nameEl.textContent = u.name || `User ${u.id}`;
    nameEl.title = nameEl.textContent;

    const idEl = document.createElement('span');
    idEl.className = 'rbxmu-id';
    idEl.textContent = u.id;

    row.append(cb, nameEl, idEl);
    return row;
  }

  function renderList() {
    const q = els.search.value.trim().toLowerCase();
    els.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    let shown = 0;

    allUsers.forEach((u) => {
      if (!matchesFilter(u, q)) return;
      shown++;
      frag.appendChild(buildRow(u));
    });

    if (!shown) {
      const empty = document.createElement('div');
      empty.id = 'rbxmu-empty';
      empty.textContent = !loadedOnce
        ? 'Click "Load / Refresh" to begin.'
        : allUsers.length
        ? 'No matches.'
        : 'No blocked users found.';
      els.list.appendChild(empty);
    } else {
      els.list.appendChild(frag);
    }
    updateCounts(shown);
  }

  function updateCounts(shownOverride) {
    const shown = shownOverride !== undefined ? shownOverride : els.list.querySelectorAll('.rbxmu-row').length;
    const remaining = allUsers.filter((u) => !u.__unblocked).length;
    els.counts.textContent = `${shown} shown / ${remaining} remaining (of ${allUsers.length} loaded) - ${selected.size} selected`;
  }

  function markRowUnblocked(id) {
    const u = allUsers.find((x) => x.id === id);
    if (u) u.__unblocked = true;
    selected.delete(id);
    failedIds.delete(id);
    const row = els.list.querySelector(`.rbxmu-row[data-id="${id}"]`);
    if (row) {
      row.classList.add('unblocked');
      row.classList.remove('failed');
      const cb = row.querySelector('input[type=checkbox]');
      if (cb) cb.disabled = true;
    }
    updateCounts();
  }

  function markRowFailed(id) {
    failedIds.add(id);
    const row = els.list.querySelector(`.rbxmu-row[data-id="${id}"]`);
    if (row) row.classList.add('failed');
  }

  function updateRetryButton() {
    els.retryFailed.style.display = failedIds.size ? '' : 'none';
    els.retryFailed.textContent = `Retry failed (${failedIds.size})`;
  }

  function displayNameFor(id) {
    const u = allUsers.find((x) => x.id === id);
    return u && u.name ? u.name : `User ${id}`;
  }

  // ---------------------------------------------------------------------
  // Run loop
  // ---------------------------------------------------------------------
  function getDelayMs() {
    const v = parseInt(els.delay.value, 10);
    if (Number.isNaN(v)) return DEFAULT_DELAY_MS;
    return clamp(v, 50, 5000);
  }

  function toggleRunUI(isRunning) {
    running = isRunning;
    els.run.disabled = isRunning;
    els.run.textContent = isRunning ? 'Working...' : 'Unblock selected';
    els.cancel.style.display = isRunning ? '' : 'none';
    els.load.disabled = isRunning;
    els.selAll.disabled = isRunning;
    els.selNone.disabled = isRunning;
    els.selInvert.disabled = isRunning;
    els.exportBtn.disabled = isRunning;
    els.retryFailed.disabled = isRunning;
    els.progressWrap.style.display = isRunning ? '' : 'none';
    if (!isRunning) els.progressBar.style.width = '0%';
  }

  function updateProgress(done, total, ok, fail) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    els.progressBar.style.width = pct + '%';
    setStatus(`Unblocking ${done}/${total} (ok: ${ok}, fail: ${fail})`);
  }

  async function runUnblock(ids) {
    cancelRequested = false;
    toggleRunUI(true);
    let ok = 0;
    let fail = 0;
    const total = ids.length;

    for (let i = 0; i < total; i++) {
      if (cancelRequested) {
        log('Cancelled by user.');
        break;
      }
      const id = ids[i];
      const res = await unblockOne(id);
      if (res.ok) {
        ok++;
        markRowUnblocked(id);
        log(`Unblocked ${displayNameFor(id)} (${id})`);
      } else {
        fail++;
        markRowFailed(id);
        log(`Failed ${displayNameFor(id)} (${id}) - ${res.reason}`);
      }
      updateProgress(i + 1, total, ok, fail);

      const delay = getDelayMs();
      if (delay > 0 && i < total - 1) await sleep(delay);
    }

    toggleRunUI(false);
    updateRetryButton();
    const cancelNote = cancelRequested ? ' (cancelled early)' : '';
    setStatus(`Done. Unblocked ${ok}, failed ${fail}${cancelNote}.`);
    log(`Run complete - ok: ${ok}, fail: ${fail}${cancelNote}.`);
  }

  // ---------------------------------------------------------------------
  // Export backup
  // ---------------------------------------------------------------------
  function exportBackup() {
    if (!allUsers.length) {
      setStatus('Nothing to export yet - load the list first.');
      return;
    }
    const payload = allUsers.map((u) => ({ id: u.id, name: u.name || null }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `roblox-blocked-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    log(`Exported backup of ${payload.length} user(s).`);
  }

  // ---------------------------------------------------------------------
  // Drag support for the panel header
  // ---------------------------------------------------------------------
  function enableDrag() {
    let dragging = false;
    let offX = 0;
    let offY = 0;

    els.header.addEventListener('mousedown', (e) => {
      if (e.target === els.close) return;
      dragging = true;
      const rect = els.panel.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      els.panel.style.right = 'auto';
      els.panel.style.top = rect.top + 'px';
      els.panel.style.left = rect.left + 'px';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      els.panel.style.left = e.clientX - offX + 'px';
      els.panel.style.top = e.clientY - offY + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------
  function wireEvents() {
    els.toggle.addEventListener('click', () => {
      panelOpen = !panelOpen;
      els.panel.classList.toggle('hidden', !panelOpen);
      if (panelOpen && !loadedOnce) triggerLoad();
    });
    els.close.addEventListener('click', () => {
      panelOpen = false;
      els.panel.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) {
        panelOpen = false;
        els.panel.classList.add('hidden');
      }
    });

    els.load.addEventListener('click', triggerLoad);
    els.search.addEventListener('input', () => renderList());

    els.selAll.addEventListener('click', () => {
      forEachVisible((u) => selected.add(u.id));
      renderList();
    });
    els.selNone.addEventListener('click', () => {
      forEachVisible((u) => selected.delete(u.id));
      renderList();
    });
    els.selInvert.addEventListener('click', () => {
      forEachVisible((u) => (selected.has(u.id) ? selected.delete(u.id) : selected.add(u.id)));
      renderList();
    });

    els.exportBtn.addEventListener('click', exportBackup);

    els.run.addEventListener('click', async () => {
      if (running) return;
      const ids = Array.from(selected).filter((id) => {
        const u = allUsers.find((x) => x.id === id);
        return u && !u.__unblocked;
      });
      if (!ids.length) {
        setStatus('No users selected.');
        return;
      }
      const ok = window.confirm(
        `Unblock ${ids.length} user${ids.length === 1 ? '' : 's'}? ` +
        `This can't be undone automatically - use "Export backup" first if you want a record of who was blocked.`
      );
      if (!ok) return;
      await runUnblock(ids);
    });

    els.cancel.addEventListener('click', () => {
      cancelRequested = true;
      setStatus('Cancelling...');
    });

    els.retryFailed.addEventListener('click', async () => {
      const ids = Array.from(failedIds);
      if (!ids.length || running) return;
      if (!window.confirm(`Retry ${ids.length} failed user(s)?`)) return;
      await runUnblock(ids);
    });

    enableDrag();
  }

  async function triggerLoad() {
    els.load.disabled = true;
    try {
      await loadBlockedList();
    } catch (e) {
      console.error(e);
      setStatus('Error loading list - check the console (F12).');
      log('Error: ' + e.message);
    }
    els.load.disabled = false;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function init() {
    injectStyles();
    buildUI();
    wireEvents();
  }

  function whenReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  whenReady(init);
})();
