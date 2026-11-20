// Plain-English strategy -> structured paper rules. Templates need no network.

export const TEMPLATES = [
  {
    id: "fresh-crease",
    name: "Fresh crease",
    blurb: "Young pairs, a little liquidity, a short hold. The ape does not linger.",
    rules: {
      name: "Fresh crease",
      entry: {
        maxTokenAgeMinutes: 180,
        minTokenAgeMinutes: null,
        minLiquidityUsd: 8000,
        minVolumeH24Usd: null,
        minVolumeH1Usd: 2000,
        minPriceChangeH1Pct: 1,
        maxPriceChangeH1Pct: 80,
        minBuysSellsRatio: 1.1
      },
      positionSizeSol: 0.25,
      takeProfitPct: 20,
      stopLossPct: 12,
      maxHoldMinutes: 30
    }
  },
  {
    id: "deep-pocket",
    name: "Deep pocket",
    blurb: "Skips brand-new pairs and asks for a thicker pool of liquidity.",
    rules: {
      name: "Deep pocket",
      entry: {
        maxTokenAgeMinutes: null,
        minTokenAgeMinutes: 60,
        minLiquidityUsd: 50000,
        minVolumeH24Usd: 100000,
        minVolumeH1Usd: null,
        minPriceChangeH1Pct: -5,
        maxPriceChangeH1Pct: 40,
        minBuysSellsRatio: 0.8
      },
      positionSizeSol: 0.4,
      takeProfitPct: 15,
      stopLossPct: 8,
      maxHoldMinutes: 120
    }
  },
  {
    id: "loud-floor",
    name: "Loud floor",
    blurb: "Busy pairs only. If the tape goes quiet, this sheet never sits down.",
    rules: {
      name: "Loud floor",
      entry: {
        maxTokenAgeMinutes: 1440,
        minTokenAgeMinutes: null,
        minLiquidityUsd: 15000,
        minVolumeH24Usd: 250000,
        minVolumeH1Usd: 20000,
        minPriceChangeH1Pct: 3,
        maxPriceChangeH1Pct: 120,
        minBuysSellsRatio: 1
      },
      positionSizeSol: 0.3,
      takeProfitPct: 25,
      stopLossPct: 15,
      maxHoldMinutes: 45
    }
  },
  {
    id: "slow-crease",
    name: "Slow crease",
    blurb: "Older pairs and a longer paper hold. Still leaves on a timer.",
    rules: {
      name: "Slow crease",
      entry: {
        maxTokenAgeMinutes: null,
        minTokenAgeMinutes: 1440,
        minLiquidityUsd: 30000,
        minVolumeH24Usd: 50000,
        minVolumeH1Usd: null,
        minPriceChangeH1Pct: -2,
        maxPriceChangeH1Pct: 15,
        minBuysSellsRatio: null
      },
      positionSizeSol: 0.35,
      takeProfitPct: 12,
      stopLossPct: 7,
      maxHoldMinutes: 360
    }
  },
  {
    id: "paper-hands",
    name: "Paper hands",
    blurb: "Tiny fake size, quick exit. The namesake. Fold before you hold.",
    rules: {
      name: "Paper hands",
      entry: {
        maxTokenAgeMinutes: 720,
        minTokenAgeMinutes: null,
        minLiquidityUsd: 10000,
        minVolumeH24Usd: null,
        minVolumeH1Usd: 5000,
        minPriceChangeH1Pct: 0,
        maxPriceChangeH1Pct: 50,
        minBuysSellsRatio: 1.2
      },
      positionSizeSol: 0.1,
      takeProfitPct: 10,
      stopLossPct: 6,
      maxHoldMinutes: 15
    }
  }
];

const STEMS = [
  { id: "fresh-crease", stems: ["fresh", "young", "new pair", "just launched", "brand new", "early", "minutes old"] },
  { id: "deep-pocket", stems: ["liquid", "deep", "thick pool", "safer pool"] },
  { id: "loud-floor", stems: ["volume", "busy", "loud", "active tape", "prints"] },
  { id: "slow-crease", stems: ["slow", "patient", "older", "days old", "long hold"] },
  { id: "paper-hands", stems: ["paper", "tiny", "small size", "scared", "quick", "fold fast"] }
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function optNum(value, min, max) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return clamp(n, min, max);
}

export function templateById(id) {
  return TEMPLATES.find((item) => item.id === id) || TEMPLATES[TEMPLATES.length - 1];
}

export function sanitizeRules(input) {
  const src = input && typeof input === "object" ? input : {};
  const entry = src.entry && typeof src.entry === "object" ? src.entry : {};
  const name = String(src.name || "Untitled fold").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled fold";
  let minChange = optNum(entry.minPriceChangeH1Pct, -99, 10000);
  let maxChange = optNum(entry.maxPriceChangeH1Pct, -99, 10000);
  if (minChange != null && maxChange != null && minChange > maxChange) {
    const swap = minChange;
    minChange = maxChange;
    maxChange = swap;
  }
  return {
    name,
    entry: {
      maxTokenAgeMinutes: optNum(entry.maxTokenAgeMinutes, 1, 100000),
      minTokenAgeMinutes: optNum(entry.minTokenAgeMinutes, 0, 100000),
      minLiquidityUsd: optNum(entry.minLiquidityUsd, 0, 1e12),
      minVolumeH24Usd: optNum(entry.minVolumeH24Usd, 0, 1e12),
      minVolumeH1Usd: optNum(entry.minVolumeH1Usd, 0, 1e12),
      minPriceChangeH1Pct: minChange,
      maxPriceChangeH1Pct: maxChange,
      minBuysSellsRatio: optNum(entry.minBuysSellsRatio, 0, 1000)
    },
    positionSizeSol: optNum(src.positionSizeSol, 0.05, 5) ?? 0.25,
    takeProfitPct: optNum(src.takeProfitPct, 1, 500) ?? 20,
    stopLossPct: optNum(src.stopLossPct, 1, 90) ?? 12,
    maxHoldMinutes: optNum(src.maxHoldMinutes, 1, 24 * 60) ?? 30
  };
}

