# CoverCraft

**AI cover letters in 60 seconds. No login. No subscription. Just results.**

You're applying to 100 jobs. Each cover letter takes 20 minutes. That's 33 hours of writing. CoverCraft does it in 60 seconds — click the extension on any job posting, get a tailored cover letter, download as a professionally typeset PDF.

## How it works

1. Install the Chrome extension
2. Upload your resume once (it stays on your device — we never see it)
3. Navigate to any job posting
4. Click CoverCraft → get a tailored cover letter → download as PDF

That's it. No account. No signup. No subscription.

## What makes it different

- **Zero friction** — no login, no onboarding flow, no email verification
- **Actually reads the page** — scrapes the real job description, doesn't ask you to paste it
- **LaTeX-quality PDFs** — professional typesetting, not a janky text dump
- **Powered by Claude** — better writing quality than GPT-based competitors
- **Privacy-first** — resume stored locally, never on our servers

## Supported job boards

- LinkedIn
- Greenhouse
- Lever
- Workday
- Any other website (intelligent fallback)

## Development

### Prerequisites
- Chrome 120+
- Node.js 18+ (for Cloudflare Worker only)

### Setup

```
git clone [repo]
cd covercraft-ext
```

#### Load the extension
1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and select the `covercraft-ext/` folder
4. Click the CoverCraft icon on any job page

#### Deploy the API proxy
```
cd proxy
npx wrangler login
npx wrangler kv:namespace create RATE_LIMITS
# Update wrangler.toml with the namespace ID
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Then update `PROXY_URL` in `background/service-worker.js` with your deployed worker URL.

### Architecture

```
User clicks extension
  → popup checks for resume (chrome.storage.local)
  → service worker injects content script into active tab
  → scraper uses heuristic DOM analysis (not CSS selectors)
  → popup shows job data + tone/length preferences
  → user clicks Generate
  → Claude API returns LaTeX source (streamed)
  → Cloudflare Worker compiles LaTeX → PDF
  → user downloads CoverLetter_Company_Title.pdf
```

## Privacy

- Your resume is stored in Chrome's local storage on YOUR device
- Resume + job description are sent to Claude API only during generation
- The proxy exists only to protect the API key — it does not store or log any data
- No analytics, no tracking pixels, no cookies, no third-party scripts
- Delete all data anytime from extension settings

## Tech stack

- Vanilla JavaScript (no framework, no build step, instant loading)
- Chrome Extension Manifest V3
- Claude API (Sonnet 4) for generation
- LaTeX for professional PDF typesetting
- Cloudflare Workers for API proxy + LaTeX compilation

## Roadmap

- [ ] Chrome Web Store listing
- [ ] Firefox port
- [ ] BYOK (bring your own API key) mode
- [ ] Multiple resume profiles
- [ ] Cover letter history
- [ ] Custom tone with example text
- [ ] One-click apply integrations

## License

MIT
