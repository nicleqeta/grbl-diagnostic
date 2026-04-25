const SCRIPT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const APP_TITLE = 'gcomposer';

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

    if (url.pathname === '/favicon.ico') {
      return Response.redirect(new URL('/favicon.svg', request.url), 302);
    }

    if (url.pathname === '/version') {
      let version = null;
      let versionSource = 'missing';
      let versionError = null;

      try {
        const versionUrl = new URL('/version.json', request.url);
        // Prefer the assets binding when available, with a fetch() fallback.
        const assetRes = env.ASSETS && typeof env.ASSETS.fetch === 'function'
          ? await env.ASSETS.fetch(new Request(versionUrl))
          : await fetch(versionUrl.toString());

        if (assetRes.ok) {
          try {
            ({ version } = await assetRes.json());
            if (version) versionSource = 'assets.version.json';
          } catch {
            versionSource = 'assets.version.json (parse_error)';
          }
        } else {
          versionSource = `assets.version.json (status_${assetRes.status})`;
        }
      } catch (error) {
        versionSource = 'error';
        versionError = String(error?.message || error);
      }

      const build = typeof env.BUILD_SHA === 'string' ? env.BUILD_SHA.trim() : '';
      const buildSource = build ? 'env.BUILD_SHA' : 'missing';
      return new Response(JSON.stringify({
        version: version ?? null,
        build: build || null,
        version_source: versionSource,
        build_source: buildSource,
        version_error: versionError,
      }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname === '/script' || url.pathname.startsWith('/script/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: SCRIPT_CORS_HEADERS });
      }

      if (!env.GCOM_SCRIPTS) {
        return new Response('Missing KV binding: GCOM_SCRIPTS', {
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
        await env.GCOM_SCRIPTS.put(id, JSON.stringify(record));

        return new Response(JSON.stringify({ id, url: `${url.origin}/?gcom=${id}` }), {
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

        const value = await env.GCOM_SCRIPTS.get(id);
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

    if (request.method === 'GET' && url.pathname === '/' && url.searchParams.has('gcom') && env.GCOM_SCRIPTS) {
      const scriptId = (url.searchParams.get('gcom') || '').trim();
      if (scriptId) {
        const stored = await env.GCOM_SCRIPTS.get(scriptId);
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

    // ── AI agent endpoint ──────────────────────────────────────────────────
    if (url.pathname === '/api/ai/agent') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: SCRIPT_CORS_HEADERS });
      }
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      }
      if (!env.AI) {
        return new Response(JSON.stringify({ error: 'AI service not configured on this deployment.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      }

      const MAX_MESSAGES = 20;
      const MAX_MSG_LEN  = 2000;
      const rawMessages  = Array.isArray(body.messages) ? body.messages : [];
      const messages = rawMessages
        .slice(-MAX_MESSAGES)
        .map(m => ({
          role:    String(m.role) === 'user' ? 'user' : 'assistant',
          content: String(m.content || '').slice(0, MAX_MSG_LEN),
        }))
        .filter(m => m.content.length > 0);

      if (messages.length === 0) {
        return new Response(JSON.stringify({ error: 'No messages provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      }

      const GCOM_SYSTEM = `You are a GCOM AI Agent embedded in gcomposer, a browser-based GRBL CNC controller.
Your primary role: write, explain, and refine GCOM scripts.

GCOM is a line-numbered BASIC dialect. Line numbers must be positive integers (10, 20, 30...).
Core statements:
  LET var = expr
  SEND "gcode" [TIMEOUT ms] [REQUIRE_OK]
  WAIT ms | WAIT_IDLE [ms] | WAIT_STATE target [TIMEOUT ms]
  PRINT expr | INPUT var [, "Prompt"]
  IF condition THEN GOTO line
  FOR var = start TO end [STEP n] ... NEXT [var]
  GOSUB line ... RETURN
  LET var = SETTING("$N") | RESULT key, expr | END
  HOLD | RESUME | STATUS | SOFT_RESET
  BENCH START | BENCH END

Math: ABS INT ROUND(v,d) SQRT SIN COS TAN ASIN ACOS ATAN ATAN2(y,x) RAD DEG RND(max)
      PI MOD(a,b) MIN(a,b) MAX(a,b) CLAMP(v,lo,hi) HYPOT(a,b) LN LOG LOG10 TRUNC SIGN
String: STR(expr) & (concat)
State: STATE() CLOCK() ELAPSED() BF_SERIAL() BF_PLANNER() GCODE_PARAM(key[,fallback])
Template variables use {name=default} syntax substituted before execution.

When outputting a GCOM script always wrap it in a fenced block tagged \`\`\`gcom ... \`\`\`.
After your reply emit an actions comment when applicable:
<!-- ACTIONS: {"insertScript":true,"showPreview":true} -->
Emit insertScript:true when you produce a new or modified script.
Emit showPreview:true when offering to open a motion preview.

Safety rules:
- Never recommend axis movement without REQUIRE_OK or confirmation logic.
- Always handle possible ALARM states in scripts that move axes.
- Keep explanations concise; lead with the script.`;

      let contextAddendum = '';
      const ctx = (body.gcomContext && typeof body.gcomContext === 'object') ? body.gcomContext : null;
      if (ctx) {
        const cmds = Array.isArray(ctx.commands) ? ctx.commands : [];
        const segs = Array.isArray(ctx.segments) ? ctx.segments : [];
        const srcCtx = Array.isArray(ctx.sourceContext) ? ctx.sourceContext : [];
        const geo = (ctx.geometric && typeof ctx.geometric === 'object') ? ctx.geometric : {};
        if (cmds.length > 0) {
          const parts = [];
          parts.push(`\n\n=== COMMAND TAPE SELECTION CONTEXT ===`);
          parts.push(`The user selected ${cmds.length} command(s) and ${segs.length} motion segment(s) from the preview of script: "${ctx.scriptTitle || 'Untitled'}".`);
          parts.push(`Script totals: ${ctx.totalCommandsInScript || '?'} commands, ${ctx.totalSegmentsInScript || '?'} segments.`);

          // Geometric summary
          if (geo.totalDistanceMm != null) parts.push(`Selected toolpath: ${geo.totalDistanceMm}mm total travel.`);
          if (geo.avgFeedRate) parts.push(`Average feed rate: ${geo.avgFeedRate}mm/min.`);
          if (Array.isArray(geo.motionTypes) && geo.motionTypes.length) parts.push(`Motion types: ${geo.motionTypes.join(', ')}.`);
          if (geo.bounds) {
            const b = geo.bounds;
            parts.push(`Bounding box of selection: X[${b.min.x} to ${b.max.x}] Y[${b.min.y} to ${b.max.y}] Z[${b.min.z} to ${b.max.z}] mm.`);
          }
          if (geo.minSourceLine != null) parts.push(`Source line range of selection: L${geo.minSourceLine}–L${geo.maxSourceLine}.`);

          // Selected G-code commands (raw, with source line)
          parts.push(`\nSelected G-code commands (commandId | sourceL | raw):`);
          for (const c of cmds.slice(0, 40)) {
            parts.push(`  [${c.commandId + 1}] L${c.sourceLine ?? '?'} | ${c.raw}`);
          }
          if (cmds.length > 40) parts.push(`  ... (${cmds.length - 40} more)`);

          // GCOM source lines that generated the selection — this is the genesis context
          if (srcCtx.length > 0) {
            parts.push(`\nGCOM source lines that generated the selection (with surrounding context):`);
            for (const { lineNumber, text } of srcCtx.slice(0, 60)) {
              parts.push(`  ${String(lineNumber).padStart(4, ' ')}: ${text}`);
            }
          }

          // Full script source for structural understanding
          if (ctx.scriptSource && ctx.scriptSource.trim()) {
            const scriptLines = ctx.scriptSource.split('\n');
            parts.push(`\nFull script source (first ${scriptLines.length} line(s)):`);
            parts.push('```gcom');
            parts.push(scriptLines.slice(0, 120).join('\n'));
            parts.push('```');
          }

          parts.push(`=== END CONTEXT ===`);
          contextAddendum = parts.join('\n');
        }
      }

      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: GCOM_SYSTEM + contextAddendum },
            ...messages,
          ],
          max_tokens: 1200,
          temperature: 0.4,
        });
        const reply = String(aiResponse.response || '');
        return new Response(JSON.stringify({ reply }), {
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `AI inference failed: ${e.message || e}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS },
        });
      }
    }

    // ── All other requests — serve static assets via Cloudflare assets binding ──
    return env.ASSETS.fetch(request);
  }
};
