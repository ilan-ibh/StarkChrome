// StarkChrome v2 — Options Page

function sanitize(raw) {
  return raw.trim().split(/[\s\u2022]/)[0].replace(/[^\x20-\x7E]/g, '').trim();
}

document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    webhookUrl: document.getElementById('webhookUrl'),
    token: document.getElementById('token'),
    toggleToken: document.getElementById('toggleToken'),
    enabled: document.getElementById('enabled'),
    testBtn: document.getElementById('testBtn'),
    testResult: document.getElementById('testResult'),
    digestTime: document.getElementById('digestTime'),
    sendBookmarks: document.getElementById('sendBookmarks'),
    sendDownloads: document.getElementById('sendDownloads'),
    sendComeback: document.getElementById('sendComeback'),
    trackIncognito: document.getElementById('trackIncognito'),
    blocklist: document.getElementById('blocklist'),
    retention: document.getElementById('retention'),
    eventCount: document.getElementById('eventCount'),
    storageKB: document.getElementById('storageKB'),
    exportBtn: document.getElementById('exportBtn'),
    clearBtn: document.getElementById('clearBtn'),
    digestBtn: document.getElementById('digestBtn'),
    statsSent: document.getElementById('statsSent'),
    statsFailed: document.getElementById('statsFailed'),
    saveBtn: document.getElementById('saveBtn'),
    toast: document.getElementById('toast'),
  };

  await load();

  els.toggleToken.addEventListener('click', () => {
    els.token.type = els.token.type === 'password' ? 'text' : 'password';
  });

  els.testBtn.addEventListener('click', async () => {
    els.testResult.textContent = 'Testing...';
    els.testResult.className = 'result';
    els.testBtn.disabled = true;

    // Save first so service worker picks up the URL
    await save();

    // Small delay to let storage change propagate to service worker
    await new Promise(r => setTimeout(r, 300));

    try {
      // Race against a 15-second timeout
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout — try reloading the extension')), 15000));
      const r = await Promise.race([
        chrome.runtime.sendMessage({ action: 'testConnection' }),
        timeout,
      ]);
      if (r.success) {
        els.testResult.textContent = `Connected! (${r.status})`;
        els.testResult.className = 'result ok';
      } else {
        els.testResult.textContent = r.reason === 'not_configured' ? 'Enter URL + token and enable' : `Error: ${r.reason}`;
        els.testResult.className = 'result err';
      }
    } catch (e) {
      els.testResult.textContent = e.message || 'Error';
      els.testResult.className = 'result err';
    }
    els.testBtn.disabled = false;
  });

  els.saveBtn.addEventListener('click', async () => {
    await save();
    toast('Saved');
  });

  els.exportBtn.addEventListener('click', async () => {
    const result = await chrome.storage.local.get('eventLog');
    const data = { version: '2.0', exportedAt: new Date().toISOString(), events: result.eventLog || [] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starkchrome-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  els.clearBtn.addEventListener('click', async () => {
    if (confirm('Clear all local event data? This cannot be undone.')) {
      await chrome.storage.local.remove(['eventLog', 'storeMeta', 'webhookStats']);
      await load();
      toast('Data cleared');
    }
  });

  els.digestBtn.addEventListener('click', async () => {
    els.digestBtn.disabled = true;
    els.digestBtn.textContent = 'Sending...';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'sendDigestNow' });
      els.digestBtn.textContent = r.success ? 'Sent!' : `Failed: ${r.reason}`;
    } catch (e) {
      els.digestBtn.textContent = 'Error';
    }
    setTimeout(() => { els.digestBtn.textContent = 'Send Digest Now'; els.digestBtn.disabled = false; }, 2000);
    await load();
  });

  async function load() {
    const result = await chrome.storage.local.get(['config', 'privacy', 'storeMeta', 'webhookStats']);
    const config = result.config || {};
    const privacy = result.privacy || {};
    const meta = result.storeMeta || {};
    const stats = result.webhookStats || {};

    els.webhookUrl.value = config.webhookUrl || '';
    els.token.value = config.token || '';
    els.enabled.checked = config.enabled || false;
    els.digestTime.value = config.digestTime || '20:00';
    els.sendBookmarks.checked = config.sendBookmarks !== false;
    els.sendDownloads.checked = config.sendDownloads !== false;
    els.sendComeback.checked = config.sendComeback !== false;

    els.trackIncognito.checked = privacy.trackIncognito || false;
    els.blocklist.value = (privacy.domainBlocklist || []).join('\n');

    // Store stats
    try {
      const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
      els.eventCount.textContent = (status.store?.eventCount || 0).toLocaleString();
      els.storageKB.textContent = status.store?.estimatedSizeKB || 0;
    } catch (e) {
      els.eventCount.textContent = '?';
      els.storageKB.textContent = '?';
    }

    els.statsSent.textContent = stats.sent || 0;
    els.statsFailed.textContent = stats.failed || 0;
  }

  async function save() {
    const config = {
      webhookUrl: els.webhookUrl.value.trim(),
      token: sanitize(els.token.value),
      enabled: els.enabled.checked,
      sessionKey: 'starkchrome',
      digestTime: els.digestTime.value || '20:00',
      sendBookmarks: els.sendBookmarks.checked,
      sendDownloads: els.sendDownloads.checked,
      sendComeback: els.sendComeback.checked,
    };

    const privacy = {
      enabled: true,
      trackIncognito: els.trackIncognito.checked,
      domainBlocklist: els.blocklist.value.split('\n').map(s => s.trim()).filter(Boolean),
    };

    await chrome.storage.local.set({ config, privacy });
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
  }
});
