// Headless walkthrough of the static site. Needs Chrome and a local server.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = process.env.OA_URL || "http://127.0.0.1:4173/";
const outDir = process.env.OA_SHOTS || "/opt/cursor/artifacts";
const downloadDir = "/tmp/oa-dl";
const pool = "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9";

const loose = {
  name: "Loose sheet",
  entry: { minLiquidityUsd: 500 },
  positionSizeSol: 0.2,
  takeProfitPct: 80,
  stopLossPct: 80,
  maxHoldMinutes: 180
};
const replayRules = {
  name: "Replay sheet",
  entry: {},
  positionSizeSol: 1,
  takeProfitPct: 40,
  stopLossPct: 40,
  maxHoldMinutes: 60
};

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function shot(page, name) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
  return file;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("foldCanvas").dataset.watermark === "PAPER TRADE — NOT REAL");

  const footer = await page.$eval("footer", (el) => el.innerText);
  assert(footer.includes("Apps, not investments."), "missing apps line");
  assert(footer.includes("Paper trades only. Not financial advice."), "missing paper line");
  const body = await page.evaluate(() => document.body.innerText);
  assert(!body.includes("$FOLD"), "FOLD unlock should stay hidden");
  assert(await page.$("#foldUnlock") === null, "fold button rendered");
  const address = await page.$eval("#payAddress", (el) => el.textContent);
  assert(address === "5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP", "payment address");
  const note = await page.$eval("#webgpuNote", (el) => el.textContent);
  assert(/280/.test(note) || /WebGPU/.test(note), "model size or webgpu note missing: " + note);
  const opt = await page.$eval("#optInModel", (el) => el.textContent);
  assert(opt.includes("280"), "opt-in button should show the download size");

  await page.click("[data-template='fresh-crease']");
  const templated = await page.$eval("#rulesJson", (el) => el.value);
  assert(templated.includes("Fresh crease"), "template did not fill JSON");
  await page.$eval("#strategyText", (el) => {
    el.value = "Young pairs under 3 hours, at least $10k liquidity, 0.2 SOL, fold at 10% down or 20% up, hold 30 minutes.";
  });
  await page.click("#matchTemplateBtn");
  const matched = JSON.parse(await page.$eval("#rulesJson", (el) => el.value));
  assert(matched.name === "Fresh crease", "keyword picker missed Fresh crease");
  assert(matched.positionSizeSol === 0.2, "size override");
  assert(matched.maxHoldMinutes === 30, "hold override");
  await shot(page, "origami-desktop.png");

  await page.$eval("#rulesJson", (el, value) => { el.value = value; }, JSON.stringify(loose, null, 2));
  await page.click("#applyJson");
  await page.click("#scanOnce");
  await page.waitForFunction(() => /Looked at|could not|reached|pause|blocked|failed/i.test(document.getElementById("deskStatus").textContent), { timeout: 45000 });
  const desk = await page.$eval("#deskStatus", (el) => el.textContent);
  console.log("desk", desk);
  assert(/Looked at [1-9]\d*/.test(desk), "desk did not read pairs: " + desk);
  assert(/Opened [1-9]/.test(desk), "desk did not open a paper seat: " + desk);
  await (await page.$("#desk")).screenshot({ path: path.join(outDir, "origami-desktop-desk.png") });
  console.log("shot", path.join(outDir, "origami-desktop-desk.png"));

  await page.select("#replayKind", "pool");
  await page.$eval("#replayQuery", (el, value) => { el.value = value; }, pool);
  await page.$eval("#rulesJson", (el, value) => { el.value = value; }, JSON.stringify(replayRules, null, 2));
  await page.click("#applyJson");
  await page.click("#replayFind");
  await page.waitForFunction(() => document.querySelector("#poolList button"), { timeout: 20000 });
  await page.click("#replayGo");
  await page.waitForFunction(() => /Walked \d+ candles|Replay could not|no candles|failed/i.test(document.getElementById("replayStatus").textContent + document.getElementById("replayOut").innerText), { timeout: 60000 });
  const replayText = await page.$eval("#replayOut", (el) => el.innerText);
  const replayStatus = await page.$eval("#replayStatus", (el) => el.textContent);
  console.log("replay", replayStatus, replayText.split("\n")[0]);
  assert(/Walked \d+ candles/.test(replayText), "replay did not walk candles: " + replayStatus + " " + replayText);
  assert(/folds/.test(replayText), "replay did not report folds");
  await (await page.$("#replay")).screenshot({ path: path.join(outDir, "origami-desktop-replay.png") });
  console.log("shot", path.join(outDir, "origami-desktop-replay.png"));

  await page.click("#cardSource");
  await page.waitForFunction(() => document.getElementById("cardStatus").textContent.length > 0);
  const pixel = await page.evaluate(() => {
    const canvas = document.getElementById("foldCanvas");
    const data = canvas.getContext("2d").getImageData(12, canvas.height - 12, 1, 1).data;
    return { rgba: [data[0], data[1], data[2], data[3]], mark: canvas.dataset.watermark };
  });
  assert(pixel.mark === "PAPER TRADE — NOT REAL", "watermark dataset");
  assert(pixel.rgba[0] === 255 && pixel.rgba[1] === 77 && pixel.rgba[2] === 141, "banner pixel " + pixel.rgba.join(","));
  const href = await page.$eval("#shareX", (el) => el.href);
  const decoded = decodeURIComponent(href);
  assert(href.startsWith("https://x.com/intent/post?text="), href);
  assert(decoded.includes("Paper trades only. Not financial advice."), decoded);
  assert(!href.includes("media"), "share should be text only");
  await (await page.$("#card")).screenshot({ path: path.join(outDir, "origami-desktop-card.png") });
  console.log("shot", path.join(outDir, "origami-desktop-card.png"));
  await page.click("#downloadCard");
  const status = await page.$eval("#cardStatus", (el) => el.textContent);
  assert(/PNG downloaded/.test(status), status);
  const png = await page.evaluate(() => document.getElementById("foldCanvas").toDataURL("image/png"));
  const file = path.join(outDir, "origami-fold-card.png");
  await writeFile(file, Buffer.from(png.split(",")[1], "base64"));
  assert(png.startsWith("data:image/png"), "card was not a png");

  await page.click("[data-locked]");
  await page.waitForSelector("#gateDialog:not([hidden])");
  const gate = await page.$eval("#gateDialog", (el) => el.innerText);
  assert(gate.includes("0.05 SOL"), gate);
  assert(gate.includes("QUESTO"), gate);
  assert(!gate.includes("$FOLD"), gate);
  await page.click("#gateClose");
  await page.click("#questoUnlockBtn");
  const questo = await page.$eval("#questoStatus", (el) => el.textContent);
  assert(/seed phrase/i.test(questo), questo);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(base, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("foldCanvas").dataset.watermark === "PAPER TRADE — NOT REAL");
  await shot(page, "origami-mobile.png");
  await (await page.$("#card")).screenshot({ path: path.join(outDir, "origami-mobile-card.png") });
  console.log("shot", path.join(outDir, "origami-mobile-card.png"));
  const ogHidden = await page.$eval("#ogBadge", (el) => el.hidden);
  assert(ogHidden, "OG badge should stay hidden without a QUESTO grant");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 8);
  assert(!overflow, "mobile page scrolls sideways");

  await page.evaluate(() => localStorage.setItem("oa_v1_unlocked", "1"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.getElementById("tierBadge").textContent.includes("Full"));
  await page.click("[data-add-agent]");
  const agents = await page.$$eval("[data-agent]", (nodes) => nodes.length);
  assert(agents === 2, "full sheet should allow a second agent, saw " + agents);

  const noisy = errors.filter((line) => !/favicon|Download the font/i.test(line));
  if (noisy.length) {
    console.log("console", noisy);
    throw new Error(noisy[0]);
  }
  await browser.close();
  console.log("smoke ok", await readdir(outDir));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
