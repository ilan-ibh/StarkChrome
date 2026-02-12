// StarkChrome v2 — Full History Import
// Pulls the FULL 90-day browsing history + all bookmarks.
// Sends raw history in batches of 500 entries to a separate session
// so it doesn't pollute the main agent conversation.

import { getConfig, postToAgent } from './api.js';
import { shouldTrack, sanitizeUrl } from './privacy.js';

const IMPORT_DONE_KEY = 'historyImportDone';
const IMPORT_PROGRESS_KEY = 'historyImportProgress';
const BATCH_SIZE = 500;

export async function hasImported() {
  return !!(await chrome.storage.local.get(IMPORT_DONE_KEY))[IMPORT_DONE_KEY];
}

export async function resetImport() {
  await chrome.storage.local.remove([IMPORT_DONE_KEY, IMPORT_PROGRESS_KEY]);
}

async function setProgress(phase, detail, current, total) {
  await chrome.storage.local.set({
    [IMPORT_PROGRESS_KEY]: { phase, detail, current: current || 0, total: total || 0, t: Date.now() },
  });
}

export async function runImport() {
  const config = getConfig();
  if (!config.enabled || !config.webhookUrl) {
    return { success: false, reason: 'not_configured' };
  }

  console.log('[StarkChrome] Starting full history import...');

  try {
    // Phase 1: Pull ALL history from last 90 days
    await setProgress('history', 'Fetching full 90-day history...');
    const history = await fetchFullHistory();
    console.log(`[StarkChrome] Fetched ${history.length} history entries`);

    // Phase 2: Pull all bookmarks
    await setProgress('bookmarks', 'Fetching bookmarks...');
    const bookmarks = await fetchBookmarks();
    console.log(`[StarkChrome] Fetched ${bookmarks.length} bookmarks`);

    // Phase 3: Send history in batches
    const totalBatches = Math.ceil(history.length / BATCH_SIZE);
    let sentBatches = 0;
    let failedBatches = 0;

    for (let i = 0; i < history.length; i += BATCH_SIZE) {
      const batch = history.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      await setProgress('sending', `Sending batch ${batchNum}/${totalBatches}...`, batchNum, totalBatches);

      const lines = batch.map(h => {
        const date = new Date(h.lastVisitTime).toISOString().slice(0, 10);
        const title = (h.title || '(untitled)').substring(0, 120);
        return `${date} | ${h.visitCount || 1}x | ${title} — ${sanitizeUrl(h.url)}`;
      });

      const message = [
        `[StarkChrome History Import] Batch ${batchNum}/${totalBatches}`,
        ``,
        ...lines,
      ].join('\n');

      const result = await postToAgent(message, 'next-heartbeat', {
        sessionKey: 'starkchrome-import',
        name: 'StarkChrome Import',
      });

      if (result.success) {
        sentBatches++;
      } else {
        failedBatches++;
        console.error(`[StarkChrome] Batch ${batchNum} failed: ${result.reason}`);
      }

      // Delay between batches to avoid overwhelming
      if (i + BATCH_SIZE < history.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Phase 4: Send bookmarks
    if (bookmarks.length > 0) {
      await setProgress('sending', 'Sending bookmarks...');
      const bookmarkMessage = buildBookmarkMessage(bookmarks);
      await postToAgent(bookmarkMessage, 'next-heartbeat', {
        sessionKey: 'starkchrome-import',
        name: 'StarkChrome Import',
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    // Phase 5: Send completion signal to main session
    await postToAgent(
      `[StarkChrome History Import Complete] ${history.length} entries from 90 days sent in ${totalBatches} batches. Plus ${bookmarks.length} bookmarks. Check the "starkchrome-import" session for full data.`,
      'now',
    );

    // Mark done
    const stats = {
      completedAt: new Date().toISOString(),
      historyCount: history.length,
      bookmarkCount: bookmarks.length,
      batchesSent: sentBatches,
      batchesFailed: failedBatches,
    };

    await chrome.storage.local.set({ [IMPORT_DONE_KEY]: stats });
    await setProgress('done', `Import complete! ${history.length} entries, ${bookmarks.length} bookmarks.`);

    console.log('[StarkChrome] History import complete:', stats);
    return { success: true, stats };
  } catch (e) {
    console.error('[StarkChrome] Import failed:', e);
    await setProgress('error', e.message);
    return { success: false, reason: e.message };
  }
}

// Pull ALL history from last 90 days — no limits
async function fetchFullHistory() {
  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

  const items = await chrome.history.search({
    text: '',
    startTime: ninetyDaysAgo,
    maxResults: 100000,
  });

  // Filter through privacy settings and sort by date (newest first)
  return items
    .filter(i => shouldTrack(i.url))
    .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
}

// Pull all bookmarks (recursive tree walk)
async function fetchBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const flat = [];
  function walk(nodes, path = '') {
    for (const node of nodes) {
      if (node.url) flat.push({ title: node.title, url: node.url, folder: path });
      if (node.children) walk(node.children, path ? `${path} / ${node.title}` : node.title);
    }
  }
  walk(tree);
  return flat;
}

function buildBookmarkMessage(bookmarks) {
  const byFolder = {};
  for (const bm of bookmarks) {
    const folder = bm.folder || 'Unfiled';
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(bm);
  }

  const lines = [`[StarkChrome History Import] Bookmarks (${bookmarks.length})`, ''];

  for (const [folder, items] of Object.entries(byFolder)) {
    lines.push(`Folder: ${folder}`);
    for (const bm of items) {
      lines.push(`  - ${bm.title || '(untitled)'} — ${sanitizeUrl(bm.url)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function getImportStatus() {
  const [done, progress] = await Promise.all([
    chrome.storage.local.get(IMPORT_DONE_KEY),
    chrome.storage.local.get(IMPORT_PROGRESS_KEY),
  ]);
  return {
    done: !!done[IMPORT_DONE_KEY],
    importData: done[IMPORT_DONE_KEY] || null,
    progress: progress[IMPORT_PROGRESS_KEY] || null,
  };
}
