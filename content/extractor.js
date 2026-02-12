// StarkChrome v2 — Page Content Extractor
// Extracts readable text from pages (like Reader Mode).
// Only runs when requested by the background service worker.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'extract_content') return;
  const content = extractReadableContent();
  sendResponse(content);
  return true;
});

function extractReadableContent() {
  // Noise elements to remove
  const removeSelectors = [
    'nav', 'header', 'footer', 'aside', '.sidebar', '.nav',
    '.menu', '.ad', '.advertisement', '.social-share',
    '.comments', '.related', '#comments', '.cookie-banner',
    '.popup', '.modal', '.overlay', '.banner', '.promo',
    'script', 'style', 'noscript', 'iframe', 'svg',
  ];

  // Clone body to avoid modifying the actual page
  const clone = document.body.cloneNode(true);
  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  // Try to find main content area (most specific first)
  const mainContent = clone.querySelector('article')
    || clone.querySelector('[role="main"]')
    || clone.querySelector('main')
    || clone.querySelector('.post-content')
    || clone.querySelector('.article-content')
    || clone.querySelector('.entry-content')
    || clone.querySelector('.content')
    || clone.querySelector('#content')
    || clone;

  // Get text content, clean up whitespace
  let text = mainContent.innerText || mainContent.textContent || '';
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // Get metadata
  const meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content
      || '',
    author: document.querySelector('meta[name="author"]')?.content || '',
    publishDate: document.querySelector('meta[property="article:published_time"]')?.content
      || document.querySelector('time[datetime]')?.getAttribute('datetime')
      || '',
    url: window.location.href,
    domain: window.location.hostname,
  };

  return {
    meta,
    text: text.slice(0, 5000),  // Cap at 5000 chars
    wordCount: text.split(/\s+/).filter(Boolean).length,
    extractedAt: Date.now(),
  };
}
