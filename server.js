// server.js — serves the app and proxies to Anthropic, and (optionally) renders
// reels server-side via fal.ai (the same infrastructure the "influential" project uses).
// API keys live ONLY in process.env (set in Railway). They are never sent to the browser.

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
app.use(express.json({ limit: '12mb' })); // base64 images can be large
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.ANTHROPIC_API_KEY;

// ---- fal.ai config (mirrors influential's env defaults) ----
const FAL_KEY = process.env.FAL_KEY;
const FAL_FLUX = process.env.FAL_ENDPOINT_FLUX || 'fal-ai/flux/dev';
const FAL_I2V = process.env.FAL_ENDPOINT_VIDEO_I2V || 'fal-ai/kling-video/v1.6/standard/image-to-video';
const FAL_TIMEOUT_MS = parseInt(process.env.FAL_TIMEOUT_MS || '480000', 10); // 8 min/step

// Rendered clips are written to a temp dir and served read-only from /renders.
const RENDER_ROOT = path.join(os.tmpdir(), 'reel-kitchen-renders');
fs.mkdirSync(RENDER_ROOT, { recursive: true });
app.use('/renders', express.static(RENDER_ROOT));

// ----------------------------------------------------------------------------
// Anthropic proxy (used for the Grok-prompt flow)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// fal.ai render pipeline: Flux keyframe -> fal image-to-video -> ffmpeg stitch
// ----------------------------------------------------------------------------
const jobs = new Map(); // jobId -> job state (in-memory; single Railway instance)

async function falRun(model, input) {
  // Submit to fal's queue, then poll until the job completes and fetch the result.
  const sub = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!sub.ok) throw new Error(`fal ${model} submit failed (${sub.status}): ${(await sub.text()).slice(0, 300)}`);
  const { status_url, response_url } = await sub.json();
  if (!status_url || !response_url) throw new Error(`fal ${model} did not return queue URLs`);

  const start = Date.now();
  while (Date.now() - start < FAL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await fetch(status_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
    const sj = await s.json().catch(() => ({}));
    if (sj.status === 'COMPLETED') {
      const r = await fetch(response_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
      if (!r.ok) throw new Error(`fal ${model} result fetch failed (${r.status})`);
      return r.json();
    }
    if (sj.status === 'FAILED' || sj.error) {
      throw new Error(`fal ${model} job failed: ${JSON.stringify(sj).slice(0, 300)}`);
    }
  }
  throw new Error(`fal ${model} job timed out after ${Math.round(FAL_TIMEOUT_MS / 1000)}s`);
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${r.status}) for ${url}`);
  await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.slice(-500))));
  });
}

// Normalize every clip to 1080x1920 / 30fps and concatenate to one MP4 (video-only).
async function stitch(clipPaths, outPath) {
  const inputs = clipPaths.flatMap(p => ['-i', p]);
  const labels = clipPaths
    .map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${i}]`)
    .join(';');
  const concatIn = clipPaths.map((_, i) => `[v${i}]`).join('');
  const filter = `${labels};${concatIn}concat=n=${clipPaths.length}:v=1:a=0[outv]`;
  await runFfmpeg([...inputs, '-filter_complex', filter, '-map', '[outv]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outPath]);
}

async function renderJob(job, dir, scenes, clipLen) {
  const duration = clipLen >= 10 ? '10' : '5'; // Kling supports 5s or 10s
  const clipPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const prompt = (scenes[i] && scenes[i].prompt) || String(scenes[i] || '');
    if (!prompt.trim()) throw new Error(`Scene ${i + 1} has an empty prompt`);

    job.message = `Scene ${i + 1}/${scenes.length}: generating keyframe…`;
    const img = await falRun(FAL_FLUX, { prompt, image_size: 'portrait_16_9', num_images: 1 });
    const imageUrl = img.images && img.images[0] && img.images[0].url;
    if (!imageUrl) throw new Error(`Flux returned no image for scene ${i + 1}`);

    job.message = `Scene ${i + 1}/${scenes.length}: animating clip…`;
    const vid = await falRun(FAL_I2V, { prompt, image_url: imageUrl, duration, aspect_ratio: '9:16' });
    const videoUrl = (vid.video && vid.video.url) || (vid.videos && vid.videos[0] && vid.videos[0].url);
    if (!videoUrl) throw new Error(`Video model returned no clip for scene ${i + 1}`);

    const clipPath = path.join(dir, `clip${i + 1}.mp4`);
    await download(videoUrl, clipPath);
    clipPaths.push(clipPath);
    job.clips.push(`/renders/${job.id}/clip${i + 1}.mp4`);
    job.progress = i + 1;
  }

  job.message = clipPaths.length > 1 ? 'Stitching the final reel…' : 'Finalizing clip…';
  const finalPath = path.join(dir, 'final.mp4');
  await stitch(clipPaths, finalPath);
  job.finalUrl = `/renders/${job.id}/final.mp4`;
  job.status = 'done';
  job.message = 'Done';
}

app.post('/api/render', async (req, res) => {
  if (!FAL_KEY) {
    return res.status(400).json({ error: 'Server is missing FAL_KEY. Set it in Railway > Variables to enable fal.ai rendering.' });
  }
  const { scenes, clipLen } = req.body || {};
  if (!Array.isArray(scenes) || !scenes.length) {
    return res.status(400).json({ error: 'No scenes were provided to render.' });
  }
  const id = Math.random().toString(36).slice(2, 10);
  const dir = path.join(RENDER_ROOT, id);
  await fsp.mkdir(dir, { recursive: true });
  const job = { id, status: 'running', progress: 0, total: scenes.length, message: 'Starting…', clips: [], finalUrl: null, error: null };
  jobs.set(id, job);
  res.json({ jobId: id });
  // Run the pipeline in the background; the client polls /api/render/:id.
  renderJob(job, dir, scenes, Number(clipLen) || 5).catch(e => {
    job.status = 'error';
    job.error = e.message;
    job.message = 'Render failed';
  });
});

app.get('/api/render/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown render job.' });
  res.json(job);
});

app.get('/health', (_req, res) => res.json({ ok: true, falEnabled: !!FAL_KEY }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reel Kitchen running on :${PORT}`));
