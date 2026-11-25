// Keep provider credentials on the server, never in browser JavaScript.
const windows = new Map();
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({error:{message:'Use POST.'}}); }
  const fail = (status, message) => res.status(status).json({error:{message}});
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, 'Chat is not configured.');
  const body = req.body;
  const prompt = body?.contents?.[0]?.parts?.[0]?.text;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) return fail(400, 'Enter a prompt of 1–4000 characters.');
  const now = Date.now();
  for (const [ip, entry] of windows) if (entry.until <= now) windows.delete(ip);
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
  if (!windows.has(ip) && windows.size >= 1000) return fail(429, 'Try again later.');
  const entry = windows.get(ip) || {count:0,until:now+60000};
  if (++entry.count > 5) return fail(429, 'Please wait a minute before sending more messages.');
  windows.set(ip, entry);
  const model = process.env.GEMINI_MODEL;
  if (!model || !/^[a-zA-Z0-9._-]+$/.test(model)) return fail(503, 'A supported Gemini model must be configured.');
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent', {
      method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt.trim()}]}],generationConfig:{maxOutputTokens:1024}}),
      signal:AbortSignal.timeout(25000)
    });
    if (!response.ok) return fail(response.status===429?429:502,'The AI provider could not answer. Try again later.');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');
    if (!text) return fail(502,'No text response was returned.');
    return res.status(200).json({candidates:[{content:{parts:[{text}]}}]});
  } catch { return fail(502,'The AI service is temporarily unavailable.'); }
}
