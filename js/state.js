import { LS, TIERS } from "./constants.js";
import { freshBook } from "./paper.js";
import { sanitizeRules, templateById } from "./rules.js";

const memory = { state: null };

function storage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

export function makeAgent(rules, now = Date.now()) {
  const clean = sanitizeRules(rules);
  return {
    id: crypto.randomUUID(),
    running: false,
    rules: clean,
    book: freshBook(now)
  };
}

function defaultState() {
  const agent = makeAgent(templateById("paper-hands").rules);
  return { agents: [agent], activeId: agent.id };
}

export function loadState() {
  if (memory.state) return memory.state;
  const box = storage();
  try {
    const parsed = JSON.parse((box && box.getItem(LS.state)) || "null");
    if (!parsed || !Array.isArray(parsed.agents) || !parsed.agents.length) {
      memory.state = defaultState();
    } else {
      memory.state = {
        activeId: parsed.activeId,
        agents: parsed.agents.slice(0, TIERS.fullAgents).map((agent) => ({
          id: String(agent.id || crypto.randomUUID()),
          running: false,
          rules: sanitizeRules(agent.rules),
          book: normalizeBook(agent.book)
        }))
      };
      if (!memory.state.agents.some((agent) => agent.id === memory.state.activeId)) {
        memory.state.activeId = memory.state.agents[0].id;
      }
    }
  } catch (err) {
    memory.state = defaultState();
  }
  persist();
  return memory.state;
}

function normalizeBook(book) {
  const fresh = freshBook();
  if (!book || typeof book !== "object") return fresh;
  fresh.cashSol = Number.isFinite(Number(book.cashSol)) ? Number(book.cashSol) : fresh.cashSol;
  fresh.createdAt = Number(book.createdAt) || fresh.createdAt;
  fresh.positions = Array.isArray(book.positions) ? book.positions.slice(0, TIERS.maxOpenPositions) : [];
  fresh.trades = Array.isArray(book.trades) ? book.trades.slice(0, TIERS.maxTrades) : [];
  return fresh;
}

export function persist() {
  const box = storage();
  if (!box || !memory.state) return;
  try {
    box.setItem(LS.state, JSON.stringify(memory.state));
  } catch (err) { /* private mode or a full disk: keep the session copy */ }
}

export function activeAgent() {
  const state = loadState();
  return state.agents.find((agent) => agent.id === state.activeId) || state.agents[0];
}

export function setActive(id) {
  const state = loadState();
  if (state.agents.some((agent) => agent.id === id)) {
    state.activeId = id;
    persist();
  }
}
