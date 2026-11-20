import assert from "node:assert/strict";
import test from "node:test";
import { nacl } from "../js/vendor/nacl.js";
import { pickTemplate, parseRulesText, sanitizeRules, entryMatches, rulesToJson } from "../js/rules.js";
import { freshBook, replayCandles, stepBook, CLOSE_COPY } from "../js/paper.js";
import { normalizePair } from "../js/market.js";
import {
  assessPayment,
  balanceFromParsedAccounts,
  collectAccountKeys,
  encodeBase58,
  extractSignature,
  grantDue,
  holderMessage,
  holderMinRaw,
  recipientGainLamports,
  verifyHolderSignature
} from "../js/wallet.js";
import { FOLD_MINT, QUESTO_MINT, QUESTO_HOLDER_MIN, UNLOCK } from "../js/constants.js";

const PAY = UNLOCK.paymentAddress;

test("templates and plain text stay deterministic", () => {
  const young = pickTemplate("Young pairs under 3 hours, at least $10k liquidity, 0.2 SOL, fold at 10% down or 20% up, hold 30 minutes.");
  assert.equal(young.templateId, "fresh-crease");
  assert.equal(young.rules.positionSizeSol, 0.2);
  assert.equal(young.rules.stopLossPct, 10);
  assert.equal(young.rules.takeProfitPct, 20);
  assert.equal(young.rules.maxHoldMinutes, 30);
  assert.equal(young.rules.entry.maxTokenAgeMinutes, 180);
  assert.equal(young.rules.entry.minLiquidityUsd, 10000);
  assert.equal(young.rules.entry.minVolumeH1Usd, 2000);
  const fallback = pickTemplate("hello there");
  assert.equal(fallback.templateId, "paper-hands");
  const loud = pickTemplate("busy volume only");
  assert.equal(loud.templateId, "loud-floor");
});

test("JSON rules parse and clamp", () => {
  const rules = parseRulesText("sure\n```json\n" + JSON.stringify({
    name: "  Wide  ",
    entry: { minPriceChangeH1Pct: 40, maxPriceChangeH1Pct: 5, minBuysSellsRatio: 1.5 },
    positionSizeSol: 99,
    takeProfitPct: 0,
    stopLossPct: 200,
    maxHoldMinutes: 9
  }));
  assert.equal(rules.name, "Wide");
  assert.equal(rules.positionSizeSol, 5);
  assert.equal(rules.takeProfitPct, 1);
  assert.equal(rules.stopLossPct, 90);
  assert.equal(rules.entry.minPriceChangeH1Pct, 5);
  assert.equal(rules.entry.maxPriceChangeH1Pct, 40);
  assert.match(rulesToJson(rules), /"name": "Wide"/);
  assert.throws(() => parseRulesText("no object here"), /JSON/);
});

test("entry match fails closed when a figure is missing", () => {
  const rules = sanitizeRules({
    entry: { minLiquidityUsd: 1000, maxTokenAgeMinutes: 60 },
    positionSizeSol: 0.2,
    takeProfitPct: 10,
    stopLossPct: 10,
    maxHoldMinutes: 30
  });
  assert.equal(entryMatches({
    liquidityUsd: 5000,
    ageMinutes: 10,
    priceChangeH1: 1,
    volumeH1: 1,
    volumeH24: 1,
    buysSellsRatio: 2
  }, rules), true);
  assert.equal(entryMatches({ liquidityUsd: 5000, ageMinutes: null }, rules), false);
  assert.equal(entryMatches({ liquidityUsd: 100, ageMinutes: 10 }, rules), false);
});

test("live step opens, then folds on a stop", () => {
  const rules = sanitizeRules({
    name: "Test",
    entry: { minLiquidityUsd: 100 },
    positionSizeSol: 1,
    takeProfitPct: 25,
    stopLossPct: 10,
    maxHoldMinutes: 60
  });
  const book = freshBook(1_000);
  const pair = {
    pairAddress: "pair1",
    baseSymbol: "APE",
    baseAddress: "mint",
    priceUsd: 10,
    liquidityUsd: 5000,
    volumeH1: 100,
    volumeH24: 100,
    priceChangeH1: 3,
    buysSellsRatio: 2,
    ageMinutes: 5
  };
  const opened = stepBook(book, rules, [pair], 1_000);
  assert.equal(opened.opened.length, 1);
  assert.equal(book.cashSol, 9);
  const dropped = { ...pair, priceUsd: 8 };
  const closed = stepBook(book, rules, [dropped], 1_000 + 60_000);
  assert.equal(closed.closed.length, 1);
  assert.equal(closed.closed[0].reason, "stop");
  assert.equal(closed.closed[0].line, CLOSE_COPY.stop);
  assert.ok(closed.closed[0].changeSol < 0);
  assert.ok(book.cashSol < 10);
  assert.equal(book.positions.length, 0);
});

