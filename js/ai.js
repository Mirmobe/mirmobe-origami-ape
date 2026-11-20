// In-browser WebLLM after an explicit download opt-in, else queued Pollinations text.

import { POLLINATIONS, WEBLLM } from "./constants.js";
import { parseRulesText } from "./rules.js";

const SYSTEM = [
  "You convert a plain-English paper-trading rule into JSON for a fake-money simulator.",
  "Reply with one JSON object and no markdown.",
  "Shape:",
  '{"name":"short name","entry":{"maxTokenAgeMinutes":null,"minTokenAgeMinutes":null,"minLiquidityUsd":null,"minVolumeH24Usd":null,"minVolumeH1Usd":null,"minPriceChangeH1Pct":null,"maxPriceChangeH1Pct":null,"minBuysSellsRatio":null},"positionSizeSol":0.25,"takeProfitPct":20,"stopLossPct":12,"maxHoldMinutes":30}',
  "Use null for any filter the person did not mention.",
  "positionSizeSol is fake SOL from 0.05 to 2.",
  "takeProfitPct and stopLossPct are positive exit levels.",
  "maxHoldMinutes is from 5 to 1440.",
  "Do not add advice, prices, or extra keys."
].join(" ");

let optedIn = false;
let enginePromise = null;
let textChain = Promise.resolve();
let textNextAt = 0;

export function webGpuAvailable() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

export function modelOptedIn() {
  return optedIn;
}

export function browserModelReady() {
  return !!enginePromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureBrowserModel(onProgress) {
  if (!webGpuAvailable()) {
    throw new Error("This browser has no WebGPU, so the on-device model stays off.");
  }
  if (!optedIn) {
    throw new Error("Download the model first. It is about " + WEBLLM.downloadMb + " MB and stays in this browser.");
  }
  if (!enginePromise) {
    const pending = (async () => {
      const mod = await import(WEBLLM.cdn);
      const create = mod.CreateMLCEngine || (mod.default && mod.default.CreateMLCEngine);
      if (typeof create !== "function") throw new Error("The WebLLM module did not load.");
      return create(WEBLLM.modelId, {
        initProgressCallback: (report) => {
          if (!onProgress) return;
          const pct = Math.round(((report && report.progress) || 0) * 100);
          const text = (report && report.text) || "Loading the model";
          onProgress(pct + "% · " + text);
        }
      });
    })();
    enginePromise = pending;
    try {
      await pending;
    } catch (err) {
      enginePromise = null;
      throw err;
    }
  }
  return enginePromise;
}

export function optInToModel() {
  optedIn = true;
}

export async function rulesFromBrowserModel(prompt, onProgress) {
  const engine = await ensureBrowserModel(onProgress);
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: String(prompt || "").slice(0, 800) }
    ],
    temperature: 0.2,
    max_tokens: 400
  });
  const text = reply && reply.choices && reply.choices[0] && reply.choices[0].message
    ? reply.choices[0].message.content
    : "";
  return parseRulesText(text);
}

function unwrapModelText(raw) {
  const text = String(raw || "").trim();
  try {
    const parsed = JSON.parse(text);
    const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
      ? parsed.choices[0].message.content
      : "";
    if (typeof content === "string" && content.trim()) return content;
  } catch (err) { /* a plain text reply is already the sheet */ }
  return text;
}

async function postPollinations(prompt) {
  const res = await fetch(POLLINATIONS.textUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: String(prompt || "").slice(0, 800) }
      ],
      model: "openai",
      jsonMode: true
    })
  });
  if (res.status === 429) {
    const error = new Error("Pollinations is rate-limiting. The queue will wait and you can retry.");
    error.code = 429;
    throw error;
  }
  if (!res.ok) throw new Error("Pollinations replied " + res.status + ".");
  const text = unwrapModelText(await res.text());
  if (text.includes("{")) return text;
  const fallback = "https://text.pollinations.ai/" + encodeURIComponent(
    "Reply with JSON only for a fake paper-trading rule. " + String(prompt || "").slice(0, 500)
  );
  const again = await fetch(fallback);
  if (!again.ok) throw new Error("Pollinations replied " + again.status + ".");
  return again.text();
}

export function enqueuePollinations(prompt, onWait) {
  const job = async () => {
    while (Date.now() < textNextAt) {
      const left = textNextAt - Date.now();
      if (onWait) onWait(left);
      await sleep(Math.min(400, left));
    }
    textNextAt = Date.now() + POLLINATIONS.textMinIntervalMs;
    try {
      const text = await postPollinations(prompt);
      return parseRulesText(text);
    } catch (err) {
      if (err && err.code === 429) textNextAt = Date.now() + POLLINATIONS.textMinIntervalMs * 2;
      throw err;
    }
  };
  const promise = textChain.then(job, job);
  textChain = promise.then(() => {}, () => {});
  return promise;
}

export async function pollinationsBackdrop(prompt) {
  const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt)
    + "?width=1200&height=675&nologo=true&model=flux";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLLINATIONS.imageTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Backdrop replied " + res.status);
    const blob = await res.blob();
    if (!blob.size || (blob.type && !blob.type.startsWith("image/"))) {
      throw new Error("Backdrop was not an image.");
    }
    return await createImageBitmap(blob);
  } finally {
    clearTimeout(timer);
  }
}
