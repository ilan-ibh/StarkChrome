// StarkChrome v2 — Idle & Comeback Detection (HIGH-VALUE on comeback)
// When user is idle/locked for 30+ minutes then comes back,
// sends a comeback event to OpenClaw.

import { recordEvent } from '../store.js';
import { getConfig, sendComebackEvent } from '../api.js';
import { trackIdle } from '../tracker.js';

let lastIdleStart = null;
let currentState = 'active';

export function registerIdleEvents() {
  chrome.idle.setDetectionInterval(60); // 60 seconds

  chrome.idle.onStateChanged.addListener(async (newState) => {
    const now = Date.now();

    // Record all state changes locally
    recordEvent({
      type: 'idle',
      data: { state: newState, previousState: currentState },
    });

    if (newState === 'idle' || newState === 'locked') {
      if (currentState === 'active') {
        lastIdleStart = now;
        chrome.storage.local.set({ _idleStart: now });
        trackIdle();
      }
    } else if (newState === 'active') {
      // Comeback detection
      const idleStart = lastIdleStart;
      lastIdleStart = null;
      chrome.storage.local.remove('_idleStart');

      if (idleStart) {
        const awayMinutes = Math.round((now - idleStart) / 60000);
        const config = getConfig();
        const threshold = config.comebackMinutes || 30;

        if (awayMinutes >= threshold) {
          // Record comeback locally
          recordEvent({
            type: 'user.comeback',
            data: { awayMinutes, returnedAt: new Date(now).toISOString() },
          });

          // HIGH-VALUE: Send to agent
          // Get current tab for context
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            sendComebackEvent(awayMinutes, tab?.url || '');
          } catch (e) {
            sendComebackEvent(awayMinutes, '');
          }
        }
      }
    }

    currentState = newState;
  });

  // Restore idle start (service worker may have restarted)
  chrome.storage.local.get('_idleStart').then((result) => {
    if (result._idleStart) lastIdleStart = result._idleStart;
  });

  console.log('[StarkChrome] Idle + comeback events registered');
}
