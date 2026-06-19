// server.js — serves the app and proxies to Anthropic.
// The API key lives ONLY in process.env.ANTHROPIC_API_KEY (set in Railway).
// It is never sent to the browser and never stored in the repo.

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '12mb' })); // base64 images can be large
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.ANTHROPIC_API_KEY;

app.post('/api/generate', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Railway > Variables.' });
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    // Pass Anthropic's status + body straight back so the client can handle errors.
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'Proxy failed to reach Anthropic: ' + e.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reel Kitchen running on :${PORT}`));
