// Keyless public market data. DexScreener is paced under 300/min. GeckoTerminal under ~5/min.

import { DEX, GECKO, LS } from "./constants.js";

const memory = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttl) {
  memory.set(key, { value, exp: Date.now() + ttl });
  return value;
}

function makeLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let nextAt = 0;
  return {
    schedule(task, onWait) {
      const run = async () => {
        while (Date.now() < nextAt) {
          const left = nextAt - Date.now();
          if (onWait) onWait(left);
          await sleep(Math.min(500, left));
        }
        nextAt = Date.now() + minIntervalMs;
        return task((extra) => {
          nextAt = Math.max(nextAt, Date.now() + extra);
        });
      };
      const promise = chain.then(run, run);
      chain = promise.then(() => {}, () => {});
      return promise;
    }
  };
}

const dexLimiter = makeLimiter(DEX.minIntervalMs);
const geckoLimiter = makeLimiter(GECKO.minIntervalMs);

async function fetchJson(url, headers, pushWait) {
  let attempt = 0;
  let lastError = new Error("The public data source could not be reached.");
  while (attempt < 3) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      lastError = new Error("The network blocked that lookup. Try again in a moment.");
      attempt += 1;
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const retry = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retry) && retry > 0 ? retry * 1000 : 2000 * (2 ** attempt);
      if (pushWait) pushWait(Math.min(wait, 20000));
      await sleep(Math.min(wait, 20000));
      lastError = new Error("The data source asked for a pause. Waiting, then trying again.");
      attempt += 1;
      continue;
    }
    if (!res.ok) {
      const error = new Error("Lookup failed (" + res.status + ").");
      error.status = res.status;
      throw error;
    }
    return res.json();
  }
  throw lastError;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePair(raw) {
  if (!raw || raw.chainId !== "solana") return null;
  const price = num(raw.priceUsd);
  if (!(price > 0) || !raw.pairAddress) return null;
  const buys = raw.txns && raw.txns.h1 ? Number(raw.txns.h1.buys) || 0 : 0;
  const sells = raw.txns && raw.txns.h1 ? Number(raw.txns.h1.sells) || 0 : 0;
  const created = num(raw.pairCreatedAt);
  return {
    chainId: "solana",
    pairAddress: raw.pairAddress,
    dexId: raw.dexId || "",
    url: raw.url || "",
    baseSymbol: (raw.baseToken && raw.baseToken.symbol) || "?",
    baseName: (raw.baseToken && raw.baseToken.name) || "",
    baseAddress: (raw.baseToken && raw.baseToken.address) || "",
    quoteSymbol: (raw.quoteToken && raw.quoteToken.symbol) || "",
    priceUsd: price,
    liquidityUsd: raw.liquidity && Number(raw.liquidity.usd) > 0 ? Number(raw.liquidity.usd) : 0,
    volumeH24: raw.volume ? Number(raw.volume.h24) || 0 : 0,
    volumeH1: raw.volume ? Number(raw.volume.h1) || 0 : 0,
    priceChangeH1: raw.priceChange ? num(raw.priceChange.h1) : null,
    buysH1: buys,
    sellsH1: sells,
    buysSellsRatio: buys / Math.max(sells, 1),
    pairCreatedAt: created,
    ageMinutes: created ? (Date.now() - created) / 60000 : null
  };
}

function pickBest(pairs) {
  const byToken = new Map();
  pairs.forEach((pair) => {
    const key = pair.baseAddress || pair.pairAddress;
    const prev = byToken.get(key);
    if (!prev) {
      byToken.set(key, pair);
      return;
    }
    const prevSol = prev.quoteSymbol === "SOL" ? 1 : 0;
    const nextSol = pair.quoteSymbol === "SOL" ? 1 : 0;
    const prevScore = prev.liquidityUsd * (prevSol ? 1.15 : 1);
    const nextScore = pair.liquidityUsd * (nextSol ? 1.15 : 1);
    if (nextScore > prevScore) byToken.set(key, pair);
  });
  return [...byToken.values()];
}

async function dexJson(url) {
  return dexLimiter.schedule((pushWait) => fetchJson(url, { Accept: "application/json" }, pushWait));
}

async function candidateAddresses() {
  const cached = cacheGet("dex:candidates");
  if (cached) return cached;
  const settled = await Promise.allSettled([
    dexJson("https://api.dexscreener.com/token-profiles/latest/v1"),
    dexJson("https://api.dexscreener.com/token-boosts/latest/v1")
  ]);
  const addresses = [];
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;
    result.value.forEach((row) => {
      if (!row || row.chainId !== "solana" || !row.tokenAddress) return;
      if (!addresses.includes(row.tokenAddress)) addresses.push(row.tokenAddress);
    });
  });
  if (!addresses.length && settled.every((result) => result.status === "rejected")) {
    const reason = settled[0].reason;
    throw reason instanceof Error ? reason : new Error("DexScreener could not be reached.");
  }
  return cacheSet("dex:candidates", addresses, DEX.profilesTtlMs);
}

