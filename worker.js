const SCRIPT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const APP_TITLE = 'GRBL Serial Diagnostic';
const WORKER_LOADED_AT = new Date().toISOString();

function generateId(length = 6) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const value of bytes) {
    id += alphabet[value % alphabet.length];
  }
  return id;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeScriptVars(vars) {
  const next = {};
  if (!isPlainObject(vars)) return next;
  for (const [key, value] of Object.entries(vars)) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[name] = value;
      continue;
    }
    next[name] = String(value ?? '').trim();
  }
  return next;
}

function normalizeScriptPayload(payload) {
  if (!isPlainObject(payload)) throw new Error('Script payload must be an object');

  const title = String(payload.title || '').trim();
  const programText = String(payload.programText || '').trim();
  if (!title) throw new Error('Script title is required');
  if (!programText) throw new Error('Script source is required');

  return {
    title,
    version: String(payload.version || '').trim(),
    author: String(payload.author || '').trim(),
    description: String(payload.description || '').trim(),
    programText,
    vars: normalizeScriptVars(payload.vars),
  };
}

function substituteScriptVars(text, vars) {
  let result = String(text || '');
  for (const [key, value] of Object.entries(vars || {})) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result.trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildScriptDisplayName(script) {
  let label = script.title || 'Saved Script';
  if (script.version) label += ` v${script.version}`;
  if (script.author) label += `::${script.author}`;
  return `${APP_TITLE}::${label}`;
}

function buildScriptMetaDescription(script) {
  const description = substituteScriptVars(script.description, script.vars);
  if (description) return description.slice(0, 240);
  return `Open ${script.title || 'this saved script'} in ${APP_TITLE}.`;
}

function injectScriptMetadata(html, requestUrl, script) {
  const title = escapeHtml(buildScriptDisplayName(script));
  const description = escapeHtml(buildScriptMetaDescription(script));
  const canonicalUrl = escapeHtml(requestUrl.toString());
  const metadata = [
    `<meta name="description" content="${description}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${canonicalUrl}">`
  ].join('\n');

  let nextHtml = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  if (!/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<head>/i, `<head>\n<title>${title}</title>`);
  }
  if (!/meta\s+property="og:title"/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/<\/head>/i, `${metadata}\n</head>`);
  }
  return nextHtml;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/build-info') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            ...SCRIPT_CORS_HEADERS,
            'Cache-Control': 'no-store',
          }
        });
      }

      if (request.method !== 'GET') {
        return new Response('Method not allowed', {
          status: 405,
          headers: {
            ...SCRIPT_CORS_HEADERS,
            'Cache-Control': 'no-store',
          }
        });
      }

      let assetLastModified = null;
      let assetEtag = null;
      try {
        const indexUrl = new URL('/index.html', url.origin);
        const indexResponse = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: 'HEAD' }));
        assetLastModified = indexResponse.headers.get('last-modified');
        assetEtag = indexResponse.headers.get('etag');
      } catch {
        // Return partial metadata when asset header lookup fails.
      }

      const payload = {
        appTitle: APP_TITLE,
        workerLoadedAt: WORKER_LOADED_AT,
        edgeDate: new Date().toISOString(),
        assetLastModified,
        assetEtag,
        cfRay: request.headers.get('cf-ray') || null,
        cfColo: request.cf?.colo || null,
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...SCRIPT_CORS_HEADERS,
        }
      });
    }

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
          data = normalizeScriptPayload(await request.json());
        } catch (error) {
          return new Response(error.message || 'Invalid JSON body', {
            status: 400,
            headers: SCRIPT_CORS_HEADERS,
          });
        }

        const id = generateId();
        const record = {
          ...data,
          id,
          created: new Date().toISOString(),
        };
        await env.GRBL_SCRIPTS.put(id, JSON.stringify(record));

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

    if (request.method === 'GET' && url.pathname === '/' && url.searchParams.has('script') && env.GRBL_SCRIPTS) {
      const scriptId = (url.searchParams.get('script') || '').trim();
      if (scriptId) {
        const stored = await env.GRBL_SCRIPTS.get(scriptId);
        if (stored) {
          try {
            const script = normalizeScriptPayload(JSON.parse(stored));
            const assetResponse = await env.ASSETS.fetch(request);
            const contentType = assetResponse.headers.get('content-type') || '';
            if (assetResponse.ok && contentType.includes('text/html')) {
              const html = await assetResponse.text();
              const headers = new Headers(assetResponse.headers);
              headers.set('Content-Type', 'text/html; charset=utf-8');
              headers.delete('Content-Length');
              return new Response(injectScriptMetadata(html, url, script), {
                status: assetResponse.status,
                headers,
              });
            }
            return assetResponse;
          } catch {
            // Fall through to the normal asset response if metadata injection fails.
          }
        }
      }
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
