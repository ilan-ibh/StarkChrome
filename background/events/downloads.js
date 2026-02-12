// StarkChrome v2 — Download Events (HIGH-VALUE on completion)
// Download completion triggers an immediate webhook to OpenClaw.

import { recordEvent } from '../store.js';
import { shouldTrack, sanitizeUrl } from '../privacy.js';
import { sendDownloadEvent } from '../api.js';

export function registerDownloadEvents() {
  // Track download state changes — we only care about completion
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.state || delta.state.current !== 'complete') return;

    // Get full download info
    try {
      const [item] = await chrome.downloads.search({ id: delta.id });
      if (!item || !shouldTrack(item.url)) return;

      const filename = item.filename?.split('/').pop() || 'unknown';
      const mime = item.mime || 'unknown';
      const url = sanitizeUrl(item.url);

      // Record locally
      recordEvent({
        type: 'download.completed',
        data: { url, filename, mime, fileSize: item.fileSize },
      });

      // HIGH-VALUE: Send to agent immediately
      sendDownloadEvent(filename, mime, url);
    } catch (e) {
      // Download may have been removed or is inaccessible
    }
  });

  console.log('[StarkChrome] Download events registered');
}
