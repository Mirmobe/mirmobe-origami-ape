// Fake-SOL paper book. Shared by the live desk and candle replay.

import { TIERS } from "./constants.js";
import { entryMatches, sanitizeRules } from "./rules.js";

export const CLOSE_COPY = {
  stop: "Folded under pressure.",
  target: "Left while the sheet was still up.",
  time: "The hold timer ran out. The ape let go.",
  stopFirst: "Both sides of the candle touched. The ape folded first."
};

export function roundSol(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

export function freshBook(now = Date.now()) {
  return {
    cashSol: TIERS.startingFakeSol,
    positions: [],
    trades: [],
    createdAt: now
  };
}

export function bookSnapshot(book) {
  let openValue = 0;
  (book.positions || []).forEach((pos) => {
    const px = pos.lastPriceUsd > 0 ? pos.lastPriceUsd : pos.entryPriceUsd;
    if (pos.entryPriceUsd > 0 && px > 0) openValue += pos.sizeSol * (px / pos.entryPriceUsd);
  });
  const equity = roundSol(book.cashSol + openValue);
  return {
    cashSol: roundSol(book.cashSol),
    openValue: roundSol(openValue),
    equity,
    paperChange: roundSol(equity - TIERS.startingFakeSol)
  };
}

function tradeId(now, salt) {
  return "t" + now.toString(36) + salt;
}

function closePosition(book, pos, exitPrice, reason, now) {
  const proceeds = roundSol(pos.sizeSol * (exitPrice / pos.entryPriceUsd));
  const changeSol = roundSol(proceeds - pos.sizeSol);
  const changePct = ((exitPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
  book.cashSol = roundSol(book.cashSol + proceeds);
  book.positions = book.positions.filter((item) => item.id !== pos.id);
  const trade = {
    id: tradeId(now, book.trades.length),
    pairAddress: pos.pairAddress,
    symbol: pos.symbol,
    baseAddress: pos.baseAddress,
    url: pos.url,
    openedAt: pos.openedAt,
    closedAt: now,
    entryPriceUsd: pos.entryPriceUsd,
    exitPriceUsd: exitPrice,
    sizeSol: pos.sizeSol,
    proceedsSol: proceeds,
    changeSol,
    changePct,
    reason,
    line: CLOSE_COPY[reason] || CLOSE_COPY.time
  };
  book.trades.unshift(trade);
  if (book.trades.length > TIERS.maxTrades) book.trades.length = TIERS.maxTrades;
  return trade;
}

function onCooldown(book, pairAddress, now) {
  return book.trades.some((trade) => trade.pairAddress === pairAddress && now - trade.closedAt < TIERS.reentryCooldownMs);
}

function openPosition(book, pair, size, now) {
  book.cashSol = roundSol(book.cashSol - size);
  const pos = {
    id: tradeId(now, book.positions.length),
    pairAddress: pair.pairAddress,
    symbol: pair.baseSymbol || "?",
    baseAddress: pair.baseAddress || "",
    url: pair.url || "",
    dexId: pair.dexId || "",
    openedAt: now,
    entryPriceUsd: pair.priceUsd,
    lastPriceUsd: pair.priceUsd,
    sizeSol: roundSol(size)
  };
  book.positions.push(pos);
  return pos;
}

export function stepBook(book, rules, pairs, now = Date.now()) {
  const clean = sanitizeRules(rules);
  const opened = [];
  const closed = [];
  const byPair = new Map((pairs || []).map((pair) => [pair.pairAddress, pair]));

  book.positions.forEach((pos) => {
    const pair = byPair.get(pos.pairAddress);
    const price = pair && pair.priceUsd > 0 ? pair.priceUsd : 0;
    if (!(price > 0) || !(pos.entryPriceUsd > 0)) return;
    pos.lastPriceUsd = price;
    const changePct = ((price - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    const heldMin = (now - pos.openedAt) / 60000;
    let reason = null;
    if (changePct <= -Math.abs(clean.stopLossPct)) reason = "stop";
    else if (changePct >= Math.abs(clean.takeProfitPct)) reason = "target";
    else if (heldMin >= clean.maxHoldMinutes) reason = "time";
    if (reason) closed.push(closePosition(book, pos, price, reason, now));
  });

  const ranked = [...(pairs || [])].filter((pair) => pair && pair.priceUsd > 0 && pair.pairAddress);
  ranked.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  for (let i = 0; i < ranked.length; i += 1) {
    if (book.positions.length >= TIERS.maxOpenPositions) break;
    const pair = ranked[i];
    if (!entryMatches(pair, clean)) continue;
    if (book.positions.some((pos) => pos.pairAddress === pair.pairAddress)) continue;
    if (onCooldown(book, pair.pairAddress, now)) continue;
    const size = clean.positionSizeSol;
    if (!(size > 0) || book.cashSol + 1e-9 < size) break;
    opened.push(openPosition(book, pair, size, now));
  }
  return { opened, closed };
}

function rollingVolume(candles, index, bars) {
  const start = Math.max(0, index - bars + 1);
  let sum = 0;
  for (let i = start; i <= index; i += 1) sum += Number(candles[i].volume) || 0;
  return { sum, complete: index - start + 1 >= bars };
}

export function replayCandles(rules, candles, meta = {}) {
  const clean = sanitizeRules(rules);
  const replayRules = sanitizeRules(clean);
  const skipped = [];
  if (clean.entry.minLiquidityUsd != null) {
    replayRules.entry.minLiquidityUsd = null;
    skipped.push("liquidity");
  }
  if (clean.entry.minBuysSellsRatio != null) {
    replayRules.entry.minBuysSellsRatio = null;
    skipped.push("buys/sells ratio");
  }
  const book = freshBook(candles[0] ? candles[0].t * 1000 : Date.now());
  const barMinutes = meta.barMinutes || 60;
  const barsH1 = Math.max(1, Math.round(60 / barMinutes));
  const barsH24 = Math.max(1, Math.round(1440 / barMinutes));
  const poolCreatedAt = meta.poolCreatedAt ? Date.parse(meta.poolCreatedAt) : NaN;
  let blockedByAge = false;

  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i];
    const prev = candles[i - 1];
    const now = bar.t * 1000;
    if (!(bar.close > 0) || !(prev.close > 0)) continue;
    const pos = book.positions[0];
    if (pos && pos.entryPriceUsd > 0) {
      const tp = pos.entryPriceUsd * (1 + clean.takeProfitPct / 100);
      const sl = pos.entryPriceUsd * (1 - clean.stopLossPct / 100);
      const heldMin = (now - pos.openedAt) / 60000;
      const hitTp = bar.high >= tp;
      const hitSl = bar.low <= sl;
      if (hitTp && hitSl) closePosition(book, pos, sl, "stopFirst", now);
      else if (hitSl) closePosition(book, pos, sl, "stop", now);
      else if (hitTp) closePosition(book, pos, tp, "target", now);
      else if (heldMin >= clean.maxHoldMinutes) closePosition(book, pos, bar.close, "time", now);
    }
    if (book.positions.length) continue;
    const volH1 = rollingVolume(candles, i, barsH1);
    const volH24 = rollingVolume(candles, i, barsH24);
    let ageMinutes = null;
    if (Number.isFinite(poolCreatedAt)) ageMinutes = (now - poolCreatedAt) / 60000;
    else if (clean.entry.maxTokenAgeMinutes != null || clean.entry.minTokenAgeMinutes != null) blockedByAge = true;
    const synthetic = {
      pairAddress: meta.poolAddress || "replay",
      baseSymbol: meta.symbol || "TOKEN",
      baseAddress: meta.tokenAddress || "",
      url: meta.url || "",
      dexId: "replay",
      priceUsd: bar.close,
      liquidityUsd: null,
      volumeH24: clean.entry.minVolumeH24Usd == null ? null : (volH24.complete ? volH24.sum : 0),
      volumeH1: clean.entry.minVolumeH1Usd == null ? null : (volH1.complete ? volH1.sum : 0),
      priceChangeH1: ((bar.close - prev.close) / prev.close) * 100,
      buysSellsRatio: null,
      ageMinutes
    };
    stepBook(book, replayRules, [synthetic], now);
  }

  const stillOpen = book.positions.length;
  if (stillOpen) {
    const last = candles[candles.length - 1];
    book.positions.forEach((pos) => {
      pos.lastPriceUsd = last.close;
    });
  }
  return {
    book,
    skipped,
    bars: candles.length,
    blockedByAge: blockedByAge && book.trades.length === 0 && book.positions.length === 0,
    barMinutes
  };
}
