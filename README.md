# Cursor Model Pricing Chrome Extension

A lightweight Chrome extension (Manifest V3) that injects real-time Input / Output token pricing directly into the Cursor web model selector dropdown.

---

## Features

- **Live Pricing Badges:** Displays `Input / Output` prices per 1M tokens next to each model name.
- **Auto-Sync:** Periodically fetches and parses the latest pricing tables directly from the official Cursor documentation (`https://cursor.com/docs/models-and-pricing.md`).
- **Offline Fallbacks & Caching:** Uses `chrome.storage.local` with a 24-hour cache TTL; seamlessly falls back to bundled static prices if offline or if network requests fail.
- **Native UI Integration:** Automatically expands Cursor's hardcoded dropdown width and right-aligns prices cleanly before action buttons without breaking native menus.

---

## Project Structure

```text
cursor-pricing-extension/
├── manifest.json   # Extension metadata and permissions (MV3)
├── content.js      # MutationObserver, markdown parser, and badge injector
├── style.css       # Layout overrides and badge styling
└── README.md