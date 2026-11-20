import { DEX, FOLD_MINT, TIERS, UNLOCK, WEBLLM } from "./constants.js";
import { rulesToJson, parseRulesText, pickTemplate, sanitizeRules, TEMPLATES, templateById } from "./rules.js";
import { bookSnapshot, freshBook, replayCandles, stepBook } from "./paper.js";
import { activeAgent, loadState, makeAgent, persist, setActive } from "./state.js";
import { candlesForPool, loadSolanaMarket, poolsForToken, searchPools } from "./market.js";
import { enqueuePollinations, ensureBrowserModel, optInToModel, pollinationsBackdrop, rulesFromBrowserModel, webGpuAvailable } from "./ai.js";
import { cardStats, downloadCanvas, drawFoldCard, shareHref } from "./foldcard.js";
import {
  isFullUnlock,
  isOg,
  listWallets,
  QUESTO_BUY_URL,
  refreshHolderGrants,
  solanaPayUrl,
  unlockFold,
  unlockQuesto,
  verifyPaymentSignature
} from "./wallet.js";

const ENTRY_KEYS = [
  "maxTokenAgeMinutes",
  "minTokenAgeMinutes",
  "minLiquidityUsd",
  "minVolumeH24Usd",
  "minVolumeH1Usd",
  "minPriceChangeH1Pct",
  "maxPriceChangeH1Pct",
  "minBuysSellsRatio"
];

let jsonFocused = false;
let watching = false;
let watchTimer = null;
let scanning = false;
let selectedPool = null;
let lastReplay = null;
let crumpleArmed = false;

