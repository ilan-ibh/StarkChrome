// StarkChrome v2 — Popup

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('masterToggle');
  const dot = document.getElementById('dot');
  const connectionLabel = document.getElementById('connectionLabel');
  const eventCount = document.getElementById('eventCount');
  const storageSize = document.getElementById('storageSize');
  const webhooksSent = document.getElementById('webhooksSent');
  const lastWebhook = document.getElementById('lastWebhook');
  const digestBtn = document.getElementById('digestBtn');
  const importBtn = document.getElementById('importBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const actionStatus = document.getElementById('actionStatus');

  await refresh();

  masterToggle.addEventListener('change', async () => {
    const result = await chrome.storage.local.get('privacy');
    const privacy = result.privacy || {};
    privacy.enabled = masterToggle.checked;
    await chrome.storage.local.set({ privacy });
    await refresh();
  });

  digestBtn.addEventListener('click', async () => {
    digestBtn.disabled = true;
    digestBtn.textContent = 'Building...';
    actionStatus.textContent = '';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'sendDigestNow' });
      if (result.success) {
        actionStatus.textContent = 'Digest sent!';
        actionStatus.className = 'action-status success';
      } else {
        actionStatus.textContent = result.reason === 'no_events' ? 'No events to send' : `Failed: ${result.reason}`;
        actionStatus.className = 'action-status error';
      }
    } catch (e) {
      actionStatus.textContent = 'Error: ' + e.message;
      actionStatus.className = 'action-status error';
    }
    digestBtn.textContent = 'Send Digest Now';
    digestBtn.disabled = false;
    await refresh();
  });

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';
    try {
      const status = await chrome.runtime.sendMessage({ action: 'getImportStatus' });
      const force = status.done;
      const result = await chrome.runtime.sendMessage({ action: 'runImport', force });
      if (result.success) {
        actionStatus.textContent = 'Import started...';
        actionStatus.className = 'action-status success';
        // Poll for completion
        const poll = setInterval(async () => {
          const s = await chrome.runtime.sendMessage({ action: 'getImportStatus' });
          if (s.progress?.phase === 'done') {
            clearInterval(poll);
            actionStatus.textContent = `Import complete! ${s.importData?.historyCount || 0} history, ${s.importData?.bookmarkCount || 0} bookmarks`;
            importBtn.textContent = 'Re-import History';
            importBtn.disabled = false;
          } else if (s.progress?.phase === 'error') {
            clearInterval(poll);
            actionStatus.textContent = 'Import failed';
            actionStatus.className = 'action-status error';
            importBtn.textContent = 'Import History';
            importBtn.disabled = false;
          } else {
            actionStatus.textContent = s.progress?.detail || 'Working...';
          }
        }, 1500);
      } else {
        actionStatus.textContent = result.reason;
        actionStatus.className = 'action-status error';
        importBtn.disabled = false;
      }
    } catch (e) {
      actionStatus.textContent = 'Error: ' + e.message;
      actionStatus.className = 'action-status error';
      importBtn.disabled = false;
      importBtn.textContent = 'Import History';
    }
  });

  optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  async function refresh() {
    try {
      const status = await chrome.runtime.sendMessage({ action: 'getStatus' });

      masterToggle.checked = status.enabled;

      if (!status.enabled) {
        dot.className = 'dot red';
        connectionLabel.textContent = 'Tracking disabled';
      } else if (!status.configured) {
        dot.className = 'dot yellow';
        connectionLabel.textContent = 'Webhook not configured';
      } else {
        dot.className = 'dot green';
        connectionLabel.textContent = 'Connected';
      }

      eventCount.textContent = (status.store?.eventCount || 0).toLocaleString();
      storageSize.textContent = `${status.store?.estimatedSizeKB || 0} KB`;
      webhooksSent.textContent = status.stats?.sent || 0;

      if (status.stats?.lastSend) {
        lastWebhook.textContent = timeAgo(new Date(status.stats.lastSend));
        lastWebhook.classList.remove('muted');
      } else {
        lastWebhook.textContent = 'Never';
        lastWebhook.classList.add('muted');
      }

      digestBtn.disabled = !status.configured;

      // Check import status
      const importStatus = await chrome.runtime.sendMessage({ action: 'getImportStatus' });
      if (importStatus.done) {
        importBtn.textContent = 'Re-import History';
      }
    } catch (e) {
      dot.className = 'dot gray';
      connectionLabel.textContent = 'Service worker loading...';
    }
  }

  function timeAgo(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  setInterval(refresh, 5000);
});
