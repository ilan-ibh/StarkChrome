// StarkChrome v2 — Logger Endpoint Client
// Lightweight continuous logger for page content events.
// Separate from the OpenClaw webhook — this is cheap, always-on logging.

const DEFAULT_LOGGER = {
  loggerUrl: '',
  loggerToken: '',
  loggerEnabled: false,
};

let cachedLogger = null;

export async function loadLoggerConfig() {
  try {
    const result = await chrome.storage.local.get('loggerConfig');
    cachedLogger = { ...DEFAULT_LOGGER, ...result.loggerConfig };
  } catch (e) {
    cachedLogger = { ...DEFAULT_LOGGER };
  }
  return cachedLogger;
}

export function getLoggerConfig() {
  return cachedLogger || DEFAULT_LOGGER;
}

export function isLoggerConfigured() {
  const c = getLoggerConfig();
  return !!(c.loggerUrl && c.loggerToken && c.loggerEnabled);
}

// POST an event to the logger endpoint
export async function postToLogger(event) {
  const config = getLoggerConfig();
  if (!config.loggerEnabled || !config.loggerUrl || !config.loggerToken) {
    return { success: false, reason: 'not_configured' };
  }

  try {
    const response = await fetch(config.loggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.loggerToken}`,
      },
      body: JSON.stringify(event),
    });

    if (response.ok || response.status === 202) {
      await updateLoggerStats(true);
      return { success: true, status: response.status };
    } else {
      const text = await response.text().catch(() => '');
      console.error(`[StarkChrome] Logger error ${response.status}: ${text}`);
      await updateLoggerStats(false);
      return { success: false, reason: 'http_error', status: response.status };
    }
  } catch (e) {
    console.error('[StarkChrome] Logger failed:', e.message);
    await updateLoggerStats(false);
    return { success: false, reason: 'network_error', error: e.message };
  }
}

async function updateLoggerStats(success) {
  try {
    const result = await chrome.storage.local.get('loggerStats');
    const stats = result.loggerStats || { sent: 0, failed: 0, lastSend: null };
    if (success) {
      stats.sent++;
      stats.lastSend = new Date().toISOString();
    } else {
      stats.failed++;
    }
    await chrome.storage.local.set({ loggerStats: stats });
  } catch (e) {
    // Non-critical
  }
}

export async function getLoggerStats() {
  const result = await chrome.storage.local.get('loggerStats');
  return result.loggerStats || { sent: 0, failed: 0, lastSend: null };
}

// Listen for config changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.loggerConfig) {
    cachedLogger = changes.loggerConfig.newValue;
  }
});
