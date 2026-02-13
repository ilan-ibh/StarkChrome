# StarkChrome — Service Worker Keep-Alive + Dual Digest Delivery

## Problem
Chrome kills MV3 service workers after ~30 seconds of inactivity. This means:
1. The page tracker (`tracker.js`) stops accumulating time-on-page data
2. The digest alarm dies — it only fires if the SW happens to be alive at 8pm
3. All accumulated `pageTimeLog` and `currentPage` data in memory is lost
4. Today's browsing showed zero real activity despite hours of use

## Fix 1: Service Worker Keep-Alive

### Create `background/keepalive.js`

```js
// StarkChrome — MV3 Service Worker Keep-Alive
// Chrome kills service workers after 30s of inactivity.
// This uses chrome.alarms (minimum 30s in production) to keep it alive.
// Also persists tracker state on every alarm tick so data survives restarts.

import { persistPageTimes, restorePageTimes } from './tracker.js';

const ALARM_NAME = 'starkchrome-keepalive';
const ALARM_PERIOD_MIN = 0.5; // 30 seconds (Chrome minimum)

export async function startKeepAlive() {
  // Create recurring alarm
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MIN,
    periodInMinutes: ALARM_PERIOD_MIN,
  });
  console.log('[StarkChrome] Keep-alive alarm started (30s interval)');
}

export function setupKeepAliveListener() {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
      // Persist tracker state to storage on every tick
      // This way if the SW does restart, we recover accumulated data
      await persistPageTimes();
    }
  });
}
```

### Update `background/service-worker.js`

Add these imports at the top:
```js
import { startKeepAlive, setupKeepAliveListener } from './keepalive.js';
import { restorePageTimes } from './tracker.js';
```

In the initialization block (where you see the console.logs for "v2 initialized"):
```js
// Add BEFORE the "v2 initialized" log:
setupKeepAliveListener();
await restorePageTimes();
await startKeepAlive();
```

This ensures:
- Alarm listener is registered immediately (Chrome requires this at top-level)
- Previous tracker state is restored if SW restarted
- Keep-alive alarm starts ticking

## Fix 2: Digest Alarm Resilience

The current digest scheduling uses `setTimeout` or a one-shot alarm that dies with the SW.

### Update `background/digest.js`

Replace the digest scheduling with a persistent `chrome.alarms` approach:

```js
const DIGEST_ALARM = 'starkchrome-digest';

export async function scheduleDigest() {
  // Check if alarm already exists
  const existing = await chrome.alarms.get(DIGEST_ALARM);
  if (existing) {
    console.log(`[StarkChrome] Digest alarm already set for ${new Date(existing.scheduledTime).toLocaleString()}`);
    return;
  }

  // Calculate next 8 PM local time
  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();
  await chrome.alarms.create(DIGEST_ALARM, {
    delayInMinutes: delayMs / 60000,
    periodInMinutes: 24 * 60, // Repeat every 24 hours
  });

  const minsFromNow = Math.round(delayMs / 60000);
  console.log(`[StarkChrome] Digest scheduled for ${target.toLocaleString()} (${minsFromNow}min from now)`);
}
```

Add a listener in the alarm handler (in `keepalive.js` or `service-worker.js`):
```js
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'starkchrome-digest') {
    const { buildAndSendDigest } = await import('./digest.js');
    await buildAndSendDigest();
  }
});
```

**Important:** `chrome.alarms` persist across SW restarts — Chrome will wake the SW when the alarm fires. This is the correct MV3 pattern. Remove any `setTimeout`-based scheduling.

## Fix 3: Dual Digest Delivery

When the digest fires, send it to both:
1. **OpenClaw webhook** (for agent awareness) — already working
2. **Chrome-logger** (for markdown file persistence) — new

### Update `background/digest.js` — in the `buildAndSendDigest()` function

After the existing `postToAgent(digestMessage)` call, add:

