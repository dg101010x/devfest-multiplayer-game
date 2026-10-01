// Serverless proxy for the Gemini API.
//
// A static site cannot hold a secret: anything in config.js is readable by
// every visitor. So the browser calls this instead, and the key lives only in
// the GEMINI_API_KEY environment variable on the server.
//
// Mirrors the model-walk in gemini.js because the hosted models are volatile:
// the 2.0/2.5 line now 404s as retired, and 3.8-flash is frequently 503.

const MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    // Not an error: the client falls back to local behaviour and the game
    // keeps working, just without Gemini.
    res.status(200).json({ text: null, reason: 'no key configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = String((body && body.prompt) || '').slice(0, 4000);
  const generationConfig = (body && body.generationConfig) || {};
  if (!prompt) {
    res.status(400).json({ error: 'missing prompt' });
    return;
  }

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 2000,
      topP: 0.95,
      ...generationConfig,
    },
  };

  for (const model of MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(12000),
        }
      );
      // Retired / overloaded / throttled: try the next candidate.
      if (r.status === 404 || r.status === 503 || r.status === 429) continue;
      if (!r.ok) continue;

      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p) => (p && p.text ? p.text : '')).join('')
        : '';
      if (text.trim()) {
        res.status(200).json({ text, model });
        return;
      }
    } catch {
      // network error or timeout — fall through to the next model
    }
  }

  res.status(200).json({ text: null, reason: 'all models unavailable' });
}
