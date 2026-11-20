# Origami Ape

Describe a Solana memecoin strategy in plain words. A paper ape turns it into rules and paper-trades **live public prices** with **fake SOL**. Nothing is swapped, sniped, or signed as a trade.

**Apps, not investments.** **Paper trades only. Not financial advice.**

Live site: [mirmobe.github.io/mirmobe-origami-ape](https://mirmobe.github.io/mirmobe-origami-ape/)

## What you can do

- **Strategy Whisperer.** A sentence becomes an editable JSON rule sheet: token age, liquidity, volume, 1h price change, buys/sells, fake-SOL size, take-profit, stop-loss, and max hold. Pick a template with no network. Or opt in to an on-device WebLLM model (WebGPU only, about 280 MB). Or use queued, keyless Pollinations text.
- **Ghost Desk.** The active sheet runs against DexScreener while the tab is open. It tracks a fake SOL book, paper PnL, open seats, and a fold log. State stays in `localStorage`.
- **Replay.** Walk the sheet over GeckoTerminal candles for a token or pool you pick.
- **Fold Card.** Download a PNG that always reads `PAPER TRADE — NOT REAL`. An X button opens a text draft. It does not post.

Free is one agent plus Fold Cards. The full sheet is five agents. Duel, Diary, and skins are marked coming soon.

## Unlock

Coin settings live in [`js/constants.js`](js/constants.js).

- **0.05 SOL** to `5P1ArCLapXPjSEaNauVYAmtLKxEwoELcttQvPqmF1VYP`. You pay from your own wallet, then paste the signature. It must have succeeded, be under seven days old, and show at least 0.05 SOL received by that address (including loaded addresses). A signature works once in that browser.
- **$QUESTO** holders with at least 1,000,000 (`5eCknU1RcP4QwWXCYicE4VGG8KY69TTUL7YZTma4pump`) get the full sheet and an OG badge. The wallet signs a message. The balance is read with `getParsedTokenAccountsByOwner`, including Token-2022, and checked about once a day.
- **$FOLD** is not launched. `FOLD_MINT` is `null`, so that unlock is hidden.

The app never asks for a seed phrase or a private key. Public RPCs, in order: `api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`, `rpc.ankr.com/solana`.

## Limits

- DexScreener is keyless and capped near 300 requests a minute. This app spaces calls and caches profiles (~60s) and pair batches (~45s). A running desk looks about every 20 seconds, and only while the tab is visible.
- GeckoTerminal is keyless and about 5 calls a minute. Calls are at least 13 seconds apart and cached on device for 15 minutes.
- Pollinations text is queued (about 12 seconds apart) and rate-limited. Image backdrops time out and fall back to a local drawing.
- The on-device model is `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` from `@mlc-ai/web-llm` on a CDN. It loads only after you confirm the ~280 MB download, and only when WebGPU exists.
- Replay has no liquidity and no buys/sells in the candles, so those filters are skipped. Price-change rules use the candle size you picked. Volume uses a rolling sum of those candles.
- Prices are public prints. No fees, no slippage, at most three open paper seats per agent, and a 15-minute cooldown before the same pair is sat again.
- The desk does not run in the background. Unlock records live in this browser only.

## Develop

Static files. No build.

```bash
python3 -m http.server 4173
```

`node --test scripts/engine.test.mjs` checks rules, the paper book, replay folding, and the signature math. It does not need a browser. `node scripts/smoke.mjs` walks the page in headless Chrome while the site is served at `http://127.0.0.1:4173/`.