```js
// Also send to chrome-logger for file persistence
async function sendToLogger(digestText, pageContents) {
  const config = getConfig();
  if (!config.webhookUrl) return;

  // Derive logger URL from webhook URL
  // webhook: https://gateway.ilandev.com/hooks/agent
  // logger:  https://logger.ilandev.com/events
  const loggerUrl = 'https://logger.ilandev.com/events';

  try {
    // Send digest summary
    await fetch(loggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        events: [{
          type: 'daily.digest',
          data: { text: digestText, timestamp: Date.now() },
        }],
      }),
    });

    // Send page content entries individually
    if (pageContents && pageContents.length > 0) {
      const contentEvents = pageContents.map(page => ({
        type: 'page.content',
        data: {
          url: page.url,
          title: page.title,
          summary: page.meta?.description || '',
          content: page.content || '',
          timeSpent: page.timeSpent,
          timestamp: page.timestamp,
        },
      }));

      await fetch(loggerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify({ events: contentEvents }),
      });
    }

    console.log('[StarkChrome] Digest + content sent to logger');
  } catch (e) {
    console.warn('[StarkChrome] Logger send failed:', e.message);
    // Non-critical — don't throw
  }
}
```

Call `sendToLogger(digestMessage, pageContents)` in `buildAndSendDigest()` alongside the webhook send. `pageContents` should come from `store.js` — the accumulated `page.content` entries for today.

### Update `background/store.js`

Add an export to retrieve today's page content entries:

```js
export function getTodayPageContents() {
  // Return all page.content entries from today
  const today = new Date().toDateString();
  return events.filter(e =>
    e.type === 'page.content' &&
    new Date(e.timestamp).toDateString() === today
  );
}
```

## Fix 4: Real-Time Page Logging (Lightweight)

For continuous browsing awareness without waiting for the 8pm digest, add a lightweight real-time feed to the chrome-logger. Only send when the user **leaves** a page after spending 60+ seconds (not on every tab switch).

### Update `background/tracker.js`

In the `extractPageContent` function, after the content is stored via `addPageContent()`, also fire it to the logger:

```js
import { getConfig } from './api.js';

async function sendPageToLogger(url, title, timeSpent, content, meta) {
  const config = getConfig();
  if (!config.enabled || !config.token) return;

  const loggerUrl = 'https://logger.ilandev.com/events';

  try {
    await fetch(loggerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        events: [{
          type: 'page.visit',
          data: {
            url,
            title,
            domain: new URL(url).hostname,
            timeSpent,
            description: meta?.description || '',
            timestamp: Date.now(),
          },
        }],
      }),
    });
  } catch (e) {
    // Silent fail — non-critical
  }
}
```

Call `sendPageToLogger(...)` at the end of `extractPageContent()`, AFTER `addPageContent()` succeeds. This gives us real-time browsing in the markdown logs without waiting for the digest.

**Only for visits ≥60s** — change `CONTENT_MIN_MS` from 30000 to 60000 to reduce noise. Or keep 30s for local storage but only send to logger at 60s+.

## Summary of Changes

| File | Change |
|------|--------|
| `background/keepalive.js` | **NEW** — alarm-based keep-alive + state persistence |
| `background/service-worker.js` | Import keepalive, restore tracker state on start |
| `background/digest.js` | Use `chrome.alarms` instead of setTimeout, add logger delivery |
| `background/tracker.js` | Send page visits (≥60s) to logger in real-time |
| `background/store.js` | Add `getTodayPageContents()` export |

## Testing

After making changes:
1. Reload extension in `chrome://extensions`
2. Open console on service worker — should see keep-alive alarm starting
3. Browse a few pages for 60+ seconds each
4. Check `https://logger.ilandev.com/today` — should show entries
5. Check service worker status after 5 minutes — should still be **(active)**
6. Wait for 8pm or manually trigger digest — should appear in both webhook and logger

## Architecture Note

The logger URL (`logger.ilandev.com`) and token are the same as the webhook token. The logger accepts `POST /events` with `Authorization: Bearer <token>` and a JSON body with `{ events: [...] }`.

Event types the logger understands:
- `page.visit` — basic page visit with time spent
- `page.content` — page with extracted content/summary
- `daily.digest` — end-of-day digest summary
- `bookmark.created` — bookmarked a page
- `download.completed` — downloaded a file
- `user.comeback` — returned after being away
