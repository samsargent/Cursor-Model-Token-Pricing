const PRICING_URL = "https://cursor.com/docs/models-and-pricing.md";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Refresh daily

// Fallback pricing if docs cannot be reached
const FALLBACK_PRICES = {
  "claude-sonnet-5-5": { in: "$3.00", out: "$15.00" },
  "claude-opus-5-5":   { in: "$15.00", out: "$75.00" },
  "claude-fable-5-1":  { in: "$3.00", out: "$15.00" },
  "gpt-5.6-sol":       { in: "$2.50", out: "$10.00" },
  "gemini-4-argon":    { in: "$1.25", out: "$5.00" },
  "grok-4.7":          { in: "$2.00", out: "$6.00" },
  "grok-4.6":          { in: "$2.00", out: "$6.00" },
  "composer-2.5":      { in: "$0.50", out: "$2.50" },
  "muse-wonder-1.0":   { in: "$1.50", out: "$6.00" }
};

let activePrices = { ...FALLBACK_PRICES };

/**
 * Normalizes model display names to match data-model-picker-item-name slugs.
 * E.g., "Claude Sonnet 5.5" -> "claude-sonnet-5-5"
 */
function normalizeModelSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parses markdown table rows into { [slug]: { in, out } }
 */
function parsePricingMarkdown(markdownText) {
  const prices = {};
  const lines = markdownText.split("\n");

  for (const line of lines) {
    if (!line.includes("|") || line.includes("---")) continue;

    const cells = line
      .split("|")
      .map(c => c.trim())
      .filter(Boolean);

    // Checks tables structured as: | Model Name | ... | Input Price | Output Price |
    if (cells.length >= 3) {
      const rawName = cells[0];
      const pricesInRow = cells.filter(c => /^\$\d+(\.\d+)?/.test(c));

      if (pricesInRow.length >= 2) {
        const slug = normalizeModelSlug(rawName);
        const inPrice = pricesInRow[0];
        const outPrice = pricesInRow[pricesInRow.length - 1];

        prices[slug] = { in: inPrice, out: outPrice };
      }
    }
  }
  return prices;
}

/**
 * Loads cached prices or fetches the latest documentation markdown
 */
async function syncPricing() {
  try {
    const cached = await chrome.storage.local.get(["cursor_prices", "last_updated"]);
    const isStale = !cached.last_updated || (Date.now() - cached.last_updated > CACHE_TTL_MS);

    if (cached.cursor_prices && !isStale) {
      activePrices = { ...FALLBACK_PRICES, ...cached.cursor_prices };
      return;
    }

    const response = await fetch(PRICING_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const markdown = await response.text();
    const livePrices = parsePricingMarkdown(markdown);

    activePrices = { ...FALLBACK_PRICES, ...livePrices };

    await chrome.storage.local.set({
      cursor_prices: livePrices,
      last_updated: Date.now()
    });
  } catch (err) {
    console.warn("[Cursor Token Pricing] Using fallback prices due to sync error:", err);
  }
}

/**
 * Injects right-aligned pricing badges into the model row flex container
 */
function processModelItem(nameNode) {
  if (nameNode.dataset.pricingInjected) return;

  const modelKey = nameNode.getAttribute("data-model-picker-item-name");
  const price = activePrices[modelKey];
  if (!price) return;

  // Locate the parent row flex container holding the name and status tags
  const flexContainer = nameNode.closest(".ui-model-picker__item-content");
  if (!flexContainer) return;

  const badge = document.createElement("span");
  badge.className = "cursor-token-pricing-badge";
  badge.textContent = `${price.in} / ${price.out}`;
  badge.title = `Input: ${price.in} | Output: ${price.out} (per 1M tokens)`;

  flexContainer.appendChild(badge);
  nameNode.dataset.pricingInjected = "true";
}

function scanAndInject() {
  const modelElements = document.querySelectorAll(
    '[data-model-picker-item-name]:not([data-pricing-injected])'
  );
  modelElements.forEach(processModelItem);
}

// Initialize
(async () => {
  await syncPricing();

  const observer = new MutationObserver(() => scanAndInject());
  observer.observe(document.body, { childList: true, subtree: true });

  scanAndInject();
})();