export function rulesToJson(rules) {
  return JSON.stringify(sanitizeRules(rules), null, 2);
}

export function parseRulesText(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("That reply had no JSON object. Try a template, or edit the sheet yourself.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error("That JSON did not parse. Fix it, or pick a template.");
  }
  return sanitizeRules(parsed);
}

function hoursToMinutes(n, unit) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  if (/^h/.test(unit)) return value * 60;
  return value;
}

function money(n, suffix) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  const mult = /m/.test(suffix || "") ? 1e6 : /k/.test(suffix || "") ? 1e3 : 1;
  return value * mult;
}

export function applyTextOverrides(rules, text) {
  const next = sanitizeRules(rules);
  const src = String(text || "");
  const lower = src.toLowerCase();
  const sol = lower.match(/(\d+(?:\.\d+)?)\s*sol\b/);
  if (sol) next.positionSizeSol = Number(sol[1]);
  const stop = lower.match(/stop(?:\s|-)?loss[^0-9]{0,16}(\d+(?:\.\d+)?)\s*%?/);
  const down = lower.match(/(\d+(?:\.\d+)?)\s*%\s*down\b/);
  if (stop) next.stopLossPct = Number(stop[1]);
  else if (down) next.stopLossPct = Number(down[1]);
  const take = lower.match(/take(?:\s|-)?profit[^0-9]{0,16}(\d+(?:\.\d+)?)\s*%?/);
  const up = lower.match(/(\d+(?:\.\d+)?)\s*%\s*up\b/);
  if (take) next.takeProfitPct = Number(take[1]);
  else if (up) next.takeProfitPct = Number(up[1]);
  const hold = lower.match(/\bhold(?:\s+[a-z]+){0,4}\s+(\d+(?:\.\d+)?)\s*(minutes|minute|min|hours|hour|hrs|hr|h|m)\b/);
  if (hold) next.maxHoldMinutes = hoursToMinutes(hold[1], hold[2]);
  const age = lower.match(/(?:younger than|under|age under|max age)\s*(\d+(?:\.\d+)?)\s*(minutes|minute|min|hours|hour|h|m)\b/);
  if (age) next.entry.maxTokenAgeMinutes = hoursToMinutes(age[1], age[2]);
  const scale = (suffix) => (suffix || "").replace("thousand", "k").replace("million", "m");
  const nearMoney = (word) => {
    const before = new RegExp("\\$?(\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?\\s*" + word);
    const after = new RegExp(word + "\\s*(?:over|above|at least|of)?\\s*\\$?(\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?");
    return lower.match(before) || lower.match(after);
  };
  const liq = nearMoney("liquid");
  if (liq) next.entry.minLiquidityUsd = money(liq[1], scale(liq[2]));
  const vol = nearMoney("volume");
  if (vol) {
    const amount = money(vol[1], scale(vol[2]));
    const around = lower.slice(Math.max(0, vol.index - 16), vol.index + vol[0].length + 16);
    if (/24|day/.test(around)) next.entry.minVolumeH24Usd = amount;
    else next.entry.minVolumeH1Usd = amount;
  }
  const ratio = lower.match(/buys?\s*(?:to|\/)\s*sells?[^0-9]{0,16}(\d+(?:\.\d+)?)/);
  if (ratio) next.entry.minBuysSellsRatio = Number(ratio[1]);
  return sanitizeRules(next);
}

export function pickTemplate(text) {
  const lower = String(text || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  STEMS.forEach((row) => {
    const score = row.stems.reduce((sum, stem) => sum + (lower.includes(stem) ? 1 : 0), 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  });
  const chosen = templateById(best ? best.id : "paper-hands");
  const rules = applyTextOverrides(chosen.rules, text);
  const note = bestScore > 0
    ? "Matched the “" + chosen.name + "” sheet, then applied any numbers in the sentence."
    : "Nothing in that sentence pointed at a sheet, so the ape used Paper hands. Numbers in the sentence still apply.";
  return { templateId: chosen.id, rules, note };
}

export function entryMatches(pair, rules) {
  const entry = (rules && rules.entry) || {};
  const checks = [
    ["maxTokenAgeMinutes", pair.ageMinutes, (value, limit) => value <= limit],
    ["minTokenAgeMinutes", pair.ageMinutes, (value, limit) => value >= limit],
    ["minLiquidityUsd", pair.liquidityUsd, (value, limit) => value >= limit],
    ["minVolumeH24Usd", pair.volumeH24, (value, limit) => value >= limit],
    ["minVolumeH1Usd", pair.volumeH1, (value, limit) => value >= limit],
    ["minPriceChangeH1Pct", pair.priceChangeH1, (value, limit) => value >= limit],
    ["maxPriceChangeH1Pct", pair.priceChangeH1, (value, limit) => value <= limit],
    ["minBuysSellsRatio", pair.buysSellsRatio, (value, limit) => value >= limit]
  ];
  for (let i = 0; i < checks.length; i += 1) {
    const [key, value, ok] = checks[i];
    if (entry[key] == null) continue;
    if (value == null || Number.isNaN(Number(value))) return false;
    if (!ok(Number(value), Number(entry[key]))) return false;
  }
  return true;
}
