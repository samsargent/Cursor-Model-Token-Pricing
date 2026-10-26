const PRICING_URL = "https://cursor.com/docs/models-and-pricing.md";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Refresh daily

// Fallback pricing
const FALLBACK_PRICES = {
  "claude-sonnet-5-5": { in: "$3.00", out: "$15.00" },
  "claude-opus-5-5":   { in: "$15.00", out: "$75.00" },
  "claude-fable-5-1":  { in: "$3.00", out: "$15.00" },
  "gpt-5.6-sol":       { in: "$2.50", out: "$10.00" },
  "gemini-4-argon":    { in: "$1.25", out: "$5.00" },
  "grok-4.7":          { in: "$2.00", out: "$6.00" },
  "grok-4.6":          { in: "$2.00", out: "$6.00" },
  "composer-2.5":      { in: "$0.50", out: "$2.50" },
  "composer-2.5-fast": { in: "$3.00", out: "$15.00" },
  "muse-wonder-1.0":   { in: "$1.50", out: "$6.00" }
};

let activePrices = { ...FALLBACK_PRICES };

function getModelSlug(rawName) {
  const isFast = /\bfast\b/i.test(rawName);
  const base = rawName
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .trim()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return isFast ? `${base}-fast` : base;
}

function parsePricingMarkdown(markdownText) {
  const prices = {};
  const lines = markdownText.split("\n");

  for (const line of lines) {
    if (!line.includes("|") || line.includes("---")) continue;

    const cells = line
      .split("|")
      .map(c => c.trim())
      .filter(Boolean);

    if (cells.length >= 3) {
      const rawName = cells[0];
      const pricesInRow = cells.filter(c => /^\$\d+(\.\d+)?/.test(c));

      if (pricesInRow.length >= 2) {
        const slug = getModelSlug(rawName);
        const inPrice = pricesInRow[0];
        const outPrice = pricesInRow[pricesInRow.length - 1];

        prices[slug] = { in: inPrice, out: outPrice };
      }
    }
  }
  return prices;
}

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
 * Returns a CSS class modifier depending on the tag type
 */
function getTagClass(token) {
  const t = token.toLowerCase();
  if (/^\d+[mk]$/i.test(t)) return "cursor-mod-context"; // e.g. 1M, 128k
  if (t === "high") return "cursor-mod-high";
  if (t === "medium") return "cursor-mod-medium";
  if (t === "low") return "cursor-mod-low";
  if (t === "fast") return "cursor-mod-speed";
  return "cursor-mod-generic";
}

/**
 * Restyles plain text modifiers into distinct pill badges
 */
function updateModifierTags(labelParagraph) {
  const nativeSpan = labelParagraph.querySelector('span[style*="--cursor-text-tertiary"]');
  const rawText = nativeSpan ? nativeSpan.textContent.trim() : "";

  let container = labelParagraph.querySelector(".cursor-mod-container");

  if (!rawText) {
    if (container) container.remove();
    return false;
  }

  // Hide the native unstyled text node without unmounting it (preserves React reconciliation)
  nativeSpan.style.display = "none";

  if (!container) {
    container = document.createElement("span");
    container.className = "cursor-mod-container";
    labelParagraph.appendChild(container);
  }

  // Rebuild chips only if the underlying tags have changed
  if (container.dataset.renderedText !== rawText) {
    container.innerHTML = "";
    const tokens = rawText.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const chip = document.createElement("span");
      chip.className = `cursor-mod-chip ${getTagClass(token)}`;
      chip.textContent = token;
      container.appendChild(chip);
    }
    container.dataset.renderedText = rawText;
  }

  return /\bfast\b/i.test(rawText);
}

/**
 * Injects pricing badges & updates modifier styling
 */
function processModelItem(nameNode) {
  const flexContainer = nameNode.closest(".ui-model-picker__item-content");
  if (!flexContainer) return;

  const modelKey = nameNode.getAttribute("data-model-picker-item-name");
  if (!modelKey) return;

  const labelParagraph = nameNode.querySelector(".ui-markdown__paragraph");
  const isFastSelected = labelParagraph ? updateModifierTags(labelParagraph) : false;

  // Select fast vs. standard pricing
  const targetKey = (isFastSelected && activePrices[`${modelKey}-fast`])
    ? `${modelKey}-fast`
    : modelKey;

  const price = activePrices[targetKey];
  if (!price) return;

  const priceText = `${price.in} / ${price.out}`;
  const titleText = `Input: ${price.in} | Output: ${price.out} (per 1M tokens)${isFastSelected ? " [Fast]" : ""}`;

  let badge = flexContainer.querySelector(".cursor-token-pricing-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "cursor-token-pricing-badge";
    flexContainer.appendChild(badge);
  }

  if (badge.textContent !== priceText) badge.textContent = priceText;
  if (badge.title !== titleText) badge.title = titleText;
}

function scanAndInject() {
  const modelElements = document.querySelectorAll("[data-model-picker-item-name]");
  modelElements.forEach(processModelItem);
}

// Initialize
(async () => {
  await syncPricing();

  const observer = new MutationObserver(() => scanAndInject());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scanAndInject();
})();