// Share card drawn on a canvas. The watermark is painted on every path.

import { APP, TIERS } from "./constants.js";
import { bookSnapshot } from "./paper.js";

export const WATERMARK = "PAPER TRADE — NOT REAL";

function ellipsis(ctx, text, max) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= max) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > max) cut = cut.slice(0, -1);
  return cut + "…";
}

function paintLocalPaper(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, w, h);
  sky.addColorStop(0, "#1a2230");
  sky.addColorStop(0.45, "#12151c");
  sky.addColorStop(1, "#090b10");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(62,240,197,0.16)";
  ctx.lineWidth = 2;
  for (let x = -200; x < w; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 220, h);
    ctx.stroke();
  }
  const planes = [
    { pts: [[90, 250], [250, 140], [280, 360]], fill: "#243044", stroke: "#3ef0c5" },
    { pts: [[250, 140], [430, 210], [280, 360]], fill: "#1a2433", stroke: "#f3efe6" },
    { pts: [[430, 210], [520, 120], [560, 300]], fill: "#2a2030", stroke: "#ff4d8d" },
    { pts: [[180, 390], [300, 330], [340, 500]], fill: "#3a2a22", stroke: "#e7c56a" },
    { pts: [[300, 330], [470, 360], [340, 500]], fill: "#241c22", stroke: "#ff4d8d" }
  ];
  planes.forEach((plane) => {
    ctx.beginPath();
    ctx.moveTo(plane.pts[0][0], plane.pts[0][1]);
    plane.pts.slice(1).forEach((pt) => ctx.lineTo(pt[0], pt[1]));
    ctx.closePath();
    ctx.fillStyle = plane.fill;
    ctx.fill();
    ctx.strokeStyle = plane.stroke;
    ctx.lineWidth = 4;
    ctx.stroke();
  });
}

function paintApe(ctx) {
  ctx.save();
  ctx.translate(860, 250);
  const earL = [[-150, 10], [-90, -90], [-40, 20]];
  const earR = [[150, 10], [90, -90], [40, 20]];
  const face = [[0, -130], [120, -60], [100, 80], [0, 140], [-100, 80], [-120, -60]];
  [earL, earR, face].forEach((poly, index) => {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    poly.slice(1).forEach((pt) => ctx.lineTo(pt[0], pt[1]));
    ctx.closePath();
    ctx.fillStyle = index === 2 ? "#2a3344" : "#1b2230";
    ctx.fill();
    ctx.strokeStyle = index === 1 ? "#ff4d8d" : "#3ef0c5";
    ctx.lineWidth = 6;
    ctx.stroke();
  });
  ctx.fillStyle = "#ff4d8d";
  ctx.beginPath();
  ctx.moveTo(-30, -10);
  ctx.lineTo(-8, -18);
  ctx.lineTo(-12, 18);
  ctx.fill();
  ctx.fillStyle = "#3ef0c5";
  ctx.beginPath();
  ctx.moveTo(18, -8);
  ctx.lineTo(42, -16);
  ctx.lineTo(30, 20);
  ctx.fill();
  ctx.fillStyle = "#e7c56a";
  ctx.beginPath();
  ctx.moveTo(-16, 70);
  ctx.lineTo(16, 70);
  ctx.lineTo(0, 98);
  ctx.fill();
  ctx.restore();
}

function paintWatermark(ctx, w, h) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.45);
  ctx.font = "700 46px Outfit, sans-serif";
  ctx.fillStyle = "rgba(243,239,230,0.14)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = -h; y <= h; y += 150) ctx.fillText(WATERMARK, 0, y);
  ctx.restore();

  ctx.fillStyle = "#ff4d8d";
  ctx.fillRect(0, h - 72, w, 72);
  ctx.fillStyle = "#14080e";
  ctx.font = "700 32px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(WATERMARK, w / 2, h - 36);
}

