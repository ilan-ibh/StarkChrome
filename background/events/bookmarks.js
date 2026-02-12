// StarkChrome v2 — Bookmark Events (HIGH-VALUE)
// Bookmark creation triggers an immediate webhook to OpenClaw.

import { recordEvent } from '../store.js';
import { sendBookmarkEvent } from '../api.js';

export function registerBookmarkEvents() {
  chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    const title = bookmark.title || '(untitled)';
    const url = bookmark.url || '';

    // Record locally
    recordEvent({
      type: 'bookmark.created',
      data: { url, title, id },
    });

    // HIGH-VALUE: Send to agent immediately
    sendBookmarkEvent(title, url);
  });

  console.log('[StarkChrome] Bookmark events registered');
}
