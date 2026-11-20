// Wallet proof for holder unlocks, and the 0.05 SOL payment check.
// The wallet signs a message. This file never asks for a seed or a private key.
// Trades are paper-only and are not signed.

import { nacl } from "./vendor/nacl.js";
import {
  FOLD_DECIMALS,
  FOLD_HOLDER_MIN,
  FOLD_MINT,
  HOLDER_RECHECK_MS,
  HOLDER_RETRY_MS,
  LS,
  QUESTO_BUY_URL,
  QUESTO_DECIMALS,
  QUESTO_HOLDER_MIN,
  QUESTO_MINT,
  SOLANA_RPCS,
  TOKEN_2022_PROGRAM,
  UNLOCK
} from "./constants.js";

export { QUESTO_BUY_URL, FOLD_MINT };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const standardWallets = [];
let standardListening = false;

function listenForStandardWallets() {
  if (standardListening || typeof window === "undefined") return;
  standardListening = true;
  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const api = event.detail;
    if (typeof api !== "function") return;
    try {
      api({
        register(wallet) {
          const features = wallet && wallet.features;
          if (!features || !features["solana:signMessage"]) return;
          if (standardWallets.includes(wallet)) return;
          standardWallets.push(wallet);
        }
      });
    } catch (err) { /* skip a wallet that fails to register */ }
  });
  try { window.dispatchEvent(new Event("wallet-standard:app-ready")); } catch (err) { /* ignore */ }
}

if (typeof window !== "undefined") listenForStandardWallets();

