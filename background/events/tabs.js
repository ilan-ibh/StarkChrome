// StarkChrome v2 — Tab Events
// Tracks tab switches and navigations. Feeds local store + time-on-page tracker.

import { recordEvent } from '../store.js';
import { shouldTrack } from '../privacy.js';
import { trackPageChange } from '../tracker.js';

export function registerTabEvents() {
  // Tab updated — URL or title change (main navigation signal)
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url || !shouldTrack(tab.url)) return;

    trackPageChange(tab.url, tab.title, tabId);

    recordEvent({
      type: 'navigation',
      data: { url: tab.url, title: tab.title, tabId },
    });
  });

  // Tab activated — user switched tabs
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (!tab.url || !shouldTrack(tab.url)) return;

      trackPageChange(tab.url, tab.title, activeInfo.tabId);

      recordEvent({
        type: 'tab.activated',
        data: { url: tab.url, title: tab.title, tabId: activeInfo.tabId },
      });
    } catch (e) {} // Tab may have been removed
  });

  console.log('[StarkChrome] Tab events registered');
}