test("replay folds first when a candle touches both sides", () => {
  const rules = sanitizeRules({
    name: "Replay",
    entry: { minLiquidityUsd: 999999, minBuysSellsRatio: 3 },
    positionSizeSol: 1,
    takeProfitPct: 10,
    stopLossPct: 10,
    maxHoldMinutes: 1000
  });
  const candles = [
    { t: 0, open: 100, high: 100, low: 100, close: 100, volume: 10 },
    { t: 3600, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { t: 7200, open: 100, high: 130, low: 70, close: 100, volume: 10 }
  ];
  const result = replayCandles(rules, candles, {
    poolAddress: "pool",
    symbol: "BONK",
    poolCreatedAt: "2020-01-01T00:00:00Z",
    barMinutes: 60
  });
  assert.deepEqual(result.skipped.sort(), ["buys/sells ratio", "liquidity"]);
  assert.equal(result.book.trades[0].reason, "stopFirst");
  assert.equal(result.book.trades[0].line, CLOSE_COPY.stopFirst);
  assert.ok(result.book.trades[0].changePct < 0);
});

test("dex pair normalization", () => {
  const pair = normalizePair({
    chainId: "solana",
    pairAddress: "abc",
    priceUsd: "0.5",
    baseToken: { symbol: "FOLD", address: "mint" },
    quoteToken: { symbol: "SOL" },
    liquidity: { usd: 1200 },
    volume: { h24: 50, h1: 10 },
    priceChange: { h1: -3.5 },
    txns: { h1: { buys: 4, sells: 2 } },
    pairCreatedAt: Date.now() - 60_000
  });
  assert.equal(pair.baseSymbol, "FOLD");
  assert.equal(pair.buysSellsRatio, 2);
  assert.equal(pair.priceChangeH1, -3.5);
  assert.ok(pair.ageMinutes > 0.5 && pair.ageMinutes < 2);
  assert.equal(normalizePair({ chainId: "ethereum", pairAddress: "x", priceUsd: "1" }), null);
});

test("tweetnacl verifies a holder message and rejects a swap", () => {
  const kp = nacl.sign.keyPair();
  const owner = encodeBase58(kp.publicKey);
  const message = holderMessage(owner, "nonce", "$QUESTO");
  const encoded = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(encoded, kp.secretKey);
  assert.equal(verifyHolderSignature(message, signature, kp.publicKey), true);
  const other = nacl.sign.keyPair();
  assert.equal(verifyHolderSignature(message, signature, other.publicKey), false);
  assert.match(message, /not a transaction/i);
  assert.match(message, /seed phrase/i);
});

test("token balance counts Token-2022 once and ignores other mints", () => {
  const mint = QUESTO_MINT;
  const raw = balanceFromParsedAccounts([
    { value: [{ pubkey: "a", account: { data: { parsed: { info: { mint, tokenAmount: { amount: "1000000" } } } } } }] },
    { value: [
      { pubkey: "a", account: { data: { parsed: { info: { mint, tokenAmount: { amount: "1000000" } } } } } },
      { pubkey: "b", account: { data: { parsed: { info: { mint, tokenAmount: { amount: "5000000" } } } } } },
      { pubkey: "c", account: { data: { parsed: { info: { mint: "other", tokenAmount: { amount: "9" } } } } } }
    ] }
  ], mint);
  assert.equal(raw, 6000000n);
  assert.equal(holderMinRaw(QUESTO_HOLDER_MIN, 6), 1000000000000n);
  assert.equal(FOLD_MINT, null);
});

test("SOL payment counts loaded addresses and rejects stale or short payments", () => {
  const now = Date.now();
  const tx = {
    blockTime: Math.floor(now / 1000),
    meta: {
      err: null,
      preBalances: [1_000, 0],
      postBalances: [1_000, 50_000_000],
      loadedAddresses: { writable: [PAY], readonly: [] }
    },
    transaction: { message: { accountKeys: [{ pubkey: "payer" }] } }
  };
  assert.equal(collectAccountKeys(tx)[1], PAY);
  assert.equal(recipientGainLamports(tx, PAY), 50_000_000);
  assert.equal(assessPayment(tx, now), 50_000_000);
  const old = { ...tx, blockTime: Math.floor(now / 1000) - 8 * 24 * 3600 };
  assert.throws(() => assessPayment(old, now), /7 days/);
  const short = structuredClone(tx);
  short.meta.postBalances = [1_000, 1_000];
  assert.throws(() => assessPayment(short, now), /0\.05 SOL/);
  const failed = structuredClone(tx);
  failed.meta.err = { InstructionError: [0, "oops"] };
  assert.throws(() => assessPayment(failed, now), /succeed/);
  assert.equal(extractSignature("https://solscan.io/tx/" + "1".repeat(88)), "1".repeat(88));
  assert.equal(grantDue({ checkedAt: now, nextCheckAt: 0 }, now + 60_000), false);
  assert.equal(grantDue({ checkedAt: now - 25 * 60 * 60 * 1000, nextCheckAt: 0 }, now), true);
});
