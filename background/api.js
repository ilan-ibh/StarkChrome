// StarkChrome v2 — OpenClaw Webhook Client
// Single endpoint. Rare calls. Only when something is worth the agent's attention.

const DEFAULT_CONFIG = {
  webhookUrl: '',
  token: '',
  sessionKey: 'starkchrome',
  enabled: false,
  // Schedule
  digestTime: '20:00',           // 8 PM local time
  sendBookmarks: true,
  sendDownloads: true,
  sendComeback: true,
  comebackMinutes: 30,
};

let cachedConfig = null;

export async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('config');
    cachedConfig = { ...DEFAULT_CONFIG, ...result.config };
  } catch (e) {
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

export async function saveConfig(config) {
  cachedConfig = { ...DEFAULT_CONFIG, ...config };
  await chrome.storage.local.set({ config: cachedConfig });
  return cachedConfig;
}

export function getConfig() {
  return cachedConfig || DEFAULT_CONFIG;
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.webhookUrl && c.token && c.enabled);
}

// ============================================================
// POST to OpenClaw webhook
// ============================================================

export async function postToAgent(message, wakeMode = 'now', overrides = {}) {
  const config = getConfig();
  if (!config.enabled || !config.webhookUrl || !config.token) {
    return { success: false, reason: 'not_configured' };
  }

  const payload = {
    message,
    sessionKey: overrides.sessionKey || config.sessionKey || 'starkchrome',
    name: overrides.name || 'StarkChrome',
    wakeMode,
    deliver: false,
  };

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 202) {
      const data = await response.json().catch(() => ({}));
      console.log(`[StarkChrome] Webhook sent (${response.status})`);
      await updateStats(true);
      return { success: true, status: response.status, data };
    } else {
      const text = await response.text().catch(() => '');
      console.error(`[StarkChrome] Webhook error ${response.status}: ${text}`);
      await updateStats(false);
      return { success: false, reason: 'http_error', status: response.status };
    }
  } catch (e) {
    console.error('[StarkChrome] Webhook failed:', e.message);
    await updateStats(false);
    return { success: false, reason: 'network_error', error: e.message };
  }
}

// ============================================================
// High-value event senders
// ============================================================

export async function sendBookmarkEvent(title, url) {
  const config = getConfig();
  if (!config.sendBookmarks) return;
  return postToAgent(`[StarkChrome] Bookmarked: "${title}" — ${url}`);
}

export async function sendDownloadEvent(filename, mime, url) {
  const config = getConfig();
  if (!config.sendDownloads) return;
  return postToAgent(`[StarkChrome] Downloaded: ${filename} (${mime}) from ${url}`);
}

export async function sendComebackEvent(awayMinutes, currentUrl) {
  const config = getConfig();
  if (!config.sendComeback) return;
  const domain = currentUrl ? ` Currently on: ${new URL(currentUrl).hostname}` : '';
  return postToAgent(`[StarkChrome] User returned after ${awayMinutes} minutes away.${domain}`);
}

export async function sendDigest(digestMessage) {
  return postToAgent(digestMessage, 'next-heartbeat');
}

export async function sendHistoryImport(message) {
  return postToAgent(message);
}

// ============================================================
// Stats
// ============================================================

async function updateStats(success) {
  try {
    const result = await chrome.storage.local.get('webhookStats');
    const stats = result.webhookStats || { sent: 0, failed: 0, lastSend: null, lastError: null };
    if (success) {
      stats.sent++;
      stats.lastSend = new Date().toISOString();
    } else {
      stats.failed++;
      stats.lastError = new Date().toISOString();
    }
    await chrome.storage.local.set({ webhookStats: stats });
  } catch (e) {}
}

export async function getStats() {
  const result = await chrome.storage.local.get('webhookStats');
  return result.webhookStats || { sent: 0, failed: 0, lastSend: null, lastError: null };
}

// Listen for config changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) {
    cachedConfig = changes.config.newValue;
  }
});