export function cardStats(agent, replay) {
  const book = agent.book;
  const snap = bookSnapshot(book);
  const trades = book.trades || [];
  const worst = trades.reduce((pick, trade) => (!pick || trade.changeSol < pick.changeSol ? trade : pick), null);
  let roughLine = "No folds yet. The sheet is still smooth.";
  if (worst) {
    const pct = worst.changePct >= 0 ? "+" + worst.changePct.toFixed(1) : worst.changePct.toFixed(1);
    roughLine = "Most rekt fold: " + worst.symbol + " " + pct + "% on paper. " + worst.line;
  }
  const source = replay
    ? "Replay · " + (replay.bars || 0) + " candles"
    : "Ghost Desk · live prints";
  return {
    name: agent.rules.name,
    equity: snap.equity,
    paperChange: snap.paperChange,
    folds: trades.length,
    open: (book.positions || []).length,
    roughLine,
    source,
    joke: snap.paperChange < 0 ? "The ape folded. The joke is free." : "Still on the sheet. Still fake."
  };
}

export function shareText(stats) {
  return [
    "Origami Ape, on paper: " + stats.folds + " folds, fake book " + stats.equity.toFixed(2) + " SOL.",
    stats.joke,
    "Paper trades only. Not financial advice.",
    APP.siteUrl
  ].join(" ");
}

export function shareHref(stats) {
  return "https://x.com/intent/post?text=" + encodeURIComponent(shareText(stats));
}

export function drawFoldCard(canvas, stats, backdrop) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (backdrop) {
    ctx.drawImage(backdrop, 0, 0, w, h);
    ctx.fillStyle = "rgba(8,10,14,0.62)";
    ctx.fillRect(0, 0, w, h);
  } else {
    paintLocalPaper(ctx, w, h);
  }
  const veil = ctx.createLinearGradient(0, 0, 860, 0);
  veil.addColorStop(0, "rgba(8,10,14,0.78)");
  veil.addColorStop(0.72, "rgba(8,10,14,0.55)");
  veil.addColorStop(1, "rgba(8,10,14,0)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, 900, h - 72);
  paintApe(ctx);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#3ef0c5";
  ctx.font = "650 22px Outfit, sans-serif";
  ctx.fillText("ORIGAMI APE", 64, 86);
  ctx.fillStyle = "#f3efe6";
  ctx.font = "700 64px Fraunces, serif";
  ctx.fillText(ellipsis(ctx, stats.name || "Paper sheet", 760), 64, 168);
  ctx.fillStyle = "#c8c2b4";
  ctx.font = "500 24px Outfit, sans-serif";
  ctx.fillText(stats.source, 64, 214);
  ctx.fillStyle = "#f3efe6";
  ctx.font = "700 78px Fraunces, serif";
  ctx.fillText(stats.equity.toFixed(2), 64, 330);
  ctx.font = "600 28px Outfit, sans-serif";
  ctx.fillStyle = "#e7c56a";
  ctx.fillText("fake SOL in the book", 64, 372);
  const change = stats.paperChange;
  const changeText = (change > 0 ? "+" : "") + change.toFixed(3) + " paper change";
  ctx.fillStyle = change < 0 ? "#ff8aa8" : "#9cf7e4";
  ctx.fillText(changeText, 64, 418);
  ctx.fillStyle = "#f3efe6";
  ctx.font = "600 26px Outfit, sans-serif";
  ctx.fillText(stats.folds + " folds · " + stats.open + " still open · started " + TIERS.startingFakeSol + " fake SOL", 64, 468);
  ctx.fillStyle = "#d9d3c7";
  ctx.font = "500 24px Outfit, sans-serif";
  ctx.fillText(ellipsis(ctx, stats.joke, 760), 64, 516);
  ctx.fillText(ellipsis(ctx, stats.roughLine, 980), 64, 556);
  paintWatermark(ctx, w, h);
  canvas.dataset.watermark = WATERMARK;
  return canvas;
}

export function downloadCanvas(canvas, filename) {
  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return url;
}
