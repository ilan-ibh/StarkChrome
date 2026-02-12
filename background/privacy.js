// StarkChrome v2 — Privacy Filter & URL Sanitization

let cachedSettings = null;

const DEFAULT_SETTINGS = {
  enabled: true,
  trackIncognito: false,
  domainBlocklist: ['bank', 'chase.com', 'wellsfargo.com', 'bankofamerica.com', 'paypal.com', 'venmo.com', 'health', 'patient', 'medical', 'pharmacy'],
};

const INTERNAL_PATTERNS = [/^chrome:\/\//, /^chrome-extension:\/\//, /^about:/, /^edge:\/\//, /^brave:\/\//];

export async function loadPrivacySettings() {
  try {
    const result = await chrome.storage.local.get('privacy');
    cachedSettings = { ...DEFAULT_SETTINGS, ...result.privacy };
  } catch (e) {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings;
}

export async function savePrivacySettings(settings) {
  cachedSettings = { ...DEFAULT_SETTINGS, ...settings };
  await chrome.storage.local.set({ privacy: cachedSettings });
  return cachedSettings;
}

export function getPrivacySettings() {
  return cachedSettings || DEFAULT_SETTINGS;
}

// Should this URL be tracked at all?
export function shouldTrack(url) {
  const settings = getPrivacySettings();
  if (!settings.enabled) return false;
  if (!url) return false;

  // Never track internal browser pages
  for (const pattern of INTERNAL_PATTERNS) {
    if (pattern.test(url)) return false;
  }

  // Check domain blocklist
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const term of settings.domainBlocklist) {
      if (term && hostname.includes(term.toLowerCase().trim())) return false;
    }
  } catch (e) {
    // Invalid URL — allow tracking (will be filtered elsewhere)
  }

  return true;
}

// Sanitize a URL for storage:
// - Strip query params (removes tokens, session IDs, tracking params)
// - KEEP search queries (?q=, ?query=, ?search=) for research tracking
// - Never store full URLs for blocklisted domains
export function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);

    // Keep search queries
    const searchParams = new URLSearchParams();
    const keepParams = ['q', 'query', 'search', 'search_query', 'tbm', 'type'];
    for (const key of keepParams) {
      if (u.searchParams.has(key)) {
        searchParams.set(key, u.searchParams.get(key));
      }
    }

    const cleanSearch = searchParams.toString();
    return `${u.origin}${u.pathname}${cleanSearch ? '?' + cleanSearch : ''}`;
  } catch (e) {
    return url;
  }
}

// Extract domain from URL
export function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.privacy) {
    cachedSettings = changes.privacy.newValue;
  }
});
