# Reel Kitchen 🍳

Upload a recipe photo → get stitch-ready **Grok Imagine** scene prompts (with ASMR sound directions, overlay text, a Facebook caption, a recipe first-comment, and a stitch guide). Built for a faceless clean-eating reels account.

Pick the reel length (40s / 4×10s, 15s / 3×5s, or one 6s clip), and choose **how to make it**:

- **Grok prompts** (default) — copy-ready prompts you paste into Grok Imagine yourself.
- **Auto-render (fal.ai)** — bypass Grok and render the reel right here, using the same fal.ai pipeline as the [`influential`](https://github.com/Biggjuann/influential) project: a Flux keyframe per scene → fal image-to-video → ffmpeg stitch into one MP4. Costs fal credits and takes a few minutes. Video only (no audio) in this mode.

All API keys live **server-side only** (Railway environment variables). They are never sent to the browser and never stored in this repo.

---

## Architecture (1 minute read)

```
Browser (public/index.html)
   │  POST /api/generate              ── Grok-prompt mode (no key in request)
   │  POST /api/render → GET /api/render/:id  ── fal.ai auto-render mode
   ▼
server.js  (Express)
   │  /api/generate → adds ANTHROPIC_API_KEY → api.anthropic.com/v1/messages
   │  /api/render   → adds FAL_KEY → Flux keyframe + fal image-to-video,
   │                  then ffmpeg-static stitches the clips into one MP4
   ▼
served back from /renders/<job>/final.mp4
```

- `public/index.html` — the app UI. Calls `/api/generate` and `/api/render`. Contains **no keys**.
- `server.js` — serves the UI, proxies Anthropic, and runs the fal.ai render pipeline. Keys come from `process.env` only.
- `ANTHROPIC_API_KEY` (always) and `FAL_KEY` (only for auto-render) are set in **Railway → Variables**, encrypted at rest, never in git.

### Auto-render notes
- Rendering is asynchronous: `POST /api/render` returns a `jobId`, the browser polls `GET /api/render/:id` for progress, and the finished MP4 is served from `/renders/...`.
- Clip files live in the container's temp dir and are **ephemeral** — download the reel; it won't survive a redeploy/restart.
- `FAL_KEY` is optional. Without it the app still runs in Grok-prompt mode; the render button just reports a "missing FAL_KEY" error.

---

## ✅ Instructions for Claude Code

Do these steps in order. The working directory is this project folder.

### 1. Initialize and push to GitHub
```bash
git init
git add .
git commit -m "Reel Kitchen: recipe-to-Grok-prompts app with server-side key proxy"
```
Create a GitHub repo (private recommended) and push:
```bash
git remote add origin https://github.com/<user>/reel-kitchen.git
git branch -M main
git push -u origin main
```
> Confirm `.gitignore` is present and that **`.env` and `node_modules/` are NOT committed**. Run `git status` and verify neither appears. There must be **no API key anywhere in the committed files** — grep the repo to be sure:
> ```bash
> git grep -i "sk-ant" || echo "OK: no key in repo"
> ```

### 2. Deploy on Railway (GitHub auto-deploy)
1. Go to railway.app → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway auto-detects Node, runs `npm install`, then `npm start` (from `railway.json`).
3. Open the service → **Variables** → add:
   - `ANTHROPIC_API_KEY` = the rotated key (see security note below)
4. Railway sets `PORT` automatically; `server.js` already reads `process.env.PORT`.
5. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

### 3. Verify
- Visit `https://<your-domain>/health` → should return `{"ok":true}`.
- Visit `https://<your-domain>/` → the app loads with **no API-key field**.
- Upload a recipe photo, pick a kitchen + cook, click generate → four scenes render.

### 4. Hand off the URL
Give the wife only the generated Railway domain. She bookmarks it on her phone. No key, no pasting, ever.

---

## 🔐 Security note (important)

The key `sk-ant-api03-K8V6...` that was shared in chat must be treated as **compromised**. Before deploying:
1. Go to the Anthropic Console → **API Keys** → **revoke** that key.
2. Create a **new** key.
3. Put the new key **only** in Railway → Variables. Do not paste it into code, chat, or git.

Set a monthly spend limit in the Anthropic Console as a backstop.

---

## Local testing (optional)
```bash
cp .env.example .env        # put a real key in .env (gitignored)
npm install
node -r dotenv/config server.js   # or: export ANTHROPIC_API_KEY=...; npm start
```
Then open http://localhost:3000

> Note: `dotenv` is only needed for local `.env` loading. On Railway the variable is injected directly, so it is not a production dependency. To use the `-r dotenv/config` shortcut locally, run `npm install --no-save dotenv` first, or just export the variable inline.

---

## Files
| File | Purpose |
|------|---------|
| `server.js` | Express server + Anthropic proxy |
| `public/index.html` | The app (keyless) |
| `package.json` | Deps (`express`) + `start` script |
| `railway.json` | Build/start config for Railway |
| `.gitignore` | Keeps `node_modules`, `.env` out of git |
| `.env.example` | Documents the required variable |
