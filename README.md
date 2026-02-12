# StarkChrome

A Chrome extension that gives your AI agent awareness of your browsing activity.

Smart local processing. Daily digests. Rare webhook calls. **~$0.15/day instead of $15/day.**

Built for [OpenClaw](https://github.com/openclaw/openclaw) but works with any agent that accepts HTTP webhooks.

---

## How It Works

```
You browse the web normally
         |
   StarkChrome silently records everything locally
         |
         +---> 8pm: Daily digest sent to your agent
         |         (top sites, time spent, categories, page content)
         |
         +---> Bookmark saved? Instant notification
         +---> Download completed? Instant notification
         +---> Back after 30+ min away? "I'm back" signal
         |
         +---> Cmd+Shift+S: Send current page to agent on demand
```

**Everything stays on your machine** except the daily digest and 3-4 high-value events per day. Your agent gets the full picture without burning money on every tab switch.

## What Your Agent Receives

### Daily Digest (once per day, ~$0.05)

```
[StarkChrome Daily Digest] Wednesday, Feb 12, 2026

Browsing Summary (6.2h active):

Top Sites:
- github.com (47 visits, ~2.1h)
- claude.ai (18 visits, ~45min)
- news.ycombinator.com (12 visits, ~30min)

Activity by Category:
- 💻 Development: github.com, stackoverflow.com (62 visits)
- 🤖 AI & ML: claude.ai, huggingface.co (24 visits)
- 📰 News: news.ycombinator.com, techcrunch.com (18 visits)

Bookmarked:
- "Cognition: Don't Build Multi-Agents" — https://cognition.ai/blog/...

Downloads:
- robotics-paper.pdf (application/pdf)

Page Content (what you actually read):

--- TechCrunch: OpenAI enters robotics (12 min) ---
URL: https://techcrunch.com/2026/02/12/...
Author: Devin Coldewey

OpenAI announced today the opening of a dedicated robotics
research laboratory in San Francisco...
[up to 2000 chars of article text per page]
```

### High-Value Events (immediate, ~$0.10/day total)

```
[StarkChrome] Bookmarked: "NVIDIA Isaac Sim" — https://developer.nvidia.com/isaac-sim
[StarkChrome] Downloaded: dataset.csv (text/csv) from https://kaggle.com/...
[StarkChrome] User returned after 47 minutes away. Currently on: github.com
```

### Full History Import (one-time, on first connect)

Sends your full 90-day Chrome browsing history in batches — every page visited with timestamps and visit counts. Gives your agent deep context about who you are and what you work on.

## Install

### 1. Load the Extension

1. Clone this repo or download it
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `StarkChrome` folder

### 2. Configure

1. Click the StarkChrome icon → **Settings**
2. Enter your webhook URL and API token
3. Check **Enable connection**
4. Click **Save All Settings**
5. Click **Test Connection** → should say `Connected! (202)`

### 3. Done

StarkChrome auto-imports your history on first connection and starts tracking. Daily digest fires at 8pm (configurable).

## Configuration

| Setting | Default | Description |
|---|---|---|
| **Webhook URL** | — | Your agent's webhook endpoint (e.g., `https://your-server.com/hooks/agent`) |
| **API Token** | — | Bearer token for authentication |
| **Daily digest time** | 20:00 | When to send the daily summary |
| **Send bookmarks** | On | Instant notification when you bookmark a page |
| **Send downloads** | On | Instant notification when a download completes |
| **Send comeback alerts** | On | Notification when you return after 30+ min idle |
| **Track incognito** | Off | Whether to track incognito windows |
| **Domain blocklist** | banking, medical | URLs containing these terms are never tracked |
| **Retention** | 90 days | How long to keep local event history |

## Features

### Page Content Extraction

When you spend 30+ seconds on a page, StarkChrome extracts the readable text (like Reader Mode — strips nav, ads, sidebars). This content appears in your daily digest so your agent knows *what* you read, not just *where* you went.

### "Send to Stark"

Two ways to send the current page to your agent immediately:

- **Cmd+Shift+S** (Mac) / **Ctrl+Shift+S** (Windows/Linux)
- **Right-click → Send to Stark**

Sends the full page text (up to 5000 chars) with a green badge flash confirmation.

### Site Categorization

Every domain is automatically categorized:

| Category | Examples |
|---|---|
| Development | github.com, stackoverflow.com, localhost |
| AI & ML | claude.ai, huggingface.co, openai.com |
| Social | twitter.com, reddit.com, linkedin.com |
| News | techcrunch.com, news.ycombinator.com |
| Video | youtube.com, twitch.tv |
| Finance | coinmarketcap.com, tradingview.com |
| Docs | notion.so, docs.google.com, figma.com |
| Communication | slack.com, discord.com |
| Education | wikipedia.org, arxiv.org, medium.com |

### Time-on-Page Tracking

Tracks how long you spend on each page using tab switch deltas:
- Ignores bounces (<3 seconds)
- Caps at 30 minutes (assumes you walked away)
- Results appear in the daily digest as "github.com (~2.1h)"

### History Import

On first connection, sends your full 90-day Chrome history in batches:
- Every page visited with date, visit count, title, and URL
- Batches of 500 entries with `wakeMode: next-heartbeat` (cheap)
- Uses a separate session (`starkchrome-import`) to avoid flooding your main conversation
- All bookmarks organized by folder
- Re-importable anytime from the popup

## Privacy

- **All data stored locally** in `chrome.storage.local` — never synced to Chrome cloud
- **Domain blocklist** with sensible defaults (banking, medical)
- **Incognito off by default** — must be explicitly enabled
- **URL sanitization** — query parameters stripped before storage (removes tokens, tracking params). Search queries (`?q=`) are preserved for research tracking
- **No data sent until you explicitly configure and enable** the connection
- **Clear All Data** button actually clears everything

## Webhook Format

StarkChrome works with any endpoint that accepts this POST:

```json
POST /your-endpoint
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Plain text message",
  "sessionKey": "starkchrome",
  "name": "StarkChrome",
  "wakeMode": "now",
  "deliver": false
}
```

The `message` field is plain text. Your agent reads it and decides what to do. Works with OpenClaw, custom servers, Zapier webhooks, n8n, or anything that accepts HTTP POST.

## Architecture

```
StarkChrome/
├── manifest.json                    # MV3, 8 permissions
├── background/
│   ├── service-worker.js            # Orchestrator, alarms, Cmd+Shift+S, context menu
│   ├── store.js                     # Local event store (90-day rolling, page content)
│   ├── tracker.js                   # Time-on-page + content extraction trigger
│   ├── categories.js                # Domain categorizer (12 categories)
│   ├── digest.js                    # Daily digest builder + scheduler
│   ├── api.js                       # Single webhook client
│   ├── privacy.js                   # URL sanitization, domain blocklist
│   ├── history-import.js            # Full 90-day import in batches
│   └── events/
│       ├── tabs.js                  # Navigation + tab switches → store
│       ├── bookmarks.js             # Bookmark created → store + webhook
│       ├── downloads.js             # Download completed → store + webhook
│       └── idle.js                  # Idle/comeback detection → store + webhook
├── content/
│   └── extractor.js                 # Reader-mode page text extraction
├── popup/                           # Status dashboard
└── options/                         # Settings page
```

## Cost Comparison

| | Naive approach | StarkChrome |
|---|---|---|
| Webhook calls/day | ~2,000-5,000 | ~5-8 |
| LLM cost/day | $5-15 | $0.15-0.30 |
| Extra servers needed | Logger server + tunnel | None |
| Data the agent gets | Raw event spam | Curated digest + page content |

## Badge States

| Badge | Meaning |
|---|---|
| 🟢 **ON** | Connected, tracking active |
| 🟡 **!** | Not configured or connection error |
| 🔴 **OFF** | Tracking disabled |
| **OK** | Page sent to agent (Cmd+Shift+S) |

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Track page visits and tab switches |
| `history` | Read browsing history for import |
| `bookmarks` | Detect bookmark creation |
| `downloads` | Detect completed downloads |
| `idle` | Detect idle/active/locked states |
| `storage` | Local event storage (90-day rolling) |
| `alarms` | Schedule daily digest |
| `contextMenus` | Right-click "Send to Stark" menu |

## License

MIT
