const PRICING_URL = "https://cursor.com/docs/models-and-pricing.md";
const STORAGE_KEY = "cursor_prices_v5"; // Bumping cache key flushes old poisoned data
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Baseline fallback rates covering standard, context tiers, and speed variants
const FALLBACK_PRICES = {
  // Grok family
  "grok-4-7":                  { in: "$2.00", out: "$6.00" },
  "grok-4-7-fast":             { in: "$4.00", out: "$12.00" },
  "grok-4-7-500k":             { in: "$4.00", out: "$12.00" },
  "grok-4-7-500k-fast":        { in: "$6.00", out: "$18.00" },
  "grok-4-6":                  { in: "$2.00", out: "$6.00" },
  "grok-4-6-fast":             { in: "$4.00", out: "$12.00" },
  "grok-4-5":                  { in: "$2.00", out: "$6.00" },
  "grok-4-5-fast":             { in: "$4.00", out: "$12.00" },

  // Composer family
  "composer-2-5":              { in: "$0.50", out: "$2.50" },
  "composer-2-5-fast":         { in: "$3.00", out: "$15.00" },

  // Claude family
  "claude-opus-5-5":           { in: "$15.00", out: "$75.00" },
  "claude-opus-5-5-1m":        { in: "$15.00", out: "$75.00" },
  "claude-sonnet-5-5":         { in: "$3.00", out: "$15.00" },
  "claude-fable-5-1":          { in: "$3.00", out: "$15.00" },
  "claude-fable-5-1-1m":       { in: "$3.00", out: "$15.00" },

  // Frontier & 3rd party
  "gpt-5-6-sol":               { in: "$4.00", out: "$20.00" },
  "gemini-4-argon":            { in: "$2.00", out: "$10.00" },
  "muse-wonder-1-0":           { in: "$1.50", out: "$6.00" }
};

let activePrices = { ...FALLBACK_PRICES };

/**
 * Normalizes strings like "$0.5" -> "$0.50" and "$3" -> "$3.00"
 */
