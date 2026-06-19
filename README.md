# Reel Kitchen 🍳

Upload a recipe photo → get four stitch-ready 10-second **Grok Imagine** scene prompts (with ASMR sound directions, overlay text, a Facebook caption, a recipe first-comment, and a stitch guide). Built for a faceless clean-eating reels account.

The Anthropic API key lives **server-side only** (a Railway environment variable). It is never sent to the browser and never stored in this repo.

---

## Architecture (1 minute read)

```
Browser (public/index.html)
   │  POST /api/generate   (NO key in the request)
   ▼
server.js  (Express)
   │  adds ANTHROPIC_API_KEY from process.env
   ▼
api.anthropic.com/v1/messages
```

- `public/index.html` — the app UI. Calls `/api/generate`. Contains **no key**.
- `server.js` — serves the UI and proxies to Anthropic, injecting the key from `process.env.ANTHROPIC_API_KEY`.
- The key is set in **Railway → Variables**, encrypted at rest, never in git.

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
