// StarkChrome v2 — Keep-Alive
// Chrome kills service workers after ~30s of inactivity.
// A chrome.alarms tick every 25s keeps it alive and persists tracker state.

import { persistPageTimes } from './tracker.js';
import { flushStore } from './store.js';

const KEEPALIVE_ALARM = 'starkchrome-keepalive';

export function startKeepAlive() {
  // Chrome.alarms minimum is 30s in production, but setting 0.4min (~24s)
  // ensures the SW stays warm. Chrome may clamp to 30s — that's fine.
  chrome.alarms.create(KEEPALIVE_ALARM, {
    delayInMinutes: 0.5,
    periodInMinutes: 0.5, // every 30 seconds
  });
  console.log('[StarkChrome] Keep-alive alarm started (30s tick)');
}

export async function handleKeepAlive(alarm) {
  if (alarm.name !== KEEPALIVE_ALARM) return false;

  // Persist tracker state on each tick so nothing is lost if SW dies
  await persistPageTimes();

  return true;
}