function formatCurrency(val) {
  if (!val) return val;
  const num = parseFloat(val.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return val;
  return `$${num.toFixed(2)}`;
}

/**
 * Converts any label or attribute into a consistent kebab-case key:
 * "Grok 4.7" -> "grok-4-7"
 * "claude-opus-5-5" -> "claude-opus-5-5"
 */
function normalizeKey(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extracts model attributes and generates a variant key from documentation rows:
 * "Grok 4.7 500k (Fast)" -> "grok-4-7-500k-fast"
 * "Composer 2.5" -> "composer-2-5"
 */
function parseDocRowKey(rawName) {
  const isFast = /\bfast\b/i.test(rawName);
  const ctxMatch = rawName.match(/\b(\d+[mk])\b/i);
  const context = ctxMatch ? ctxMatch[1].toLowerCase() : null;

  // Clean base name by stripping parentheticals, context sizes, and fast labels
  const clean = rawName
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b\d+[mk]\b/gi, "")
    .replace(/\bfast\b/gi, "");

  const baseKey = normalizeKey(clean);
  if (!baseKey) return null;

  const keyParts = [baseKey];
  if (context) keyParts.push(context);
  if (isFast) keyParts.push("fast");

  return keyParts.join("-");
}

/**
 * Parses markdown table rows into our variant pricing dictionary
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

    if (cells.length >= 3) {
      const rawName = cells[0];
      const pricesInRow = cells.filter(c => /^\$\d+(\.\d+)?/.test(c));

      if (pricesInRow.length >= 2) {
        const variantKey = parseDocRowKey(rawName);
        if (!variantKey) continue;

        const inPrice = formatCurrency(pricesInRow[0]);
        const outPrice = formatCurrency(pricesInRow[pricesInRow.length - 1]);

        prices[variantKey] = { in: inPrice, out: outPrice };
      }
    }
  }
  return prices;
}

/**
 * Loads cached prices or fetches latest docs
 */
async function syncPricing() {
  try {
    // Purge old versions to eliminate stale cache state
    chrome.storage.local.remove([
      "cursor_prices",
      "cursor_prices_v2",
      "cursor_prices_v3",
      "cursor_prices_v4"
    ]);

    const cached = await chrome.storage.local.get([STORAGE_KEY, "last_updated"]);
    const isStale = !cached.last_updated || (Date.now() - cached.last_updated > CACHE_TTL_MS);

    if (cached[STORAGE_KEY] && !isStale) {
      activePrices = { ...FALLBACK_PRICES, ...cached[STORAGE_KEY] };
      return;
    }

    const response = await fetch(PRICING_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const markdown = await response.text();
    const livePrices = parsePricingMarkdown(markdown);

    activePrices = { ...FALLBACK_PRICES, ...livePrices };

    await chrome.storage.local.set({
      [STORAGE_KEY]: livePrices,
      last_updated: Date.now()
    });
  } catch (err) {
    console.warn("[Cursor Token Pricing] Using fallback prices due to sync error:", err);
  }
}

function getTagClass(token) {
  const t = token.toLowerCase();
  if (/^\d+[mk]$/i.test(t)) return "cursor-mod-context"; // e.g. 500k, 1M
  if (t === "high") return "cursor-mod-high";
  if (t === "medium") return "cursor-mod-medium";
  if (t === "low") return "cursor-mod-low";
  if (t === "fast") return "cursor-mod-speed";
  return "cursor-mod-generic";
}

/**
 * Inspects Cursor's native modifier span, cleans zero-width characters,
 * mounts styled chips, and extracts active flags.
 */
function updateModifierTags(labelParagraph) {
  const nativeSpan = labelParagraph.querySelector('span[style*="--cursor-text-tertiary"]');
  // Strip hidden zero-width spaces (\u200B) often added by Cursor
  const rawText = nativeSpan
    ? nativeSpan.textContent.replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
    : "";

  let container = labelParagraph.querySelector(".cursor-mod-container");

  if (!rawText) {
    if (container) container.remove();
    return { isFast: false, context: null, rawTokens: [] };
  }

  // Hide the native unstyled text node
  nativeSpan.style.display = "none";

  if (!container) {
    container = document.createElement("span");
    container.className = "cursor-mod-container";
    labelParagraph.appendChild(container);
  }

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

  const isFast = /\bfast\b/i.test(rawText);
  const ctxMatch = rawText.match(/\b(\d+[mk])\b/i);
  const context = ctxMatch ? ctxMatch[1].toLowerCase() : null;

  return { isFast, context, rawTokens: rawText.split(/\s+/).filter(Boolean) };
}

/**
 * Resolves the exact price matching the active modifiers
 */
function resolvePrice(baseKey, context, isFast) {
  const candidates = [];

  // 1. Both context + fast (e.g. grok-4-7-500k-fast)
  if (context && isFast) {
    candidates.push(`${baseKey}-${context}-fast`);
  }
  // 2. Context only (e.g. grok-4-7-500k, claude-opus-5-5-1m)
  if (context) {
    candidates.push(`${baseKey}-${context}`);
  }
  // 3. Fast only (e.g. composer-2-5-fast, grok-4-7-fast)
  if (isFast) {
    candidates.push(`${baseKey}-fast`);
  }
  // 4. Base model standard (e.g. composer-2-5, grok-4-7)
  candidates.push(baseKey);

  for (const key of candidates) {
    if (activePrices[key]) {
      return { price: activePrices[key], matchedKey: key };
    }
  }

  return null;
}

/**
 * Evaluates row state, selects the price variant, and updates the badge
 */
function processModelItem(nameNode) {
  const flexContainer = nameNode.closest(".ui-model-picker__item-content");
  if (!flexContainer) return;

  const rawModelAttr = nameNode.getAttribute("data-model-picker-item-name");
  if (!rawModelAttr) return;

  const baseKey = normalizeKey(rawModelAttr);
  const labelParagraph = nameNode.querySelector(".ui-markdown__paragraph");
  const { isFast, context, rawTokens } = labelParagraph
    ? updateModifierTags(labelParagraph)
    : { isFast: false, context: null, rawTokens: [] };

  const match = resolvePrice(baseKey, context, isFast);
  if (!match) return;

  const { price } = match;
  const priceText = `${price.in} / ${price.out}`;
  
  // Format active modifiers for tooltip feedback
  const activeModifiers = [];
  if (context) activeModifiers.push(context.toUpperCase());
  if (isFast) activeModifiers.push("Fast");
  const modifierSuffix = activeModifiers.length > 0 ? ` [${activeModifiers.join(", ")}]` : "";

  const titleText = `Input: ${price.in} | Output: ${price.out} (per 1M tokens)${modifierSuffix}`;

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