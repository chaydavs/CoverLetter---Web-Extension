# Pave Privacy Policy

**Last updated: March 28, 2026**

Pave is built with privacy as a core design principle. Here's exactly what happens with your data — no legal jargon, just plain English.

## What data we collect

### Your resume
- Stored **locally** in your browser's storage (Chrome's `chrome.storage.local`)
- **Never** sent to our servers for storage
- Only transmitted to generate a cover letter (see below)

### Job descriptions
- Scraped from the page you're viewing when you click the extension
- Sent to our API proxy along with your resume **only** when you click "Generate"
- **Not** stored anywhere after the request completes

## Where data is sent

When you click "Generate Cover Letter," your resume text and the scraped job description are sent to:

1. **Our Cloudflare Worker proxy** — a thin relay that hides our API key. It validates your request, forwards it to Claude, and streams the response back. It does **not** log, store, or inspect your resume or job data.

2. **Anthropic's Claude API** — the AI that writes your cover letter. Anthropic's data usage policy applies to this request. Per their policy, API inputs are not used to train models.

That's it. Two hops. No databases, no analytics services, no third parties beyond these two.

## What we don't do

- We **don't** have user accounts, so we can't identify you
- We **don't** run analytics, tracking pixels, or cookies
- We **don't** store your resume on any server
- We **don't** log API request bodies (including your resume)
- We **don't** sell, share, or monetize your data in any way
- We **don't** load external scripts, fonts, or resources at runtime

## BYOK (Bring Your Own Key) mode

If you use your own Anthropic API key, requests go **directly** to Anthropic's API — our proxy is bypassed entirely. Your key is stored locally in your browser with basic obfuscation (not encryption). We recommend using `chrome.storage.session` for ephemeral storage if security is a concern.

## How to delete your data

1. Open the Pave extension
2. Click the gear icon (Settings)
3. Click "Clear All Data"

This removes your resume, preferences, and API key from your browser. There's nothing to delete on our servers because we never stored anything there.

## Third-party services

| Service | What it does | Their privacy policy |
|---------|-------------|---------------------|
| Anthropic (Claude API) | Generates cover letter text | [anthropic.com/privacy](https://www.anthropic.com/privacy) |
| Cloudflare Workers | Hosts our API proxy and LaTeX compiler | [cloudflare.com/privacypolicy](https://www.cloudflare.com/privacypolicy/) |

## Changes to this policy

If we change this policy, we'll update the date at the top. For a Chrome extension with no user accounts, there's no way to notify you directly — check back here if you're concerned.

## Contact

For privacy questions: [your-email@example.com]
