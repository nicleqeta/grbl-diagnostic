const SCRIPT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function generateId(length = 6) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const value of bytes) {
    id += alphabet[value % alphabet.length];
  }
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/favicon.ico') {
      return Response.redirect(new URL('/favicon.svg', request.url), 302);
    }

    if (url.pathname === '/script' || url.pathname.startsWith('/script/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: SCRIPT_CORS_HEADERS });
      }

      if (!env.GRBL_SCRIPTS) {
        return new Response('Missing KV binding: GRBL_SCRIPTS', {
          status: 500,
          headers: SCRIPT_CORS_HEADERS,
        });
      }

      if (url.pathname === '/script' && request.method === 'POST') {
        let data;
        try {
          data = await request.json();
        } catch {
          return new Response('Invalid JSON body', {
            status: 400,
            headers: SCRIPT_CORS_HEADERS,
          });
        }

        const id = generateId();
        await env.GRBL_SCRIPTS.put(id, JSON.stringify({
          ...data,
          id,
          created: new Date().toISOString(),
        }));

        return new Response(JSON.stringify({ id, url: `${url.origin}/?script=${id}` }), {
          headers: {
            'Content-Type': 'application/json',
            ...SCRIPT_CORS_HEADERS,
          },
        });
      }

      if (url.pathname.startsWith('/script/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice('/script/'.length)).trim();
        if (!id) {
          return new Response('Missing script ID', {
            status: 400,
            headers: SCRIPT_CORS_HEADERS,
          });
        }

        const value = await env.GRBL_SCRIPTS.get(id);
        if (!value) {
          return new Response('Not found', {
            status: 404,
            headers: SCRIPT_CORS_HEADERS,
          });
        }

        return new Response(value, {
          headers: {
            'Content-Type': 'application/json',
            ...SCRIPT_CORS_HEADERS,
          },
        });
      }

      return new Response('Method not allowed', {
        status: 405,
        headers: SCRIPT_CORS_HEADERS,
      });
    }

    // ── Proxy route — fetches Discourse raw post content server-side ──
    // Avoids CORS entirely since this runs on Cloudflare, not the browser
    if (url.pathname === '/proxy') {

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: SCRIPT_CORS_HEADERS
        });
      }

      const target = url.searchParams.get('url');

      if (!target) {
        return new Response('Missing ?url= parameter', { status: 400 });
      }

      // Whitelist — only allow Discourse /raw/ endpoint
      // Prevents this proxy being used as a general-purpose relay
      const allowed = /^https?:\/\/[^/]+\/raw\/\d+\/\d+$/;
      if (!allowed.test(target)) {
        return new Response('Disallowed URL pattern', { status: 403 });
      }

      try {
        const resp = await fetch(target, {
          headers: {
            'Accept': 'text/plain',
            'User-Agent': 'grbl-diagnostic-proxy/1.0'
          }
        });

        const body = await resp.text();

        return new Response(body, {
          status: resp.status,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60'
          }
        });

      } catch (e) {
        return new Response(`Proxy fetch failed: ${e.message}`, { status: 502 });
      }
    }

    // ── All other requests — serve static assets via Cloudflare assets binding ──
    return env.ASSETS.fetch(request);
  }
};
