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

      const mode = String(body.mode || 'chat').toLowerCase();

      const GCOM_SYSTEM = `You are a GCOM AI Agent embedded in gcomposer, a browser-based GRBL CNC controller.
Your primary role: write, explain, and refine GCOM scripts.

GCOM is a line-numbered BASIC dialect. Line numbers must be positive integers (10, 20, 30...).
Core statements:
  LET var = expr
  SEND "gcode" [TIMEOUT ms] [BUFFERED] [REQUIRE_OK]
  SET key valueExpr  (SEND_DELAY | ACK_TIMEOUT | RX_BUFFER | SEND_MODE | BANNER_TIMEOUT | READY_SETTLE | SEQUENCE_DELAY | STATUS_DELAY)
  RESET_SETTINGS
  STATUS (preferred realtime status query instead of SEND "?")
  WAIT ms | WAIT_IDLE [ms] | WAIT_STATE target [TIMEOUT ms]
  WAIT_FOR_LINE(pattern [, timeoutMs]) | READ_LINE([timeoutMs])
  PRINT expr | INPUT var [, "Prompt"] | LET var = FORM(msgExpr, v1, v2, ...)
  IF condition THEN GOTO line
  FOR var = start TO end [STEP n] ... NEXT [var]
  GOSUB line ... RETURN
  LET var = SETTING("$N") | LET var = READ("$N")
  RESULT key, expr | REPORT | END
  CONNECT [BAUD expr] [DTR expr] [WAIT expr] [OBSERVE] | CONNECT WS host [PORT expr] | DISCONNECT
  HOLD | RESUME | STATUS | SOFT_RESET
  BENCH META key=value ... | BENCH START key=value ... | BENCH END key=value ...

Math: ABS INT ROUND(v,d) SQRT SIN COS TAN ASIN ACOS ATAN ATAN2(y,x) RAD DEG RND(max)
  PI MOD(a,b) MIN(a,b) MAX(a,b) CLAMP(v,lo,hi) HYPOT(a,b) LN LOG LOG10 TRUNC SIGN CEIL FLOOR EXP
  SINH COSH TANH ASINH ACOSH ATANH
String: STR(expr) LEN(text) TRIM(text) UPPER(text) LOWER(text)
    SUBSTR(text,start[,length]) CONTAINS(text,needle) STARTS_WITH(text,prefix)
    ENDS_WITH(text,suffix) REPLACE(text,find,with[,max])
Tokenization: SPLIT_COUNT(text,delim) SPLIT_PART(text,delim,index[,fallback])
     SPLIT_INTO(text,delim,prefix)
State/Runtime: STATE() CLOCK() ELAPSED() BF_SERIAL() BF_PLANNER() GCODE_PARAM(key[,fallback]) FORMAT_MS(ms) BENCH_LAST_MS()
Template variables come from ; VAR name=value headers and are referenced as {name} in program text.
DESCRIPTION lines may also use {{expr}} placeholders for rendered metadata.

CRITICAL SYNTAX RULES (must follow):
- Do NOT use // comments anywhere.
- Use REM comments inside numbered program lines, or metadata headers prefixed with ';'.
- Do NOT use WHILE/WEND (unsupported).
- Looping must use FOR/NEXT or IF ... THEN GOTO.
- Emit only supported statements listed above.
- Prefer SEND + REQUIRE_OK/BUFFERED modifiers over legacy SENDACK/SENDBUFF spellings.

SCRIPT PACKAGE FORMAT (required when generating a full script):
; TITLE: <title>
; VERSION: <version>
; AUTHOR: <author>
; DESCRIPTION: <plain english summary including key variable placeholders>
; VAR name=value
<numbered GCOM program lines>

Always include TITLE and DESCRIPTION headers, plus VAR headers for any placeholders used in description or program text.
When writing DESCRIPTION, include the most relevant runtime knobs as placeholders (for example {feed_rate}, {depth}, {safe_z}, {passes}, {step_mm}) so the Composer description is immediately useful.
Prefer 2-5 high-impact placeholders in DESCRIPTION. Do not list every variable.
Preserve and reuse existing variable names and metadata provided in context when possible.

When outputting a GCOM script always wrap it in a fenced block tagged \`\`\`gcom ... \`\`\`.
After your reply emit an actions comment when applicable:
<!-- ACTIONS: {"insertScript":true,"showPreview":true} -->
Emit insertScript:true when you produce a new or modified script.
Emit showPreview:true when offering to open a motion preview.

Safety rules:
- Never recommend axis movement without REQUIRE_OK or confirmation logic.
- Always handle possible ALARM states in scripts that move axes.
- If terminal output is present in context, diagnose from those lines first before proposing script rewrites.
- Do not claim a statement/command is unsupported unless that claim is grounded in the provided manifest/profile/context.
- When terminal output context is present, include a short section titled "Evidence from terminal log" before diagnosis and quote at least one relevant line.
- If evidence is insufficient or ambiguous, say so explicitly instead of asserting a definitive root cause.
- Keep explanations concise; lead with the script.`;

    const REPAIR_SYSTEM = `
REPAIR MODE IS ACTIVE.
You are repairing a blocked script insertion. You must:
1) Reflect briefly with exactly these headings:
  - What failed
  - What I changed
  - Why this should pass now
2) Then output one corrected script in a \`\`\`gcom fenced block.
3) The corrected script MUST be a valid package with required headers:
  ; TITLE:
  ; DESCRIPTION:
  ; VAR name=value (for every placeholder used)
4) Use only supported GCOM syntax. Never use WHILE/WEND or // comments.
5) Emit actions comment:
  <!-- ACTIONS: {"insertScript":true,"showPreview":true} -->
`;

