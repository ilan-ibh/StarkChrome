// StarkChrome v2 — Time-on-Page Tracker + Content Extraction
// Tracks how long the user spends on each page/tab.
// When user leaves a page after 30s+, extracts readable content via content script.

import { getDomain, shouldTrack } from './privacy.js';
import { addPageContent } from './store.js';

let currentPage = null; // { url, domain, title, startTime, tabId }
let pageTimeLog = [];   // accumulated page times for today

const MIN_DURATION_MS = 3000;           // Ignore <3 second bounces
const MAX_DURATION_MS = 30 * 60 * 1000; // Cap at 30 minutes
const CONTENT_MIN_MS = 30 * 1000;       // Extract content after 30s+
const CONTENT_MAX_MS = 30 * 60 * 1000;  // Skip if >30 min (probably idle)

// Called when user navigates to a new page or switches tabs
export function trackPageChange(url, title, tabId) {
  const now = Date.now();

  // Close out the previous page
  if (currentPage) {
    const duration = Math.min(now - currentPage.startTime, MAX_DURATION_MS);
    if (duration >= MIN_DURATION_MS) {
      accumulateTime(currentPage.domain, duration);
    }
    // Extract content for meaningful visits (30s - 30min)
    if (duration >= CONTENT_MIN_MS && duration <= CONTENT_MAX_MS) {
      extractPageContent(currentPage.tabId, currentPage.url, currentPage.title, duration);
    }
  }

  // Start tracking the new page
  if (url && shouldTrack(url)) {
    currentPage = {
      url,
      domain: getDomain(url),
      title: title || '',
      startTime: now,
      tabId,
    };
  } else {
    currentPage = null;
  }
}

// Called when user goes idle or locks screen
export function trackIdle() {
  if (currentPage) {
    const duration = Math.min(Date.now() - currentPage.startTime, MAX_DURATION_MS);
    if (duration >= MIN_DURATION_MS) {
      accumulateTime(currentPage.domain, duration);
    }
    if (duration >= CONTENT_MIN_MS && duration <= CONTENT_MAX_MS) {
      extractPageContent(currentPage.tabId, currentPage.url, currentPage.title, duration);
    }
    currentPage = null;
  }
}

// Called when user comes back from idle
export function trackActive(url, title, tabId) {
  trackPageChange(url, title, tabId);
}

// Extract readable content from the page via content script
async function extractPageContent(tabId, url, title, timeSpent) {
  // Don't extract for internal URLs
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
  if (!shouldTrack(url)) return;

  try {
    const content = await chrome.tabs.sendMessage(tabId, { type: 'extract_content' });
    if (content && content.text && content.text.length > 100) {
      await addPageContent({
        url,
        title: title || content.meta?.title || '',
        timeSpent,
        content: content.text.slice(0, 2000), // 2000 chars for storage
        meta: content.meta || {},
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    // Content script not available (PDF, chrome pages, etc.) — skip silently
  }
}

// Accumulate time for a domain
function accumulateTime(domain, durationMs) {
  if (!domain) return;
  const existing = pageTimeLog.find(e => e.domain === domain);
  if (existing) {
    existing.totalMs += durationMs;
    existing.sessions++;
  } else {
    pageTimeLog.push({ domain, totalMs: durationMs, sessions: 1 });
  }
}

// Get accumulated page times (for digest builder)
export function getPageTimes() {
  return [...pageTimeLog].sort((a, b) => b.totalMs - a.totalMs);
}

// Reset page times (after digest is built)
export function resetPageTimes() {
  pageTimeLog = [];
}

// Format milliseconds to human-readable
export function formatDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}min`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

// Get total active time today
export function getTotalActiveTime() {
  return pageTimeLog.reduce((sum, e) => sum + e.totalMs, 0);
}

// Persist page times to storage (survives service worker restart)
export async function persistPageTimes() {
  await chrome.storage.local.set({ _pageTimes: pageTimeLog, _currentPage: currentPage });
}

// Restore page times from storage
export async function restorePageTimes() {
  try {
    const result = await chrome.storage.local.get(['_pageTimes', '_currentPage']);
    if (result._pageTimes) pageTimeLog = result._pageTimes;
    if (result._currentPage) currentPage = result._currentPage;
  } catch (e) {
    // Fresh start if storage is corrupted
  }
}
