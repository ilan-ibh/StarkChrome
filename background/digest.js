// StarkChrome v2 — Daily Digest Builder & Scheduler
// Builds a human-readable summary of the day's browsing activity.
// Runs locally in the extension — no LLM needed to build it.
// Sends once per day to OpenClaw via webhook.

import { getEventsForDay, getDomainStats, getPageContent } from './store.js';
import { getPageTimes, formatDuration, getTotalActiveTime, resetPageTimes } from './tracker.js';
import { categoryLabel, categoryEmoji, categorize } from './categories.js';
import { sendDigest, getConfig } from './api.js';
import { postToLogger, isLoggerConfigured } from './logger.js';

const DIGEST_ALARM = 'starkchrome-daily-digest';
const LAST_DIGEST_KEY = 'lastDigestDate';

// Setup the daily digest alarm based on user-configured time
export function scheduleDigest() {
  const config = getConfig();
  const [hours, minutes] = (config.digestTime || '20:00').split(':').map(Number);

  // Calculate next fire time
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

  // If the time already passed today, schedule for tomorrow
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  const delayMinutes = (next.getTime() - now.getTime()) / 60000;

  chrome.alarms.create(DIGEST_ALARM, {
    delayInMinutes: delayMinutes,
    periodInMinutes: 24 * 60, // Repeat every 24 hours
  });

  console.log(`[StarkChrome] Digest scheduled for ${next.toLocaleString()} (${Math.round(delayMinutes)}min from now)`);
}

// Handle alarm — build and send digest
export async function handleDigestAlarm(alarm) {
  if (alarm.name !== DIGEST_ALARM) return false;

  console.log('[StarkChrome] Digest alarm fired');
  await buildAndSendDigest();
  return true;
}

// Build and send the daily digest
export async function buildAndSendDigest(targetDate) {
  const date = targetDate || new Date();
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  // Check if we already sent a digest for this date
  const lastDigest = (await chrome.storage.local.get(LAST_DIGEST_KEY))[LAST_DIGEST_KEY];
  const todayKey = date.toISOString().split('T')[0];
  if (lastDigest === todayKey && !targetDate) {
    console.log('[StarkChrome] Digest already sent for today');
    return { success: false, reason: 'already_sent' };
  }

  // Gather data
  const events = getEventsForDay(date);
  if (events.length === 0) {
    console.log('[StarkChrome] No events for digest');
    return { success: false, reason: 'no_events' };
  }

  const domainStats = getDomainStats(events);
  const pageTimes = getPageTimes();
  const totalActive = getTotalActiveTime();
  const pageContents = await getPageContent(todayKey);

  // Build the digest message
  const message = formatDigest(dateStr, events, domainStats, pageTimes, totalActive, pageContents);

  // Dual delivery: webhook (agent) + logger (markdown files)
  const results = { webhook: null, logger: null };

  // 1. Send to OpenClaw webhook
  results.webhook = await sendDigest(message);

  // 2. Send to logger endpoint (for file persistence)
  if (isLoggerConfigured()) {
    results.logger = await postToLogger({
      type: 'daily.digest',
      timestamp: Date.now(),
      data: {
        date: todayKey,
        message,
        eventCount: events.length,
        domainCount: Object.keys(domainStats).length,
        pageContentCount: pageContents?.length || 0,
      },
    });
    console.log('[StarkChrome] Digest sent to logger:', results.logger.success ? 'OK' : 'failed');
  }

  // Mark as sent if either endpoint succeeded
  if (results.webhook?.success || results.logger?.success) {
    await chrome.storage.local.set({ [LAST_DIGEST_KEY]: todayKey });
    resetPageTimes();
  }

  return results.webhook || results.logger || { success: false, reason: 'no_endpoint' };
}

