// StarkChrome v2 — Local Event Store
// All event data lives in chrome.storage.local. No external servers.
// Rolling 90-day retention. Human-readable. Exportable.

import { sanitizeUrl, getDomain } from './privacy.js';
import { categorize } from './categories.js';

const STORE_KEY = 'eventLog';
const META_KEY = 'storeMeta';
const DEFAULT_RETENTION_DAYS = 90;

// In-memory cache for fast access (loaded from storage on init)
let eventLog = [];
let storeMeta = { totalEvents: 0, oldestEvent: null, newestEvent: null };

// Initialize store — load from storage
export async function initStore() {
  try {
    const result = await chrome.storage.local.get([STORE_KEY, META_KEY]);
    eventLog = result[STORE_KEY] || [];
    storeMeta = result[META_KEY] || { totalEvents: 0, oldestEvent: null, newestEvent: null };
    console.log(`[StarkChrome] Store loaded: ${eventLog.length} events`);
  } catch (e) {
    console.error('[StarkChrome] Store init failed:', e);
    eventLog = [];
  }
  return eventLog;
}

// Record an event to local storage
export async function recordEvent(event) {
  const entry = {
    t: Date.now(),                              // timestamp
    type: event.type,                           // event type
    url: sanitizeUrl(event.data?.url || ''),     // sanitized URL
    domain: getDomain(event.data?.url || ''),    // domain
    cat: categorize(getDomain(event.data?.url || '')), // category
    title: (event.data?.title || '').substring(0, 200), // truncated title
    data: compactData(event),                   // compact event-specific data
  };

  eventLog.push(entry);

  // Update meta
  storeMeta.totalEvents++;
  storeMeta.newestEvent = entry.t;
  if (!storeMeta.oldestEvent) storeMeta.oldestEvent = entry.t;

  // Persist every 5 events (batched to reduce storage writes)
  if (eventLog.length % 5 === 0) {
    await persistStore();
  }
}

// Compact event data — only keep what's useful, discard noise
function compactData(event) {
  switch (event.type) {
    case 'navigation':
      return { transition: event.data?.transitionType };
    case 'tab.activated':
      return {};
    case 'bookmark.created':
      return { url: sanitizeUrl(event.data?.url || ''), title: event.data?.title || '' };
    case 'download.completed':
      return {
        filename: event.data?.filename || '',
        mime: event.data?.mime || '',
        fileSize: event.data?.fileSize || 0,
        url: sanitizeUrl(event.data?.url || ''),
      };
    case 'user.comeback':
      return { awayMinutes: event.data?.awayMinutes || 0 };
    case 'idle':
      return { state: event.data?.state || '' };
    default:
      return {};
  }
}

// Persist store to chrome.storage.local
async function persistStore() {
  try {
    // Enforce retention before saving
    enforceRetention();
    await chrome.storage.local.set({
      [STORE_KEY]: eventLog,
      [META_KEY]: storeMeta,
    });
  } catch (e) {
    // If storage quota is hit, trim aggressively
    if (e.message?.includes('QUOTA')) {
      eventLog = eventLog.slice(-1000);
      await chrome.storage.local.set({ [STORE_KEY]: eventLog, [META_KEY]: storeMeta });
    }
  }
}

// Remove events older than retention period
function enforceRetention() {
  const cutoff = Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = eventLog.length;
  eventLog = eventLog.filter(e => e.t > cutoff);
  if (eventLog.length < before) {
    storeMeta.oldestEvent = eventLog.length > 0 ? eventLog[0].t : null;
    console.log(`[StarkChrome] Pruned ${before - eventLog.length} old events`);
  }
}

// Force persist (call on important events or before service worker sleeps)
export async function flushStore() {
  await persistStore();
}

// ============================================================
// QUERY FUNCTIONS — Used by digest builder and popup
// ============================================================

// Get events for a specific day (or today if no date given)
export function getEventsForDay(date) {
  const d = date || new Date();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  return eventLog.filter(e => e.t >= dayStart && e.t < dayEnd);
}

// Get today's events
export function getTodayEvents() {
  return getEventsForDay(new Date());
}

// Get domain visit counts for a day
export function getDomainStats(events) {
  const stats = {};
  for (const e of events) {
    if (!e.domain || e.type === 'idle' || e.type === 'user.comeback') continue;
    if (!stats[e.domain]) {
      stats[e.domain] = { visits: 0, cat: e.cat, title: e.title, firstSeen: e.t, lastSeen: e.t };
    }
    stats[e.domain].visits++;
    stats[e.domain].lastSeen = Math.max(stats[e.domain].lastSeen, e.t);
    if (e.title) stats[e.domain].title = e.title;
  }
  return stats;
}

// Get store statistics
export function getStoreStats() {
  return {
    eventCount: eventLog.length,
    totalEvents: storeMeta.totalEvents,
    oldestEvent: storeMeta.oldestEvent,
    newestEvent: storeMeta.newestEvent,
    estimatedSizeKB: Math.round(JSON.stringify(eventLog).length / 1024),
  };
}

// ============================================================
// PAGE CONTENT STORAGE (separate from event log — bigger data)
// ============================================================

// Add extracted page content, keyed by date
export async function addPageContent(entry) {
  const key = `content_${new Date().toISOString().slice(0, 10)}`; // content_2026-02-12
  const existing = (await chrome.storage.local.get(key))[key] || [];

  // Deduplicate by URL (keep the version with longest time spent)
  const idx = existing.findIndex(e => e.url === entry.url);
  if (idx >= 0) {
    if (entry.timeSpent > existing[idx].timeSpent) {
      existing[idx] = entry;
    }
  } else {
    existing.push(entry);
  }

  // Keep top 50 pages per day max, sorted by time spent
  existing.sort((a, b) => b.timeSpent - a.timeSpent);
  const trimmed = existing.slice(0, 50);

  await chrome.storage.local.set({ [key]: trimmed });
  console.log(`[StarkChrome] Stored page content: ${entry.title?.substring(0, 50)} (${Math.round(entry.timeSpent / 1000)}s)`);
}

// Get page content for a specific date ("2026-02-12")
export async function getPageContent(date) {
  const key = `content_${date}`;
  return (await chrome.storage.local.get(key))[key] || [];
}

// ============================================================

// Export all events as JSON
export function exportEvents() {
  return {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    eventCount: eventLog.length,
    events: eventLog,
  };
}

// Clear all stored events
export async function clearStore() {
  eventLog = [];
  storeMeta = { totalEvents: 0, oldestEvent: null, newestEvent: null };
  await chrome.storage.local.remove([STORE_KEY, META_KEY]);
}
