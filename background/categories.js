// StarkChrome v2 — Site Categorization Engine
// Categorizes domains locally using simple domain matching.

const CATEGORIES = {
  dev: ['github.com', 'gitlab.com', 'stackoverflow.com', 'stackexchange.com', 'localhost', 'vercel.com', 'netlify.com', 'supabase.com', 'aws.amazon.com', 'console.cloud.google.com', 'azure.com', 'digitalocean.com', 'heroku.com', 'railway.app', 'render.com', 'fly.io', 'npmjs.com', 'pypi.org', 'crates.io', 'pkg.go.dev', 'docker.com', 'hub.docker.com', 'codepen.io', 'replit.com', 'codesandbox.io', 'developer.mozilla.org', 'devdocs.io', 'w3schools.com'],
  ai: ['claude.ai', 'chat.openai.com', 'platform.openai.com', 'perplexity.ai', 'aistudio.google.com', 'huggingface.co', 'replicate.com', 'midjourney.com', 'cursor.com', 'copilot.github.com', 'kaggle.com', 'colab.research.google.com', 'together.ai', 'groq.com', 'openclaw.ai'],
  social: ['twitter.com', 'x.com', 'reddit.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'threads.net', 'mastodon.social', 'bsky.app', 'tiktok.com'],
  news: ['techcrunch.com', 'theverge.com', 'arstechnica.com', 'news.ycombinator.com', 'bbc.com', 'reuters.com', 'nytimes.com', 'wired.com', 'cnn.com', 'apnews.com'],
  video: ['youtube.com', 'twitch.tv', 'vimeo.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'spotify.com'],
  shopping: ['amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com', 'bestbuy.com', 'aliexpress.com', 'shopify.com'],
  email: ['mail.google.com', 'outlook.com', 'outlook.live.com', 'protonmail.com', 'yahoo.com'],
  finance: ['coinmarketcap.com', 'tradingview.com', 'app.hyperliquid.xyz', 'coinbase.com', 'binance.com', 'robinhood.com', 'fidelity.com', 'schwab.com'],
  docs: ['docs.google.com', 'notion.so', 'confluence.atlassian.com', 'coda.io', 'airtable.com', 'figma.com', 'miro.com', 'linear.app', 'trello.com', 'asana.com', 'clickup.com'],
  education: ['wikipedia.org', 'medium.com', 'substack.com', 'udemy.com', 'coursera.org', 'edx.org', 'khanacademy.org', 'arxiv.org', 'scholar.google.com'],
  communication: ['slack.com', 'discord.com', 'teams.microsoft.com', 'zoom.us', 'meet.google.com', 'telegram.org', 'web.whatsapp.com', 'signal.org', 'messages.google.com'],
};

// Categorize a domain
export function categorize(domain) {
  if (!domain) return 'other';
  const d = domain.toLowerCase();
  for (const [category, domains] of Object.entries(CATEGORIES)) {
    for (const pattern of domains) {
      if (d === pattern || d.endsWith('.' + pattern) || d.includes(pattern)) {
        return category;
      }
    }
  }
  return 'other';
}

// Get human-readable category label
const LABELS = {
  dev: 'Development',
  ai: 'AI & ML',
  social: 'Social Media',
  news: 'News & Media',
  video: 'Video & Streaming',
  shopping: 'Shopping',
  email: 'Email',
  finance: 'Finance & Crypto',
  docs: 'Docs & Productivity',
  education: 'Education & Research',
  communication: 'Communication',
  other: 'Other',
};

export function categoryLabel(cat) {
  return LABELS[cat] || 'Other';
}

// Get the emoji for a category
const EMOJI = {
  dev: '💻', ai: '🤖', social: '💬', news: '📰', video: '🎬',
  shopping: '🛒', email: '📧', finance: '💰', docs: '📄',
  education: '📚', communication: '📱', other: '🌐',
};

export function categoryEmoji(cat) {
  return EMOJI[cat] || '🌐';
}

export function getAllCategories() {
  return Object.keys(CATEGORIES);
}