export async function pairsForTokens(addresses) {
  const unique = [];
  (addresses || []).forEach((addr) => {
    if (addr && !unique.includes(addr)) unique.push(addr);
  });
  const batch = unique.slice(0, 30);
  if (!batch.length) return [];
  const key = "dex:pairs:" + batch.slice().sort().join(",");
  const cached = cacheGet(key);
  if (cached) return cached;
  const raw = await dexJson("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(","));
  const list = Array.isArray(raw) ? raw : (raw && raw.pairs) || [];
  const pairs = pickBest(list.map(normalizePair).filter(Boolean));
  return cacheSet(key, pairs, DEX.pairsTtlMs);
}

export async function loadSolanaMarket(extraAddresses = []) {
  let candidates = [];
  try {
    candidates = await candidateAddresses();
  } catch (err) {
    if (!extraAddresses.length) throw err;
  }
  if (!candidates.length) {
    const cached = cacheGet("dex:search");
    const search = cached || await dexJson("https://api.dexscreener.com/latest/dex/search?q=solana");
    if (!cached) cacheSet("dex:search", search, DEX.profilesTtlMs);
    const fromSearch = pickBest(((search && search.pairs) || []).map(normalizePair).filter(Boolean));
    if (!extraAddresses.length) return fromSearch;
    fromSearch.forEach((pair) => {
      if (pair.baseAddress && !candidates.includes(pair.baseAddress)) candidates.push(pair.baseAddress);
    });
  }
  const addresses = [];
  extraAddresses.forEach((addr) => {
    if (addr && !addresses.includes(addr)) addresses.push(addr);
  });
  candidates.forEach((addr) => {
    if (addresses.length < 30 && !addresses.includes(addr)) addresses.push(addr);
  });
  return pairsForTokens(addresses);
}

function diskCache() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LS.gecko) || "{}") || {};
  } catch (err) {
    return {};
  }
}

function diskGet(key) {
  const box = diskCache();
  const hit = box[key];
  if (!hit || Date.now() > hit.exp) return null;
  return hit.value;
}

function diskSet(key, value) {
  if (typeof localStorage === "undefined") return;
  try {
    const box = diskCache();
    box[key] = { exp: Date.now() + GECKO.cacheTtlMs, value };
    const keys = Object.keys(box);
    if (keys.length > GECKO.maxDiskEntries) {
      keys.sort((a, b) => (box[a].exp || 0) - (box[b].exp || 0));
      keys.slice(0, keys.length - GECKO.maxDiskEntries).forEach((old) => delete box[old]);
    }
    localStorage.setItem(LS.gecko, JSON.stringify(box));
  } catch (err) { /* cache is optional */ }
}

export async function geckoJson(path, onWait) {
  const key = "g:" + path;
  const mem = cacheGet(key);
  if (mem) return { value: mem, fromCache: true };
  const disk = diskGet(key);
  if (disk) {
    cacheSet(key, disk, GECKO.cacheTtlMs);
    return { value: disk, fromCache: true };
  }
  const value = await geckoLimiter.schedule(
    (pushWait) => fetchJson(GECKO.origin + path, { Accept: "application/json;version=20230203" }, pushWait),
    onWait
  );
  cacheSet(key, value, GECKO.cacheTtlMs);
  diskSet(key, value);
  return { value, fromCache: false };
}

function poolFromItem(item) {
  const attr = (item && item.attributes) || {};
  const address = attr.address || String(item.id || "").split("_").pop();
  if (!address) return null;
  return {
    address,
    name: attr.name || address.slice(0, 6),
    createdAt: attr.pool_created_at || null,
    reserveUsd: Number(attr.reserve_in_usd) || 0
  };
}

export async function searchPools(query, onWait) {
  const q = String(query || "").trim();
  if (!q) return [];
  const { value } = await geckoJson("/search/pools?query=" + encodeURIComponent(q) + "&network=solana", onWait);
  return ((value && value.data) || []).map(poolFromItem).filter(Boolean).slice(0, 12);
}

export async function poolsForToken(token, onWait) {
  const { value } = await geckoJson("/networks/solana/tokens/" + encodeURIComponent(token) + "/pools?page=1", onWait);
  return ((value && value.data) || []).map(poolFromItem).filter(Boolean).slice(0, 8);
}

export const TIMEFRAMES = {
  m15: { id: "m15", label: "15 minute candles", path: "minute", aggregate: 15, barMinutes: 15 },
  h1: { id: "h1", label: "1 hour candles", path: "hour", aggregate: 1, barMinutes: 60 },
  h4: { id: "h4", label: "4 hour candles", path: "hour", aggregate: 4, barMinutes: 240 }
};

export async function candlesForPool(address, timeframe, onWait) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.h1;
  const path = "/networks/solana/pools/" + encodeURIComponent(address)
    + "/ohlcv/" + tf.path + "?aggregate=" + tf.aggregate + "&limit=100&currency=usd";
  const { value, fromCache } = await geckoJson(path, onWait);
  const list = value && value.data && value.data.attributes && value.data.attributes.ohlcv_list;
  if (!Array.isArray(list) || !list.length) throw new Error("That pool returned no candles.");
  const candles = list.map((row) => ({
    t: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]) || 0
  })).filter((row) => row.t > 0 && row.close > 0);
  candles.sort((a, b) => a.t - b.t);
  return { candles, fromCache, barMinutes: tf.barMinutes, timeframe: tf };
}
