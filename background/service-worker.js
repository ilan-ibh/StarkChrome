// StarkChrome v2 — Service Worker
// Smart local processing. Rare webhook calls.
// No extra servers. No extra ports. Just the extension and one webhook URL.

import { loadPrivacySettings, getPrivacySettings } from './privacy.js';
import { loadConfig, getConfig, isConfigured, postToAgent } from './api.js';
import { initStore, flushStore, getStoreStats } from './store.js';
import { restorePageTimes, persistPageTimes } from './tracker.js';
import { registerTabEvents } from './events/tabs.js';
import { registerBookmarkEvents } from './events/bookmarks.js';
import { registerDownloadEvents } from './events/downloads.js';
import { registerIdleEvents } from './events/idle.js';
import { scheduleDigest, handleDigestAlarm, buildAndSendDigest } from './digest.js';
import { hasImported, runImport, resetImport, getImportStatus } from './history-import.js';

console.log('[StarkChrome] v2 service worker starting...');

// ============================================================
// INIT
// ============================================================

async function initialize() {
  await Promise.all([
    loadPrivacySettings(),
    loadConfig(),
    initStore(),
    restorePageTimes(),
  ]);

  const privacy = getPrivacySettings();
  if (privacy.enabled) {
    registerTabEvents();
    registerBookmarkEvents();
    registerDownloadEvents();
    registerIdleEvents();
  }

  if (isConfigured()) {
    scheduleDigest();
  }

  updateBadge();

  console.log('[StarkChrome] v2 initialized');
  console.log('[StarkChrome] Tracking:', privacy.enabled ? 'ON' : 'OFF');
  console.log('[StarkChrome] Webhook:', isConfigured() ? 'connected' : 'not configured');
}

// ============================================================
// ALARMS
// ============================================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Daily digest
  if (await handleDigestAlarm(alarm)) return;

  // Periodic store + tracker persistence (every 5 min)
  if (alarm.name === 'starkchrome-persist') {
    await flushStore();
    await persistPageTimes();
  }
});

// Persistence alarm — save store and page times every 5 minutes
chrome.alarms.create('starkchrome-persist', {
  delayInMinutes: 5,
  periodInMinutes: 5,
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'getStatus': {
      const config = getConfig();
      const privacy = getPrivacySettings();
      const store = getStoreStats();
      const { webhookStats } = await chrome.storage.local.get('webhookStats');
      const stats = webhookStats || { sent: 0, failed: 0, lastSend: null };
      return {
        enabled: privacy.enabled,
        configured: isConfigured(),
        webhookUrl: config.webhookUrl ? '***configured***' : '',
        store,
        stats,
      };
    }

    case 'sendDigestNow':
      return await buildAndSendDigest();

    case 'runImport': {
      const already = await hasImported();
      if (already && !msg.force) {
        return { success: false, reason: 'already_done' };
      }
      if (msg.force) await resetImport();
      runImport(); // fire and forget
      return { success: true, message: 'Import started' };
    }

    case 'getImportStatus':
      return await getImportStatus();

    case 'testConnection': {
      // Reload config from storage first (user may have just saved new values)
      await loadConfig();
      return await postToAgent('[StarkChrome] Connection test — if you see this, StarkChrome v2 is connected!');
    }

    default:
      return { error: 'Unknown action' };
  }
}

// ============================================================
// BADGE
// ============================================================

async function updateBadge() {
  const privacy = getPrivacySettings();
  const config = getConfig();

  if (!privacy.enabled) {
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else if (!isConfigured()) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    await chrome.action.setBadgeText({ text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }
}

// ============================================================
// CONFIG CHANGE LISTENER
// ============================================================

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  if (changes.config || changes.privacy) {
    updateBadge();
  }

  // When user first configures + enables, auto-import history
  if (changes.config) {
    const newConfig = changes.config.newValue || {};
    const oldConfig = changes.config.oldValue || {};
    if (newConfig.enabled && !oldConfig.enabled && newConfig.webhookUrl) {
      scheduleDigest();
      const already = await hasImported();
      if (!already) {
        console.log('[StarkChrome] First connection — auto-importing history...');
        runImport();
      }
    }
  }
});

// ============================================================
// "SEND TO STARK" — Keyboard shortcut (Cmd+Shift+S) + Context menu
// Sends the current page's full content to the agent immediately.
// ============================================================

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'send-to-stark') return;
  await sendCurrentPageToAgent();
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'send-to-stark') return;
  await sendCurrentPageToAgent();
});

async function sendCurrentPageToAgent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const content = await chrome.tabs.sendMessage(tab.id, { type: 'extract_content' });
    if (!content || !content.text) {
      flashBadge('!', '#f59e0b');
      return;
    }

    const lines = [
      `[StarkChrome] User sent page content:`,
      ``,
      `Title: ${content.meta?.title || tab.title || ''}`,
      `URL: ${content.meta?.url || tab.url || ''}`,
    ];
    if (content.meta?.author) lines.push(`Author: ${content.meta.author}`);
    if (content.meta?.publishDate) lines.push(`Published: ${content.meta.publishDate}`);
    lines.push(`Word count: ${content.wordCount || 0}`);
    lines.push(``);
    lines.push(`Content:`);
    lines.push(content.text);

    const result = await postToAgent(lines.join('\n'));

    if (result.success) {
      flashBadge('OK', '#10b981');
    } else {
      flashBadge('!', '#ef4444');
    }
  } catch (e) {
    console.error('[StarkChrome] Send to Stark failed:', e);
    flashBadge('!', '#ef4444');
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => updateBadge(), 2000);
}

// ============================================================
// INSTALL / UPDATE
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[StarkChrome] Extension installed');
    chrome.runtime.openOptionsPage();
  }

  // Create context menu on install/update
  chrome.contextMenus.create({
    id: 'send-to-stark',
    title: 'Send to Stark',
    contexts: ['page'],
  });
});

// ============================================================
// GO
// ============================================================

initialize();
