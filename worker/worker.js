// Cloudflare Worker: Proxy fuer Gemini, Groq und USDA.
// Die API-Keys liegen als Secrets im Worker (GEMINI_API_KEY, GROQ_API_KEY, USDA_API_KEY)
// und erscheinen nie im ausgelieferten HTML.

const ALLOWED_ORIGINS = ['https://alfredodeu.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_CHARS = 20000;

function isAllowed(origin) {
  return !!origin && (ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin));
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, origin ? cors(origin) : {})
  });
}

async function passThrough(r, origin) {
  return new Response(await r.text(), {
    status: r.status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origin))
  });
}

async function readPrompt(request) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b.sys !== 'string' || typeof b.msg !== 'string') return null;
  if (b.sys.length + b.msg.length > MAX_CHARS) return null;
  return b;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!isAllowed(origin)) return json({ error: { message: 'Origin nicht erlaubt' } }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const path = new URL(request.url).pathname;

    if (path === '/gemini' && request.method === 'POST') {
      const b = await readPrompt(request);
      if (!b) return json({ error: { message: 'Ungueltige Anfrage' } }, 400, origin);
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + env.GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: b.sys }] },
          contents: [{ role: 'user', parts: [{ text: b.msg }] }]
        })
      });
      return passThrough(r, origin);
    }

    if (path === '/groq' && request.method === 'POST') {
      const b = await readPrompt(request);
      if (!b) return json({ error: { message: 'Ungueltige Anfrage' } }, 400, origin);
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.GROQ_API_KEY },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 2500,
          messages: [{ role: 'system', content: b.sys }, { role: 'user', content: b.msg }]
        })
      });
      return passThrough(r, origin);
    }

    if (path === '/usda' && request.method === 'GET') {
      const q = new URL(request.url).searchParams.get('q') || '';
      if (!q || q.length > 100) return json({ error: { message: 'Ungueltige Anfrage' } }, 400, origin);
      const r = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search?query=' + encodeURIComponent(q) +
        '&dataType=Foundation,SR%20Legacy&pageSize=3&api_key=' + encodeURIComponent(env.USDA_API_KEY));
      return passThrough(r, origin);
    }

    return json({ error: { message: 'Nicht gefunden' } }, 404, origin);
  }
};
