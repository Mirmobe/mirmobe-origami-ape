// Coin config for Origami Ape. Tiers, mints, and the unlock address live here.

export const APP = {
  name: "Origami Ape",
  siteUrl: "https://mirmobe.github.io/mirmobe-origami-ape/",
  taglines: [
    "Let your AI get rekt so you don't.",
    "Paper hands, real lessons.",
    "Fold before you hold."
  ]
};

export const TIERS = {
  freeAgents: 1,
  fullAgents: 5,
  startingFakeSol: 10,
  maxOpenPositions: 3,
  maxTrades: 80,
  reentryCooldownMs: 15 * 60 * 1000
};

export const UNLOCK = {
  priceSol: 0.05,
  paymentAddress: "5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP",
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  lamportsPerSol: 1_000_000_000
};

// $FOLD is not launched. While FOLD_MINT is null the holder UI stays hidden.
export const FOLD_MINT = null;
export const FOLD_HOLDER_MIN = 1_000_000;
export const FOLD_DECIMALS = 6;

export const QUESTO_MINT = "5eCknU1RcP4QwWXCYicE4VGG8KY69TTUL7YZTma4pump";
export const QUESTO_HOLDER_MIN = 1_000_000;
export const QUESTO_DECIMALS = 6;
export const QUESTO_BUY_URL = "https://pump.fun/coin/5eCknU1RcP4QwWXCYicE4VGG8KY69TTUL7YZTma4pump";

export const SOLANA_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana"
];

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const DEX = {
  minIntervalMs: 250,
  profilesTtlMs: 60_000,
  pairsTtlMs: 45_000,
  scanEveryMs: 20_000
};

export const GECKO = {
  origin: "https://api.geckoterminal.com/api/v2",
  minIntervalMs: 13_000,
  cacheTtlMs: 15 * 60 * 1000,
  maxDiskEntries: 12
};

export const POLLINATIONS = {
  textUrl: "https://text.pollinations.ai/openai",
  textMinIntervalMs: 12_000,
  imageTimeoutMs: 22_000
};

export const WEBLLM = {
  modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  downloadMb: 280,
  cdn: "https://esm.run/@mlc-ai/web-llm@0.2.89"
};

export const HOLDER_RECHECK_MS = 24 * 60 * 60 * 1000;
export const HOLDER_RETRY_MS = 15 * 60 * 1000;

export const LS = {
  state: "oa_v1_state",
  solUnlock: "oa_v1_unlocked",
  usedSigs: "oa_v1_used_sigs",
  questo: "oa_v1_questo_holder",
  fold: "oa_v1_fold_holder",
  gecko: "oa_v1_gecko_cache"
};