function $(id) { return document.getElementById(id); }
function setStatus(id, message) {
  const node = $(id);
  if (node) node.textContent = message || "";
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function allowedAgents() {
  return isFullUnlock() ? TIERS.fullAgents : TIERS.freeAgents;
}
function fmtSol(n) {
  const value = Number(n) || 0;
  return (value < 0 ? "" : "") + value.toFixed(3);
}
function fmtPx(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
  return value.toPrecision(3);
}
function fmtWhen(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readForm() {
  const entry = {};
  ENTRY_KEYS.forEach((key) => { entry[key] = $(key).value.trim(); });
  return sanitizeRules({
    name: $("ruleName").value.trim(),
    entry,
    positionSizeSol: $("positionSizeSol").value.trim(),
    takeProfitPct: $("takeProfitPct").value.trim(),
    stopLossPct: $("stopLossPct").value.trim(),
    maxHoldMinutes: $("maxHoldMinutes").value.trim()
  });
}

function writeForm(rules) {
  const clean = sanitizeRules(rules);
  $("ruleName").value = clean.name;
  ENTRY_KEYS.forEach((key) => {
    $(key).value = clean.entry[key] == null ? "" : String(clean.entry[key]);
  });
  $("positionSizeSol").value = String(clean.positionSizeSol);
  $("takeProfitPct").value = String(clean.takeProfitPct);
  $("stopLossPct").value = String(clean.stopLossPct);
  $("maxHoldMinutes").value = String(clean.maxHoldMinutes);
  if (!jsonFocused) $("rulesJson").value = rulesToJson(clean);
}

function commitForm() {
  const agent = activeAgent();
  agent.rules = readForm();
  persist();
  renderAgentBar();
  return agent;
}

function useRules(rules, note) {
  const agent = activeAgent();
  agent.rules = sanitizeRules(rules);
  persist();
  writeForm(agent.rules);
  renderAgentBar();
  setStatus("whisperStatus", note || "Sheet updated. Edit any field. The desk uses this JSON.");
}

function renderAgentBar() {
  const bar = $("agentBar");
  const state = loadState();
  const cap = allowedAgents();
  clear(bar);
  state.agents.forEach((agent, index) => {
    const locked = index >= cap;
    const button = el("button", "slot" + (agent.id === state.activeId ? " is-on" : "") + (locked ? " is-locked" : ""));
    button.type = "button";
    button.dataset.agent = agent.id;
    if (locked) button.dataset.locked = "1";
    button.textContent = (index + 1) + ". " + agent.rules.name + (locked ? " · locked" : "");
    bar.appendChild(button);
  });
  if (state.agents.length < cap) {
    const add = el("button", "slot", "Add agent");
    add.type = "button";
    add.dataset.addAgent = "1";
    bar.appendChild(add);
  }
  for (let slot = state.agents.length; slot < TIERS.fullAgents && state.agents.length >= cap; slot += 1) {
    const locked = el("button", "slot is-locked", "Agent " + (slot + 1) + " · full sheet");
    locked.type = "button";
    locked.dataset.locked = "1";
    bar.appendChild(locked);
  }
}

function renderTemplates() {
  const grid = $("templateGrid");
  clear(grid);
  TEMPLATES.forEach((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.template = template.id;
    button.append(el("strong", "", template.name), el("span", "", template.blurb));
    grid.appendChild(button);
  });
}

function renderTier() {
  const full = isFullUnlock();
  const og = isOg();
  $("tierBadge").textContent = full ? "Full sheet" : "Free sheet · 1 agent";
  $("ogBadge").hidden = !og;
  renderAgentBar();
}

function renderDesk() {
  const agent = activeAgent();
  const snap = bookSnapshot(agent.book);
  const stats = $("deskStats");
  clear(stats);
  [
    [snap.cashSol.toFixed(3), "Fake SOL left"],
    [snap.equity.toFixed(3), "Fake book"],
    [(snap.paperChange > 0 ? "+" : "") + snap.paperChange.toFixed(3), "Paper PnL"],
    [String(agent.book.trades.length), "Folds"]
  ].forEach(([value, label]) => {
    const card = el("div", "stat");
    card.append(el("b", "", value), el("span", "", label));
    stats.appendChild(card);
  });
  const opens = $("openList");
  clear(opens);
  if (!agent.book.positions.length) {
    opens.append(el("p", "hint", "No open paper seats."));
  }
  agent.book.positions.forEach((pos) => {
    const change = pos.entryPriceUsd > 0 ? ((pos.lastPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100 : 0;
    const row = el("article");
    row.append(
      el("strong", "", pos.symbol + " · " + fmtSol(pos.sizeSol) + " fake SOL"),
      el("p", change < 0 ? "down" : "up", "In at $" + fmtPx(pos.entryPriceUsd) + " · last $" + fmtPx(pos.lastPriceUsd) + " · " + change.toFixed(1) + "% on paper")
    );
    if (pos.url) {
      const link = el("a", "", "Public pair");
      link.href = pos.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.append(link);
    }
    opens.append(row);
  });
  const log = $("tradeLog");
  clear(log);
  if (!agent.book.trades.length) {
    log.append(el("p", "hint", "No folds yet. The ape is still smoothing the sheet."));
  }
  agent.book.trades.slice(0, 20).forEach((trade) => {
    const row = el("article");
    const pct = (trade.changePct >= 0 ? "+" : "") + trade.changePct.toFixed(1) + "%";
    row.append(
      el("strong", "", trade.symbol + " · " + pct),
      el("p", trade.changeSol < 0 ? "down" : "up", trade.line + " " + fmtSol(trade.changeSol) + " fake SOL · " + fmtWhen(trade.closedAt))
    );
    log.append(row);
  });
  $("startDesk").textContent = watching ? "Desk is watching" : "Start the desk";
}

function openGate() {
  $("gateDialog").hidden = false;
}
function closeGate() {
  $("gateDialog").hidden = true;
}

function armTimer() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  if (!watching || document.hidden) return;
  watchTimer = setInterval(() => { scan({ manual: false }); }, DEX.scanEveryMs);
}

async function scan(options = {}) {
  if (scanning) {
    setStatus("deskStatus", "A look is already in flight.");
    return;
  }
  commitForm();
  const state = loadState();
  const cap = allowedAgents();
  let targets = state.agents.filter((agent, index) => agent.running && index < cap);
  if (!targets.length) {
    if (!options.manual) return;
    const active = activeAgent();
    const index = state.agents.indexOf(active);
    if (index >= cap) {
      openGate();
      return;
    }
    targets = [active];
  }
  scanning = true;
  setStatus("deskStatus", "Reading DexScreener… public prices, fake seats.");
  try {
    const extras = [];
    targets.forEach((agent) => agent.book.positions.forEach((pos) => extras.push(pos.baseAddress)));
    const pairs = await loadSolanaMarket(extras);
    const now = Date.now();
    let opened = 0;
    let closed = 0;
    targets.forEach((agent) => {
      const step = stepBook(agent.book, agent.rules, pairs, now);
      opened += step.opened.length;
      closed += step.closed.length;
    });
    persist();
    renderDesk();
    const noun = pairs.length === 1 ? "pair" : "pairs";
    const idle = opened + closed === 0 ? " No new fold. The ape sat on its hands." : "";
    setStatus("deskStatus", "Looked at " + pairs.length + " Solana " + noun + ". Opened " + opened + ". Closed " + closed + "." + idle);
  } catch (err) {
    setStatus("deskStatus", err && err.message ? err.message : "The desk could not read prices.");
  } finally {
    scanning = false;
  }
}

function chooseWallet(list) {
  const box = $("questoWallets");
  box.hidden = false;
  clear(box);
  return new Promise((resolve) => {
    list.forEach((entry) => {
      const button = el("button", "", entry.name);
      button.type = "button";
      button.addEventListener("click", () => {
        box.hidden = true;
        resolve(entry);
      });
      box.appendChild(button);
    });
  });
}

function mountFoldUnlock() {
  const mount = $("foldMount");
  clear(mount);
  if (!FOLD_MINT) return;
  mount.append(el("h3", "", "$FOLD holders"));
  const button = el("button", "", "I hold $FOLD — sign a message");
  button.type = "button";
  button.id = "foldUnlock";
  button.addEventListener("click", async () => {
    await runHolderUnlock("fold", unlockFold, button);
  });
  mount.append(button);
}

async function runHolderUnlock(kind, unlock, button) {
  const wallets = listWallets();
  const statusId = kind === "fold" ? "foldStatus" : "questoStatus";
  if (!wallets.length) {
    setStatus(statusId, "No Solana wallet was found. Install Phantom, or another wallet that can sign a message, then refresh. This app never asks for a seed phrase or a private key.");
    return;
  }
  button.disabled = true;
  setStatus(statusId, wallets.length > 1 ? "Choose a wallet. You will sign a message, not a transaction." : "Confirm the message in your wallet. No SOL is spent.");
  try {
    const entry = wallets.length === 1 ? wallets[0] : await chooseWallet(wallets);
    const result = await unlock(entry);
    setStatus(statusId, result.message);
    renderTier();
  } catch (err) {
    if (err && err.name === "AbortError") setStatus(statusId, "Cancelled. Nothing was sent.");
    else setStatus(statusId, err && err.message ? err.message : "The holder check could not finish.");
  } finally {
    button.disabled = false;
  }
}

function currentCardStats() {
  const agent = activeAgent();
  if ($("cardSource").checked && lastReplay) {
    return cardStats({ rules: agent.rules, book: lastReplay.book }, lastReplay);
  }
  return cardStats(agent, null);
}

async function redrawCard() {
  const stats = currentCardStats();
  $("shareX").href = shareHref(stats);
  let backdrop = null;
  if ($("cardBackdrop").checked) {
    setStatus("cardStatus", "Asking Pollinations for a paper backdrop…");
    try {
      backdrop = await pollinationsBackdrop("origami ape folded from cream paper, dark trench alley, neon magenta and cyan, paper craft, no letters");
      setStatus("cardStatus", "Backdrop in. The watermark stays on the card.");
    } catch (err) {
      setStatus("cardStatus", "Backdrop failed. Drew a local paper scene instead.");
    }
  } else {
    setStatus("cardStatus", "Local paper. Watermark is on the card.");
  }
  await drawFoldCard($("foldCanvas"), stats, backdrop);
}

function poolButton(pool) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.pool = pool.address;
  if (selectedPool && selectedPool.address === pool.address) button.className = "is-on";
  const reserve = pool.reserveUsd ? " · ~$" + Math.round(pool.reserveUsd).toLocaleString("en-US") + " reserve" : "";
  button.textContent = pool.name + reserve;
  button.addEventListener("click", () => {
    selectedPool = pool;
    renderPools(lastPools);
  });
  return button;
}

let lastPools = [];
function renderPools(pools) {
  lastPools = pools;
  const list = $("poolList");
  clear(list);
  pools.forEach((pool) => list.append(poolButton(pool)));
}

function looksLikeAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

async function findPools() {
  const query = $("replayQuery").value.trim();
  const kind = $("replayKind").value;
  if (!query) {
    setStatus("replayStatus", "Type a token, a pool, or a name.");
    return;
  }
  $("replayFind").disabled = true;
  setStatus("replayStatus", "Asking GeckoTerminal. Calls are spaced so we stay near five a minute.");
  try {
    const pace = (left) => {
      setStatus("replayStatus", "Waiting about " + Math.ceil(left / 1000) + "s for GeckoTerminal.");
    };
    const asPool = {
      address: query,
      name: query.slice(0, 4) + "…" + query.slice(-4),
      createdAt: null,
      reserveUsd: 0
    };
    let pools = [];
    if (kind === "pool") {
      pools = [asPool];
    } else if (!looksLikeAddress(query)) {
      pools = await searchPools(query, pace);
    } else {
      try {
        pools = await poolsForToken(query, pace);
      } catch (err) {
        pools = [];
      }
      if (!pools.length) {
        pools = [asPool];
        setStatus("replayStatus", "That address did not list token pools. You can walk it as a pool.");
      }
    }
    selectedPool = pools[0] || null;
    renderPools(pools);
    if (!pools.length) setStatus("replayStatus", "No Solana pools came back for that.");
    else setStatus("replayStatus", "Pick a pool, then walk the candles. " + pools.length + " shown.");
  } catch (err) {
    setStatus("replayStatus", err && err.message ? err.message : "The pool search failed.");
  } finally {
    $("replayFind").disabled = false;
  }
}

function renderReplay(result) {
  const out = $("replayOut");
  clear(out);
  const snap = bookSnapshot(result.book);
  const summary = el("article");
  summary.append(
    el("strong", "", "Walked " + result.bars + " candles"),
    el("p", "", snap.equity.toFixed(3) + " fake SOL in the book · paper change " + (snap.paperChange > 0 ? "+" : "") + snap.paperChange.toFixed(3) + " · " + result.book.trades.length + " folds · " + result.book.positions.length + " still open")
  );
  if (result.skipped.length) {
    summary.append(el("p", "", "Skipped on replay: " + result.skipped.join(", ") + ". Those figures are not in the candles."));
  }
  if (result.blockedByAge) {
    summary.append(el("p", "", "The sheet asks for token age, and this pool did not include a creation time, so no seat was taken."));
  }
  out.append(summary);
  result.book.trades.slice(0, 12).forEach((trade) => {
    const row = el("article");
    row.append(
      el("strong", "", trade.symbol + " · " + trade.changePct.toFixed(1) + "%"),
      el("p", trade.changeSol < 0 ? "down" : "up", trade.line + " " + fmtWhen(trade.closedAt))
    );
    out.append(row);
  });
}

async function runReplay() {
  if (!selectedPool) {
    setStatus("replayStatus", "Find a pool first.");
    return;
  }
  commitForm();
  const agent = activeAgent();
  $("replayGo").disabled = true;
  $("replayTrack").hidden = false;
  $("replayBar").style.width = "15%";
  setStatus("replayStatus", "Fetching candles. Cached looks are instant. Fresh looks wait for the pace limit.");
  try {
    const loaded = await candlesForPool(selectedPool.address, $("replayTf").value, (left) => {
      $("replayBar").style.width = "40%";
      setStatus("replayStatus", "GeckoTerminal pace: about " + Math.ceil(left / 1000) + "s. The candles are worth the wait.");
    });
    $("replayBar").style.width = "75%";
    const result = replayCandles(agent.rules, loaded.candles, {
      poolAddress: selectedPool.address,
      symbol: (selectedPool.name || "TOKEN").split(" / ")[0],
      poolCreatedAt: selectedPool.createdAt,
      barMinutes: loaded.barMinutes,
      url: "https://www.geckoterminal.com/solana/pools/" + selectedPool.address
    });
    lastReplay = result;
    $("replayBar").style.width = "100%";
    renderReplay(result);
    const cacheNote = loaded.fromCache ? " Served from the cache on this device." : "";
    setStatus("replayStatus", "Replay finished." + cacheNote);
    if ($("cardSource").checked) redrawCard();
  } catch (err) {
    setStatus("replayStatus", err && err.message ? err.message : "Replay could not finish.");
  } finally {
    $("replayGo").disabled = false;
    setTimeout(() => { $("replayTrack").hidden = true; }, 600);
  }
}

function bind() {
  $("agentBar").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.locked) {
      openGate();
      return;
    }
    if (button.dataset.addAgent) {
      const state = loadState();
      if (state.agents.length >= allowedAgents()) {
        openGate();
        return;
      }
      const agent = makeAgent(templateById("paper-hands").rules);
      state.agents.push(agent);
      state.activeId = agent.id;
      persist();
      writeForm(agent.rules);
      renderAgentBar();
      renderDesk();
      return;
    }
    if (button.dataset.agent) {
      commitForm();
      setActive(button.dataset.agent);
      writeForm(activeAgent().rules);
      renderAgentBar();
      renderDesk();
    }
  });

  $("templateGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-template]");
    if (!button) return;
    const template = templateById(button.dataset.template);
    useRules(template.rules, "Using the “" + template.name + "” template. No model involved.");
  });

  $("matchTemplateBtn").addEventListener("click", () => {
    const text = $("strategyText").value.trim();
    if (!text) {
      setStatus("whisperStatus", "Write a sentence, or tap a template card.");
      return;
    }
    const picked = pickTemplate(text);
    useRules(picked.rules, picked.note);
  });

  $("rulesForm").addEventListener("input", () => {
    const agent = activeAgent();
    agent.rules = readForm();
    persist();
    if (!jsonFocused) $("rulesJson").value = rulesToJson(agent.rules);
    renderAgentBar();
  });

  $("rulesJson").addEventListener("focus", () => { jsonFocused = true; });
  $("rulesJson").addEventListener("blur", () => { jsonFocused = false; });
  $("applyJson").addEventListener("click", () => {
    try {
      useRules(parseRulesText($("rulesJson").value), "JSON applied to the active agent.");
    } catch (err) {
      setStatus("whisperStatus", err.message);
    }
  });

  $("optInModel").addEventListener("click", async () => {
    if (!webGpuAvailable()) return;
    optInToModel();
    $("optInModel").disabled = true;
    setStatus("whisperStatus", "Downloading " + WEBLLM.modelId + " (~" + WEBLLM.downloadMb + " MB). It stays in this browser.");
    try {
      await ensureBrowserModel((line) => setStatus("whisperStatus", line));
      $("runBrowser").disabled = false;
      setStatus("whisperStatus", "Model ready. Fold the sentence whenever you want.");
    } catch (err) {
      $("optInModel").disabled = false;
      setStatus("whisperStatus", (err && err.message ? err.message : "The model did not load.") + " Templates and Pollinations still work.");
    }
  });

  $("runBrowser").addEventListener("click", async () => {
    const text = $("strategyText").value.trim();
    if (!text) {
      setStatus("whisperStatus", "Write the strategy first.");
      return;
    }
    $("runBrowser").disabled = true;
    try {
      const rules = await rulesFromBrowserModel(text, (line) => setStatus("whisperStatus", line));
      useRules(rules, "Browser model drafted this sheet. Read it before the desk uses it.");
    } catch (err) {
      setStatus("whisperStatus", err && err.message ? err.message : "The browser model failed.");
    } finally {
      $("runBrowser").disabled = false;
    }
  });

  $("pollinationsBtn").addEventListener("click", async () => {
    const text = $("strategyText").value.trim();
    if (!text) {
      setStatus("whisperStatus", "Write the strategy first.");
      return;
    }
    $("pollinationsBtn").disabled = true;
    setStatus("whisperStatus", "Queued for Pollinations. Your sentence leaves this device. The line moves slowly on purpose.");
    try {
      const rules = await enqueuePollinations(text, (left) => {
        setStatus("whisperStatus", "Waiting in the Pollinations queue, about " + Math.ceil(left / 1000) + "s, so we do not trip the rate limit.");
      });
      useRules(rules, "Pollinations drafted this sheet. It is editable. Check it before the desk runs.");
    } catch (err) {
      setStatus("whisperStatus", (err && err.message ? err.message : "Pollinations failed.") + " A template still works offline.");
    } finally {
      $("pollinationsBtn").disabled = false;
    }
  });

  $("startDesk").addEventListener("click", () => {
    const state = loadState();
    const cap = allowedAgents();
    const active = activeAgent();
    if (state.agents.indexOf(active) >= cap) {
      openGate();
      return;
    }
    state.agents.forEach((agent) => { agent.running = false; });
    active.running = true;
    watching = true;
    persist();
    armTimer();
    renderDesk();
    scan({ manual: true });
  });
  $("pauseDesk").addEventListener("click", () => {
    watching = false;
    loadState().agents.forEach((agent) => { agent.running = false; });
    persist();
    armTimer();
    setStatus("deskStatus", "Paused. The book stays on this device.");
    renderDesk();
  });
  $("scanOnce").addEventListener("click", () => scan({ manual: true }));
  $("crumpleBook").addEventListener("click", () => {
    if (!crumpleArmed) {
      crumpleArmed = true;
      $("crumpleBook").textContent = "Crumple for real?";
      setTimeout(() => {
        crumpleArmed = false;
        $("crumpleBook").textContent = "Crumple the book";
      }, 4000);
      return;
    }
    crumpleArmed = false;
    $("crumpleBook").textContent = "Crumple the book";
    activeAgent().book = freshBook();
    persist();
    renderDesk();
    setStatus("deskStatus", "Book crumpled. Back to " + TIERS.startingFakeSol + " fake SOL.");
    redrawCard();
  });

  $("replayFind").addEventListener("click", findPools);
  $("replayGo").addEventListener("click", runReplay);
  $("downloadCard").addEventListener("click", () => {
    try {
      downloadCanvas($("foldCanvas"), "origami-ape-paper-card.png");
      setStatus("cardStatus", "PNG downloaded. The watermark is in the file.");
    } catch (err) {
      setStatus("cardStatus", err.message);
    }
  });
  $("redrawCard").addEventListener("click", redrawCard);
  $("cardSource").addEventListener("change", redrawCard);
  $("cardBackdrop").addEventListener("change", redrawCard);

  $("copyAddress").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(UNLOCK.paymentAddress);
      $("copyAddress").textContent = "Copied";
      setTimeout(() => { $("copyAddress").textContent = "Copy"; }, 1400);
    } catch (err) {
      setStatus("payStatus", "Copy failed. Select the address and copy it yourself.");
    }
  });
  $("verifyPayBtn").addEventListener("click", async () => {
    $("verifyPayBtn").disabled = true;
    setStatus("payStatus", "Checking the public Solana RPCs…");
    try {
      await verifyPaymentSignature($("txSigInput").value);
      setStatus("payStatus", "Payment confirmed for this browser. Five agents are open. Apps, not investments.");
      renderTier();
    } catch (err) {
      setStatus("payStatus", err && err.message ? err.message : "Could not verify that payment.");
    } finally {
      $("verifyPayBtn").disabled = false;
    }
  });
  $("questoUnlockBtn").addEventListener("click", () => {
    runHolderUnlock("questo", unlockQuesto, $("questoUnlockBtn"));
  });
  $("gateClose").addEventListener("click", closeGate);
  $("gateUnlock").addEventListener("click", closeGate);
  $("gateDialog").addEventListener("click", (event) => {
    if (event.target === $("gateDialog")) closeGate();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
      }
      if (watching) setStatus("deskStatus", "Tab hidden. The desk paused and will resume when you come back.");
    } else if (watching) {
      armTimer();
      scan({ manual: false });
    }
  });
}

export function init() {
  loadState();
  $("payAddress").textContent = UNLOCK.paymentAddress;
  $("payAmount").textContent = UNLOCK.priceSol + " SOL";
  $("payLink").href = solanaPayUrl();
  $("questoBuyLink").href = QUESTO_BUY_URL;
  const gpu = webGpuAvailable();
  $("webgpuNote").textContent = gpu
    ? "WebGPU is on. " + WEBLLM.modelId + " is about " + WEBLLM.downloadMb + " MB to download, plus a small runtime, and it needs roughly 1 GB of GPU memory. Nothing in that download is sent as your strategy."
    : "No WebGPU in this browser, so the on-device model stays off. Templates need no download. Pollinations is the keyless fallback.";
  $("optInModel").disabled = !gpu;
  $("optInModel").textContent = "Download the on-device model (~" + WEBLLM.downloadMb + " MB)";
  renderTemplates();
  writeForm(activeAgent().rules);
  renderTier();
  renderDesk();
  mountFoldUnlock();
  bind();
  redrawCard();
  refreshHolderGrants().then(renderTier).catch(() => {});
}