export function encodeBase58(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) zeros += 1;
  const size = (((input.length - zeros) * 138) / 100 + 1) | 0;
  const bins = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < input.length; i += 1) {
    let carry = input[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
      carry += 256 * bins[k];
      bins[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = size - length;
  while (it < size && bins[it] === 0) it += 1;
  let out = "1".repeat(zeros);
  for (; it < size; it += 1) out += B58[bins[it]];
  return out || "1";
}

export function decodeBase58(text) {
  const value = String(text || "");
  if (!value) return new Uint8Array();
  const bytes = [0];
  for (let i = 0; i < value.length; i += 1) {
    const index = B58.indexOf(value[i]);
    if (index < 0) throw new Error("That address is not valid.");
    let carry = index;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function holderMessage(owner, nonce, tokenName) {
  return [
    "Origami Ape holder check",
    "",
    "Sign this message to prove you control this wallet.",
    "The app will then read the public " + tokenName + " balance for this address.",
    "This is not a transaction. No SOL is spent and nothing is approved.",
    "It unlocks Origami Ape only. Paper trades stay fake.",
    "This app never asks for a seed phrase or a private key.",
    "",
    "Wallet: " + owner,
    "Token: " + tokenName,
    "Nonce: " + nonce
  ].join("\n");
}

function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return encodeBase58(bytes);
}

function keyBytes(publicKey) {
  if (!publicKey) return null;
  if (publicKey instanceof Uint8Array) return publicKey;
  if (typeof publicKey.toBytes === "function") return publicKey.toBytes();
  if (Array.isArray(publicKey)) return new Uint8Array(publicKey);
  return null;
}

export function verifyHolderSignature(message, signature, publicKey) {
  const encoded = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
  const key = keyBytes(publicKey);
  if (!key || key.length !== 32 || sig.length !== 64) return false;
  return nacl.sign.detached.verify(encoded, sig, key);
}

function cancelled(err) {
  if (!err) return false;
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return true;
  return /reject|cancel|declin|denied/i.test(String(err.message || ""));
}

function addInjected(list, name, provider) {
  if (!provider || typeof provider.signMessage !== "function") return;
  if (list.some((item) => item.provider === provider)) return;
  list.push({ name, kind: "injected", provider });
}

export function listWallets() {
  listenForStandardWallets();
  const list = [];
  if (typeof window === "undefined") return list;
  const phantom = window.phantom && window.phantom.solana;
  if (phantom && phantom.isPhantom) addInjected(list, "Phantom", phantom);
  if (window.solflare) addInjected(list, "Solflare", window.solflare);
  if (window.backpack) addInjected(list, "Backpack", window.backpack);
  const generic = window.solana;
  if (generic && generic !== phantom) {
    const name = generic.isPhantom ? "Phantom" : (generic.isSolflare ? "Solflare" : "Wallet");
    addInjected(list, name, generic);
  }
  const names = new Set(list.map((item) => item.name));
  standardWallets.forEach((wallet) => {
    if (names.has(wallet.name)) return;
    list.push({ name: wallet.name || "Wallet", kind: "standard", wallet });
  });
  return list;
}

async function proveInjected(provider, tokenName) {
  if (typeof provider.signMessage !== "function") {
    throw new Error("This wallet cannot sign a message. The check does not send a transaction.");
  }
  const connected = await provider.connect();
  const publicKey = (connected && connected.publicKey) || provider.publicKey;
  const bytes = keyBytes(publicKey);
  if (!bytes) throw new Error("The wallet did not share an address.");
  const owner = encodeBase58(bytes);
  const message = holderMessage(owner, randomNonce(), tokenName);
  const encoded = new TextEncoder().encode(message);
  const signed = await provider.signMessage(encoded, "utf8");
  const signature = signed && signed.signature ? signed.signature : signed;
  const returned = signed && signed.publicKey ? keyBytes(signed.publicKey) : bytes;
  if (!returned || encodeBase58(returned) !== owner) {
    throw new Error("The wallet returned a different address than the one it connected.");
  }
  if (!verifyHolderSignature(encoded, signature, returned)) {
    throw new Error("The wallet signature did not verify.");
  }
  return owner;
}

async function proveStandard(wallet, tokenName) {
  const features = wallet.features || {};
  const connect = features["standard:connect"];
  const sign = features["solana:signMessage"];
  if (!sign || typeof sign.signMessage !== "function") {
    throw new Error("This wallet cannot sign a message. The check does not send a transaction.");
  }
  if (connect && typeof connect.connect === "function") await connect.connect();
  const account = (wallet.accounts || [])[0];
  if (!account || !account.address || !account.publicKey) {
    throw new Error("The wallet did not share an account.");
  }
  const owner = account.address;
  if (encodeBase58(account.publicKey) !== owner) {
    throw new Error("The wallet account does not match its address.");
  }
  const message = holderMessage(owner, randomNonce(), tokenName);
  const encoded = new TextEncoder().encode(message);
  const [result] = await sign.signMessage({ account, message: encoded });
  if (!result || !verifyHolderSignature(encoded, result.signature, account.publicKey)) {
    throw new Error("The wallet signature did not verify.");
  }
  return owner;
}

export async function proveWallet(entry, tokenName) {
  try {
    if (entry.kind === "standard") return await proveStandard(entry.wallet, tokenName);
    return await proveInjected(entry.provider, tokenName);
  } catch (err) {
    if (cancelled(err)) {
      const error = new Error("The wallet request was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    throw err;
  }
}

export function balanceFromParsedAccounts(results, mint) {
  const seen = new Set();
  let raw = 0n;
  const lists = Array.isArray(results) ? results : [results];
  lists.forEach((result) => {
    const rows = (result && result.value) || [];
    rows.forEach((row) => {
      if (!row || seen.has(row.pubkey)) return;
      seen.add(row.pubkey);
      const info = row.account && row.account.data && row.account.data.parsed && row.account.data.parsed.info;
      if (!info || info.mint !== mint) return;
      const amount = info.tokenAmount && info.tokenAmount.amount;
      if (typeof amount !== "string" || !/^\d+$/.test(amount)) return;
      raw += BigInt(amount);
    });
  });
  return raw;
}

export function holderMinRaw(whole, decimals) {
  return BigInt(whole) * (10n ** BigInt(decimals));
}

export function formatTokens(raw, decimals) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return whole.toString() + (frac ? "." + frac : "");
}

function busyError() {
  return new Error("The public Solana network is busy. Wait a moment and try again.");
}

function downError() {
  return new Error("The public Solana network could not be reached. Try again in a moment.");
}

export async function rpcCall(method, params) {
  let last = downError();
  for (let i = 0; i < SOLANA_RPCS.length; i += 1) {
    try {
      const res = await fetch(SOLANA_RPCS[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      if (res.status === 429 || res.status === 503) {
        last = busyError();
        continue;
      }
      if (!res.ok) {
        last = downError();
        continue;
      }
      const body = await res.json();
      if (body.error) {
        const message = body.error.message || "";
        if (body.error.code === 429 || /rate|limit|429|congested|too many/i.test(message)) {
          last = busyError();
          continue;
        }
        last = new Error(message || "The Solana lookup failed.");
        continue;
      }
      return body.result;
    } catch (err) {
      last = downError();
    }
  }
  throw last;
}

export async function fetchMintRawBalance(owner, mint, call = rpcCall) {
  const byMint = await call("getParsedTokenAccountsByOwner", [
    owner,
    { mint },
    { commitment: "confirmed" }
  ]);
  let token2022 = { value: [] };
  try {
    token2022 = await call("getParsedTokenAccountsByOwner", [
      owner,
      { programId: TOKEN_2022_PROGRAM },
      { commitment: "confirmed" }
    ]);
  } catch (err) {
    if (!((byMint && byMint.value) || []).length) throw err;
  }
  return balanceFromParsedAccounts([byMint, token2022], mint);
}

function grantKey(kind) {
  return kind === "fold" ? LS.fold : LS.questo;
}

function readGrant(kind) {
  try {
    const parsed = JSON.parse(localStorage.getItem(grantKey(kind)) || "null");
    if (!parsed || parsed.ok !== true || typeof parsed.owner !== "string") return null;
    return {
      owner: parsed.owner,
      raw: String(parsed.raw == null ? "0" : parsed.raw),
      checkedAt: Number(parsed.checkedAt) || 0,
      nextCheckAt: Number(parsed.nextCheckAt) || 0,
      ok: true,
      kind
    };
  } catch (err) {
    return null;
  }
}

function saveGrant(kind, owner, raw) {
  const grant = { owner, raw: raw.toString(), checkedAt: Date.now(), ok: true };
  localStorage.setItem(grantKey(kind), JSON.stringify(grant));
  return grant;
}

export function clearGrant(kind) {
  localStorage.removeItem(grantKey(kind));
}

export function grantDue(grant, now = Date.now()) {
  if (!grant) return false;
  const daily = Number(grant.checkedAt || 0) + HOLDER_RECHECK_MS;
  const retry = Number(grant.nextCheckAt || 0);
  return now >= Math.max(daily, retry);
}

async function refreshGrant(kind, mint, whole, decimals) {
  const grant = readGrant(kind);
  if (!grant || !mint) return { active: false };
  if (!grantDue(grant)) return { active: true, grant };
  try {
    const raw = await fetchMintRawBalance(grant.owner, mint);
    if (raw >= holderMinRaw(whole, decimals)) return { active: true, grant: saveGrant(kind, grant.owner, raw) };
    clearGrant(kind);
    return { active: false, below: true };
  } catch (err) {
    grant.nextCheckAt = Date.now() + HOLDER_RETRY_MS;
    localStorage.setItem(grantKey(kind), JSON.stringify(grant));
    return { active: true, grant, error: err };
  }
}

export function solUnlocked() {
  try {
    return localStorage.getItem(LS.solUnlock) === "1";
  } catch (err) {
    return false;
  }
}

export function questoUnlockActive() {
  return !!readGrant("questo");
}

export function foldUnlockActive() {
  return !!FOLD_MINT && !!readGrant("fold");
}

export function isFullUnlock() {
  return solUnlocked() || questoUnlockActive() || foldUnlockActive();
}

export function isOg() {
  return questoUnlockActive();
}

export async function refreshHolderGrants() {
  const jobs = [refreshGrant("questo", QUESTO_MINT, QUESTO_HOLDER_MIN, QUESTO_DECIMALS)];
  if (FOLD_MINT) jobs.push(refreshGrant("fold", FOLD_MINT, FOLD_HOLDER_MIN, FOLD_DECIMALS));
  await Promise.all(jobs);
}

async function unlockWithMint(entry, kind, mint, whole, decimals, tokenName) {
  if (!mint) throw new Error(tokenName + " is not set up yet.");
  const owner = await proveWallet(entry, tokenName);
  const raw = await fetchMintRawBalance(owner, mint);
  if (raw < holderMinRaw(whole, decimals)) {
    return {
      ok: false,
      owner,
      message: "This wallet holds " + formatTokens(raw, decimals) + " " + tokenName
        + ". The free unlock needs " + whole.toLocaleString("en-US")
        + " or more. The 0.05 SOL app unlock is still there. Apps, not investments."
    };
  }
  saveGrant(kind, owner, raw);
  const extra = kind === "questo" ? " OG badge is on." : "";
  return {
    ok: true,
    owner,
    message: tokenName + " holder unlock is on for this browser." + extra
      + " The balance is checked about once a day. Apps, not investments."
  };
}

export function unlockQuesto(entry) {
  return unlockWithMint(entry, "questo", QUESTO_MINT, QUESTO_HOLDER_MIN, QUESTO_DECIMALS, "$QUESTO");
}

export function unlockFold(entry) {
  return unlockWithMint(entry, "fold", FOLD_MINT, FOLD_HOLDER_MIN, FOLD_DECIMALS, "$FOLD");
}

export function collectAccountKeys(tx) {
  const keys = [];
  const accountKeys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
  accountKeys.forEach((key) => {
    keys.push(typeof key === "string" ? key : key.pubkey);
  });
  const loaded = tx.meta && tx.meta.loadedAddresses;
  if (loaded) {
    (loaded.writable || []).forEach((key) => keys.push(key));
    (loaded.readonly || []).forEach((key) => keys.push(key));
  }
  return keys;
}

export function recipientGainLamports(tx, address) {
  const keys = collectAccountKeys(tx);
  const index = keys.indexOf(address);
  if (index === -1) return 0;
  const pre = (tx.meta.preBalances || [])[index];
  const post = (tx.meta.postBalances || [])[index];
  if (!Number.isFinite(pre) || !Number.isFinite(post)) return 0;
  return post - pre;
}

export function assessPayment(tx, now = Date.now()) {
  if (!tx) throw new Error("That transaction was not found yet. Wait a few seconds, then try again.");
  if (tx.meta == null || tx.meta.err) throw new Error("That transaction did not succeed on-chain.");
  const ageMs = now - ((tx.blockTime || 0) * 1000);
  if (!tx.blockTime || ageMs > UNLOCK.maxAgeMs || ageMs < -60 * 1000) {
    throw new Error("That payment is older than 7 days, or has no timestamp.");
  }
  const min = Math.round(UNLOCK.priceSol * UNLOCK.lamportsPerSol);
  const gain = recipientGainLamports(tx, UNLOCK.paymentAddress);
  if (gain < min) {
    throw new Error("That transaction did not send at least " + UNLOCK.priceSol + " SOL to the unlock address.");
  }
  return gain;
}

export function extractSignature(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const urlMatch = text.match(/(?:solscan\.io|solana\.fm|explorer\.solana\.com)\/(?:tx|transaction)\/([1-9A-HJ-NP-Za-km-z]+)/i);
  if (urlMatch) return urlMatch[1];
  const sigMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{80,90}/);
  return sigMatch ? sigMatch[0] : "";
}

function usedSignatures() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS.usedSigs) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

export async function verifyPaymentSignature(raw) {
  const signature = extractSignature(raw);
  if (!signature) throw new Error("Paste a transaction signature or an explorer link.");
  const used = usedSignatures();
  if (used.includes(signature)) throw new Error("This signature has already been used in this browser.");
  const tx = await rpcCall("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }
  ]);
  assessPayment(tx);
  const latest = usedSignatures();
  if (latest.includes(signature)) throw new Error("This signature has already been used in this browser.");
  latest.push(signature);
  localStorage.setItem(LS.usedSigs, JSON.stringify(latest));
  localStorage.setItem(LS.solUnlock, "1");
}

export function solanaPayUrl() {
  return "solana:" + UNLOCK.paymentAddress
    + "?amount=" + UNLOCK.priceSol
    + "&label=Origami%20Ape&message=Origami%20Ape%20full%20sheet";
}
