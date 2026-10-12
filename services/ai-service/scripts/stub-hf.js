#!/usr/bin/env node
// Stub Hugging Face Inference API for ai-service integration tests.
// POST /models/<anything> with { inputs: "<imageUrl>" }.
// Behavior controlled by the image URL and STUB_HF_MODE:
//   STUB_HF_MODE=ok      (default) -> 200 [{ generated_text: ... }]
//   STUB_HF_MODE=down    -> 503 (HF warming up / unavailable)
// URL containing "/boom" -> 500 regardless of mode.
// Caption text is derived from the URL so tests can force category mapping.
const http = require('node:http');

const PORT = Number(process.env.STUB_HF_PORT || 14103);
const MODE = process.env.STUB_HF_MODE || 'ok';

const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (req.method !== 'POST' || !url.startsWith('/models/')) {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let imageUrl = '';
    try {
      const parsed = JSON.parse(body || '{}');
      imageUrl = typeof parsed.inputs === 'string' ? parsed.inputs : '';
    } catch {
      imageUrl = '';
    }

    // The FAILURE switch is the IMAGE URL (the model path is fixed), so
    // tests can force per-request HF failures.
    if (imageUrl.includes('/boom')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub boom' }));
      return;
    }
    if (MODE === 'down') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'model loading' }));
      return;
    }

    // Deterministic captions keyed off the fake image URL.
    let caption = 'a photo of an item';
    if (imageUrl.includes('mixer')) caption = 'a mixer grinder on a table';
    else if (imageUrl.includes('textbook')) caption = 'a stack of textbooks';
    else if (imageUrl.includes('chair')) caption = 'a wooden study chair';

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ generated_text: caption }]));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub HF (${MODE}) on ${PORT}`));