const GCOM_HELP_MANIFEST = `
GCOM CANONICAL RULES
Source: basic-help.html distilled manifest

PROGRAM FLOW
- Supported flow control: FOR/NEXT, IF ... THEN GOTO, IF ... THEN LET, IF ... THEN PRINT, IF ... THEN GOSUB, IF ... THEN END, GOTO, GOSUB, RETURN, END.
- Unsupported flow control: WHILE, WEND, ENDWHILE, DO/LOOP, O-codes, macro variables.

VARIABLES AND HEADERS
- Full scripts must use package headers before numbered lines:
  ; TITLE: ...
  ; VERSION: ...
  ; AUTHOR: ...
  ; DESCRIPTION: ...
  ; VAR name=value
- ; DESCRIPTION may appear more than once.
- ; DESCRIPTION should mention the primary tunable parameters using placeholders (typically 2-5): feed, distance/size, depth/z, step/count, speed/time.
- Prefer high-impact placeholders in DESCRIPTION (e.g., {feed_rate}, {distance}, {depth}, {passes}, {safe_z}) rather than listing all vars.
- Every placeholder used in DESCRIPTION or program text must have a matching ; VAR declaration.
- Do not reference bare identifiers before they are defined by LET or declared as placeholders with ; VAR.

MATH AND TRIG SEMANTICS
- SIN(angleDeg), COS(angleDeg), TAN(angleDeg) take degrees directly.
- ASIN, ACOS, ATAN, ATAN2 return degrees.
- Use RAD(degValue) only when you explicitly need radians for another computation.
- Do not convert degrees to radians before calling SIN/COS/TAN.

STRING AND TOKEN HELPERS
- STR(value) converts to text; LEN returns character count.
- TRIM/UPPER/LOWER normalize incoming text before comparisons.
- SUBSTR is 1-based: SUBSTR(text, 1, 3) returns first 3 characters.
- CONTAINS/STARTS_WITH/ENDS_WITH return 1 or 0 and can be used directly in IF conditions.
- REPLACE(text, find, with[, max]) replaces up to max matches; omitting max replaces all.
- SPLIT_PART(text, delim, index[, fallback]) is 1-based token lookup.
- SPLIT_COUNT returns token count for a delimiter.
- SPLIT_INTO(text, delim, prefix) writes prefix_COUNT and prefix_1..prefix_N variables.

ARC / CIRCLE RULES (G2/G3)
- Prefer center-format arcs (I/J) over radius-format (R) when possible; center format is more stable.
- Always set the arc plane before arcs. Use G17 for XY-plane arcs in this app.
- For arcs in G17, include X and/or Y endpoint and include I and/or J center offsets.
- I/J are center offsets from the arc start point (incremental arc center style).
- Keep feed explicit before arc motion (set F in a prior move or on the arc command).
- Helical arcs in G17 may include Z while X/Y follow the circular path.
- If using R format: R>0 means sweep under 180 deg, R<0 means sweep over 180 deg.
- Avoid near-semicircle and near-full-circle R arcs (numerically fragile). Prefer I/J.
- Keep arc endpoints and center consistent so radius(start->center) ~= radius(end->center).
- Do not emit unsupported planes for preview in this app; avoid G18/G19 arcs unless user explicitly asks.

AUTHORING RULES
- Validation blocks save/preview when syntax errors exist.
- Preview/runtime fail on undefined variables.
- Use REM for program comments, or ';' only for import headers.
- Do not use // comments.
- Use REQUIRE_OK when generating motion/control commands unless the user explicitly asks for another pacing mode.
- Prefer STATUS for polling machine status in scripts; avoid SEND "?" unless the user explicitly asks for it.
- SEND_DELAY defaults to 0; do not add redundant SET SEND_DELAY 0 lines unless the user asks for explicit pacing.

BENCH MARKERS
- BENCH protocol has three marker lines emitted via PRINT: BENCH META, BENCH START, BENCH END.
- BENCH META sets chart metadata/axis mapping; send it before the first BENCH START.
- BENCH_LAST_MS() returns the elapsed ms for the most recently completed BENCH START/END pair.

EXAMPLE QUALITY RULES
- Prefer complete script packages with ; TITLE, ; VERSION, ; AUTHOR, ; DESCRIPTION, and ; VAR headers.
- Keep numbered lines left-aligned (no leading indentation before line numbers).
- Use FORM() confirmation before machine motion in demos where accidental movement would be unsafe.
- For benchmark demos that move axes, include a cancel path and explicit END on success path.

DIAGNOSTIC RESPONSE CONTRACT
- Use diagnostic headings only when the user is explicitly troubleshooting/debugging or asks to analyze terminal/log output.
- For diagnostic replies, start with these headings in order:
  1) Evidence from terminal log
  2) Most likely cause
  3) Suggested next checks
- Under "Evidence from terminal log", cite 1-3 concrete lines/fragments from the provided terminal context.
- For script-generation or general authoring prompts, do NOT add diagnostic sections unless the user explicitly asks for diagnosis.
- Do not classify commands/statements as unsupported unless the provided rules/profile explicitly show that.
- If a response line (for example ok/error) appears before WAIT_FOR_LINE starts, diagnose this as an ordering/race issue rather than a timeout-duration issue.

CANONICAL SCRIPT SHAPE
; TITLE: Example
; VERSION: 1
; AUTHOR: GitHub Copilot
; DESCRIPTION: Cut a slot of {distance}mm at {feed_rate} mm/min with a safe retract of {safe_z}mm.
; VAR feed_rate=1000
; VAR distance=50
; VAR safe_z=5
10 LET local_value = {distance}
20 SEND "G1 X" & local_value & " F" & {feed_rate} TIMEOUT 2000 REQUIRE_OK
30 END

COMMON FAILURE TRAPS
- Wrong: 10 LET x = (square_size / 2)
  Reason: square_size is undefined unless declared as ; VAR square_size=...
- Wrong: claiming PRINT is unsupported in GCOM.
  Reason: PRINT is a supported GCOM statement.
- Wrong: claiming SEND "?" is invalid just because no ack was received.
  Reason: a timeout on status query can be transport/runtime behavior; inspect terminal evidence before rewriting commands.
- Wrong: increasing WAIT_FOR_LINE timeout when the expected line already arrived before WAIT_FOR_LINE started.
  Reason: WAIT_FOR_LINE matches new incoming lines only; it does not replay earlier consumed lines.
- Wrong: COS(angle * PI / 180)
  Reason: COS already expects degrees in GCOM.
- Wrong: LET x = ... + x inside a loop when x is also the center/reference position.
  Reason: this causes cumulative drift unless explicitly intended.
- Wrong: SEND "G2 ... R..." for near-180 deg or near-360 deg arcs.
  Reason: small endpoint rounding can cause large path errors; use I/J center format.
- Wrong: SEND "G2/G3 ..." without plane and center semantics being clear.
  Reason: arcs depend on active plane and center interpretation; emit explicit G17 and I/J.

VAR DEFAULT VALUES
When declaring ; VAR headers, use realistic defaults so preview produces meaningful motion output:
- Coordinates / positions: non-zero typical values (e.g., x_start=0, y_start=0, x_end=100, y_end=100)
- Feed rates: realistic mm/min (e.g., feed_rate=800, plunge_rate=300, rapid_rate=3000)
- Distances, depth, travel: typical CNC mm values (e.g., distance=50, depth=5, safe_z=5, x_travel=100, y_travel=100)
- Diameters, radii: typical sizes (e.g., tool_diameter=6, hole_diameter=12, radius=25)
- Counts (steps, passes, repeats): small positive integers (e.g., steps=36, passes=3, repeats=4)
- Angles: typical degree values (e.g., start_angle=0, end_angle=360, step_angle=10)
- Timeouts / settle: ms values (e.g., idle_timeout=12000, settle_ms=200)
- Never use 0 for any geometric parameter — zero causes no motion in preview.
- Never leave ; VAR name= empty.

PREFLIGHT
Before emitting a script, verify:
- TITLE and DESCRIPTION headers exist
- DESCRIPTION includes the most pertinent placeholders for user-tunable behavior
- every placeholder has a ; VAR declaration
- every identifier is defined before first use
- no unsupported statements are present
- no // comments are present
- SIN/COS/TAN inputs are already in degrees
- G2/G3 arcs specify plane and center correctly (prefer G17 + I/J)
- arc endpoints and center produce consistent radius (avoid impossible arcs)
`;

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

      const composerCtx = (body.composerContext && typeof body.composerContext === 'object') ? body.composerContext : null;
      if (composerCtx) {
        const composerParts = [];
        const meta = (composerCtx.meta && typeof composerCtx.meta === 'object') ? composerCtx.meta : {};
        const vars = (composerCtx.vars && typeof composerCtx.vars === 'object') ? composerCtx.vars : {};
        const terminalCtx = (composerCtx.terminalContext && typeof composerCtx.terminalContext === 'object') ? composerCtx.terminalContext : null;
        const profile = (composerCtx.controllerProfile && typeof composerCtx.controllerProfile === 'object') ? composerCtx.controllerProfile : null;
        const varEntries = Object.entries(vars).slice(0, 80);

        composerParts.push(`\n\n=== CURRENT COMPOSER CONTEXT ===`);
        if (meta.title || meta.version || meta.author || meta.description) {
          composerParts.push(`Current metadata:`);
          if (meta.title) composerParts.push(`- title: ${meta.title}`);
          if (meta.version) composerParts.push(`- version: ${meta.version}`);
          if (meta.author) composerParts.push(`- author: ${meta.author}`);
          if (meta.description) composerParts.push(`- description: ${meta.description}`);
        }
        if (varEntries.length) {
          composerParts.push(`Current variable defaults:`);
          for (const [k, v] of varEntries) composerParts.push(`- ${k}=${v}`);
        }
        if (composerCtx.scriptSource && String(composerCtx.scriptSource).trim()) {
          const lines = String(composerCtx.scriptSource).split('\n').slice(0, 120);
          composerParts.push(`Current script source (first ${lines.length} line(s)):`);
          composerParts.push('```gcom');
          composerParts.push(lines.join('\n'));
          composerParts.push('```');
        }
        if (terminalCtx && Array.isArray(terminalCtx.lines) && terminalCtx.lines.length) {
          const source = String(terminalCtx.source || 'terminal-output');
          const requestedByUser = terminalCtx.requestedByUser === true ? 'yes' : 'no';
          const includedByToggle = terminalCtx.includedByToggle === true ? 'yes' : 'no';
          const includedByRecentError = terminalCtx.includedByRecentError === true ? 'yes' : 'no';
          const terminalLines = terminalCtx.lines.slice(-120).map(line => String(line || ''));

          composerParts.push('Recent terminal output context:');
          composerParts.push(`- source: ${source}`);
          composerParts.push(`- requested by user: ${requestedByUser}`);
          composerParts.push(`- included by toggle: ${includedByToggle}`);
          composerParts.push(`- included by recent error: ${includedByRecentError}`);
          composerParts.push(`Terminal log lines (${terminalLines.length}):`);
          for (const line of terminalLines) composerParts.push(`- ${line}`);
        }
        if (profile) {
          const guidance = (profile.ai_guidance && typeof profile.ai_guidance === 'object') ? profile.ai_guidance : {};
          const ackPolicy = (profile.ack_policy && typeof profile.ack_policy === 'object') ? profile.ack_policy : {};
          const capabilities = (profile.capabilities && typeof profile.capabilities === 'object') ? profile.capabilities : {};
          const gcodeCore = Array.isArray(capabilities.gcode_core) ? capabilities.gcode_core.slice(0, 120) : [];

          composerParts.push(`Active controller profile:`);
          if (profile.id) composerParts.push(`- id: ${profile.id}`);
          if (profile.label) composerParts.push(`- label: ${profile.label}`);
          if (profile.controller_family) composerParts.push(`- family: ${profile.controller_family}`);
          if (profile.status) composerParts.push(`- status: ${profile.status}`);
          if (ackPolicy.mode) composerParts.push(`- ack mode: ${ackPolicy.mode}`);
          if (Number.isFinite(Number(ackPolicy.default_timeout_ms)) && Number(ackPolicy.default_timeout_ms) > 0) {
            composerParts.push(`- ack default timeout ms: ${Number(ackPolicy.default_timeout_ms)}`);
          }
          if (gcodeCore.length) composerParts.push(`- supported core G-codes: ${gcodeCore.join(', ')}`);
          if (guidance.summary) composerParts.push(`- guidance summary: ${guidance.summary}`);
          if (Array.isArray(guidance.preferred_style) && guidance.preferred_style.length) {
            composerParts.push(`- preferred style: ${guidance.preferred_style.join(' | ')}`);
          }
          if (Array.isArray(guidance.avoid) && guidance.avoid.length) {
            composerParts.push(`- avoid: ${guidance.avoid.join(' | ')}`);
          }
          if (guidance.compatibility_policy) {
            composerParts.push(`- compatibility policy: ${guidance.compatibility_policy}`);
          }
        }
        composerParts.push(`=== END COMPOSER CONTEXT ===`);

        contextAddendum += composerParts.join('\n');
      }

      const blockReason = (body.blockReason && typeof body.blockReason === 'object') ? body.blockReason : null;
      if (blockReason) {
        const blockParts = [];
        blockParts.push(`\n\n=== INSERT BLOCK REASON ===`);
        blockParts.push(`ruleId: ${String(blockReason.ruleId || 'unknown')}`);
        const details = Array.isArray(blockReason.details) ? blockReason.details.slice(0, 25) : [];
        if (details.length) {
          blockParts.push('details:');
          for (const d of details) blockParts.push(`- ${String(d)}`);
        }
        if (body.signature) blockParts.push(`failureSignature: ${String(body.signature)}`);
        if (body.failedScript) {
          const failedLines = String(body.failedScript).split('\n').slice(0, 180);
          blockParts.push('blockedScript:');
          blockParts.push('```gcom');
          blockParts.push(failedLines.join('\n'));
          blockParts.push('```');
        }
        blockParts.push(`=== END INSERT BLOCK REASON ===`);
        contextAddendum += blockParts.join('\n');
      }

      const sessionLearning = (body.sessionLearning && typeof body.sessionLearning === 'object') ? body.sessionLearning : null;
      if (sessionLearning) {
        const learnParts = [];
        learnParts.push(`\n\n=== SESSION LEARNING ===`);
        const topFailures = Array.isArray(sessionLearning.topFailures) ? sessionLearning.topFailures.slice(0, 8) : [];
        if (topFailures.length) {
          learnParts.push('topRepeatedFailures:');
          for (const f of topFailures) {
            learnParts.push(`- ${String(f.signature || 'unknown')} (count=${Number(f.count || 0)})`);
          }
        }
        const latestSuccess = sessionLearning.latestSuccess;
        if (latestSuccess && typeof latestSuccess === 'object') {
          learnParts.push('latestSuccessfulRepairSignature: ' + String(latestSuccess.signature || 'unknown'));
        }
        const approvedRules = Array.isArray(sessionLearning.approvedBrainRules) ? sessionLearning.approvedBrainRules.slice(-20) : [];
        if (approvedRules.length) {
          learnParts.push('approvedBrainRules:');
          for (const r of approvedRules) {
            if (r && typeof r === 'object') {
              const patch = String(r.instructionPatch || '').slice(0, 300);
              learnParts.push(`- ${String(r.signature || r.id || 'rule')}: ${patch}`);
            }
          }
        }
        learnParts.push(`=== END SESSION LEARNING ===`);
        contextAddendum += learnParts.join('\n');
      }

      try {
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: GCOM_SYSTEM + '\n\n' + GCOM_HELP_MANIFEST + '\n\n' + (mode === 'repair' ? REPAIR_SYSTEM : '') + contextAddendum },
            ...messages,
          ],
          max_tokens: 1200,
          temperature: 0.4,
        });
        const reply = String(aiResponse.response || '');
        return new Response(JSON.stringify({ reply, repairMeta: { mode, usedRepairSystem: mode === 'repair' } }), {
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