// Format the digest as plain text
function formatDigest(dateStr, events, domainStats, pageTimes, totalActiveMs, pageContents) {
  const lines = [];

  lines.push(`[StarkChrome Daily Digest] ${dateStr}`);
  lines.push('');

  // Active time
  const activeStr = totalActiveMs > 0 ? formatDuration(totalActiveMs) : estimateActiveTime(events);
  lines.push(`Browsing Summary (${activeStr} active):`);
  lines.push('');

  // Top sites by visits (with time if available)
  const sortedDomains = Object.entries(domainStats)
    .sort((a, b) => b[1].visits - a[1].visits)
    .slice(0, 15);

  if (sortedDomains.length > 0) {
    lines.push('Top Sites:');
    for (const [domain, stats] of sortedDomains) {
      const timeEntry = pageTimes.find(t => t.domain === domain);
      const timeStr = timeEntry ? `, ~${formatDuration(timeEntry.totalMs)}` : '';
      lines.push(`- ${domain} (${stats.visits} visits${timeStr})`);
    }
    lines.push('');
  }

  // Research topics — group by category
  const byCategory = {};
  for (const [domain, stats] of Object.entries(domainStats)) {
    const cat = stats.cat || categorize(domain);
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ domain, ...stats });
  }

  // Show interesting categories (skip 'other' if there are named ones)
  const interestingCats = Object.entries(byCategory)
    .filter(([cat]) => cat !== 'other' && cat !== 'email')
    .sort((a, b) => b[1].reduce((s, d) => s + d.visits, 0) - a[1].reduce((s, d) => s + d.visits, 0));

  if (interestingCats.length > 0) {
    lines.push('Activity by Category:');
    for (const [cat, domains] of interestingCats) {
      const totalVisits = domains.reduce((s, d) => s + d.visits, 0);
      const topDomains = domains.sort((a, b) => b.visits - a.visits).slice(0, 5);
      const domainList = topDomains.map(d => d.domain).join(', ');
      lines.push(`- ${categoryEmoji(cat)} ${categoryLabel(cat)}: ${domainList} (${totalVisits} visits)`);
    }
    lines.push('');
  }

  // Bookmarks saved today
  const bookmarks = events.filter(e => e.type === 'bookmark.created');
  if (bookmarks.length > 0) {
    lines.push('Bookmarked:');
    for (const b of bookmarks) {
      lines.push(`- "${b.data?.title || b.title}" — ${b.data?.url || b.url}`);
    }
    lines.push('');
  }

  // Downloads today
  const downloads = events.filter(e => e.type === 'download.completed');
  if (downloads.length > 0) {
    lines.push('Downloads:');
    for (const d of downloads) {
      const size = d.data?.fileSize ? ` (${(d.data.fileSize / 1024 / 1024).toFixed(1)}MB)` : '';
      lines.push(`- ${d.data?.filename || 'unknown'} (${d.data?.mime || 'unknown'})${size}`);
    }
    lines.push('');
  }

  // Page content — what the user actually read
  if (pageContents && pageContents.length > 0) {
    const topPages = pageContents
      .sort((a, b) => b.timeSpent - a.timeSpent)
      .slice(0, 20);

    lines.push('Page Content (what you actually read):');
    for (const page of topPages) {
      const mins = Math.round(page.timeSpent / 60000);
      lines.push('');
      lines.push(`--- ${page.title || '(untitled)'} (${mins} min) ---`);
      lines.push(`URL: ${page.url}`);
      if (page.meta?.author) lines.push(`Author: ${page.meta.author}`);
      if (page.meta?.publishDate) lines.push(`Published: ${page.meta.publishDate}`);
      lines.push('');
      lines.push(page.content || '');
    }
    lines.push('');
  }

  // Activity pattern
  const hourBuckets = new Array(24).fill(0);
  for (const e of events) {
    const hour = new Date(e.t).getHours();
    hourBuckets[hour]++;
  }

  const activeHours = hourBuckets
    .map((count, hour) => ({ hour, count }))
    .filter(h => h.count > 2)
    .sort((a, b) => b.count - a.count);

  if (activeHours.length > 0) {
    const peakHours = activeHours.slice(0, 3).map(h => formatHour(h.hour)).join(', ');
    const tabEvents = events.filter(e => e.type === 'navigation' || e.type === 'tab.activated');
    lines.push('Activity Pattern:');
    lines.push(`- Most active hours: ${peakHours}`);
    lines.push(`- Total page loads: ${tabEvents.length}`);

    // Comebacks
    const comebacks = events.filter(e => e.type === 'user.comeback');
    if (comebacks.length > 0) {
      lines.push(`- Returned from breaks: ${comebacks.length}x`);
    }
  }

  return lines.join('\n');
}

function formatHour(hour) {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

function estimateActiveTime(events) {
  if (events.length < 2) return 'minimal';
  const first = events[0].t;
  const last = events[events.length - 1].t;
  return formatDuration(last - first);
}
