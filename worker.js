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

/* ─── SERVERSIDE VALIDATION SERVICE ───────────────────────────────────────
   Structured diagnostic model and validation logic owned by worker.
   Provides /api/validation endpoint for client and third-party access.
*/

// Diagnostic codes and severity levels
const VALIDATION_DIAGNOSTIC_CODES = {
  E001_SYNTAX: 'E001', E002_UNDEFINED_VAR: 'E002', E003_INVALID_LINE_NUM: 'E003',
  E004_DUPLICATE_LINE_NUM: 'E004', E005_INVALID_STATEMENT: 'E005', E006_INVALID_EXPRESSION: 'E006',
  E007_INVALID_FUNCTION: 'E007', E008_MALFORMED_BRACKETS: 'E008', E009_INVALID_PLACEHOLDER: 'E009',
  E010_MISSING_END: 'E010', E101_UNDEFINED_JUMP_TARGET: 'E101', E102_UNDEFINED_GOSUB_TARGET: 'E102',
  E103_VARIABLE_USED_UNDEFINED: 'E103', E104_INVALID_FOR_STEP: 'E104', E105_NEXT_MISMATCH: 'E105',
  E106_ORPHANED_NEXT: 'E106', E107_ORPHANED_RETURN: 'E107',
  W001_BACKWARD_GOTO: 'W001', W002_DIV_BY_ZERO_RISK: 'W002', W003_INVALID_STEP_ZERO: 'W003',
  W004_BUFFER_OVERFLOW_RISK: 'W004', W005_ORPHANED_GOSUB: 'W005', W006_UNUSED_VARIABLE: 'W006',
  W007_UNINITIALIZED_VARIABLE: 'W007', C001_COMPILE_ERROR: 'C001', C002_MACRO_EXPANSION_ERROR: 'C002',
  C003_INVALID_INTERPOLATION: 'C003'
};

const VALIDATION_SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

function createValidationDiagnostic(lineNum, code, severity, message, context = {}) {
  return {
    lineNum: Number(lineNum) || null, code: String(code), severity: String(severity).toLowerCase(),
    message: String(message), context: {
      variableName: context.variableName ? String(context.variableName) : null,
      suggestion: context.suggestion ? String(context.suggestion) : null,
      relatedLines: Array.isArray(context.relatedLines) ? context.relatedLines.filter(n => Number.isFinite(n)) : [],
      sourceText: context.sourceText ? String(context.sourceText).slice(0, 200) : null
    }, timestamp: new Date().toISOString()
  };
}

function initializeValidationState() {
  return {
    all: [], byLine: {}, byCode: {}, bySeverity: { error: [], warning: [], info: [] },
    summary: { totalCount: 0, errorCount: 0, warningCount: 0, infoCount: 0, firstError: null, lastUpdated: null }
  };
}

function addValidationDiagnostic(state, diagnostic) {
  state.all.push(diagnostic);
  const ln = diagnostic.lineNum;
  if (ln != null) { if (!state.byLine[ln]) state.byLine[ln] = []; state.byLine[ln].push(diagnostic); }
  const code = diagnostic.code;
  if (!state.byCode[code]) state.byCode[code] = []; state.byCode[code].push(diagnostic);
  state.bySeverity[diagnostic.severity].push(diagnostic);
  state.summary.totalCount = state.all.length;
  state.summary.errorCount = state.bySeverity.error.length;
  state.summary.warningCount = state.bySeverity.warning.length;
  state.summary.infoCount = state.bySeverity.info.length;
  if (state.summary.errorCount > 0 && !state.summary.firstError) state.summary.firstError = state.bySeverity.error[0];
  state.summary.lastUpdated = new Date().toISOString();
}

// Helper validators
function basicSplitStatementChain(line) {
  const tokens = String(line || '').split(/\s+/);
  const statement = tokens[0]?.toUpperCase();
  return tokens.length > 0 ? [{ statement, args: tokens.slice(1) }] : [];
}

function basicNormalizeRuntimeVarName(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase() : '';
}

const ALLOWED_SET_KEYS = new Set([
  'SEND_DELAY', 'ACK_TIMEOUT', 'RX_BUFFER', 'SEND_MODE',
  'BANNER_TIMEOUT', 'READY_SETTLE', 'SEQUENCE_DELAY', 'STATUS_DELAY'
]);

function extractStaticSendText(sendExpr) {
  const match = String(sendExpr || '').trim().match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) return null;
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function validateArcSendPayload(sendText, lineNum, addErr) {
  const command = String(sendText || '').trim();
  if (!/^G0?[23]\b/i.test(command)) return;

  const hasRadius = /\bR[-+]?(?:\d|\.\d)/i.test(command);
  const hasCenterOffsets = /\b[IJK][-+]?(?:\d|\.\d)/i.test(command);
  const hasTurns = /\bP[-+]?(?:\d|\.\d)/i.test(command);
  const hasEndpointXY = /\b[XY][-+]?(?:\d|\.\d)/i.test(command);

  if (hasRadius && hasCenterOffsets) {
    addErr(lineNum, 'G2/G3 cannot mix R with I/J/K in the same arc command', VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
    return;
  }

  if (hasRadius && !hasEndpointXY) {
    addErr(lineNum, 'R-format G2/G3 requires an X and/or Y endpoint in G17', VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
    return;
  }

  if (hasRadius && hasTurns) {
    addErr(lineNum, 'Multi-turn/full-circle arcs should use center format (I/J[/K]) with P, not R', VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
    return;
  }

  if (!hasRadius && !hasCenterOffsets) {
    addErr(lineNum, 'G2/G3 requires either R or I/J/K arc parameters', VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
  }
}

function validateGcomSource(source, vars = {}, state = null) {
  if (!state) state = initializeValidationState();
  const lines = {}, order = [], definedVars = new Set(Object.keys(vars || {}));
  const addErr = (ln, msg, code) => addValidationDiagnostic(state, createValidationDiagnostic(ln, code, VALIDATION_SEVERITY.ERROR, msg));
  const statementBuckets = new Map();
  let executableCount = 0;
  
  source.split('\n').forEach((rawLine, idx) => {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed || trimmed.startsWith('REM')) return;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) { addErr(idx + 1, `expected "<line-number> <statement>"`, VALIDATION_DIAGNOSTIC_CODES.E003_INVALID_LINE_NUM); return; }
    const lineNum = parseInt(match[1], 10);
    if (lines[lineNum]) { addErr(lineNum, `duplicate line number`, VALIDATION_DIAGNOSTIC_CODES.E004_DUPLICATE_LINE_NUM); return; }
    const statement = String(match[2] || '').trim();

    const setMatch = statement.match(/^SET\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/i);
    if (setMatch) {
      const rawKey = String(setMatch[1] || '').trim();
      const key = rawKey.toUpperCase();
      const valueExpr = String(setMatch[2] || '').trim();

      if (!ALLOWED_SET_KEYS.has(key)) {
        if (/^[GM]\d+(?:\.\d+)?$/i.test(rawKey)) {
          addErr(lineNum, `SET ${rawKey} is invalid; use SEND \"${rawKey}\" for modal gcode`, VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
        } else {
          addErr(lineNum, `unsupported SET key \"${rawKey}\"`, VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
        }
      } else if (!valueExpr) {
        addErr(lineNum, `SET ${rawKey} requires a value expression`, VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT);
      }
    }

    const sendMatch = statement.match(/^SEND\s+(.+)$/i);
    if (sendMatch) {
      const sendBody = String(sendMatch[1] || '').trim();
      const timeoutIndex = sendBody.toUpperCase().lastIndexOf(' TIMEOUT ');
      const sendExpr = timeoutIndex === -1 ? sendBody : sendBody.slice(0, timeoutIndex).trim();
      const staticSendText = extractStaticSendText(sendExpr);
      if (staticSendText != null) {
        validateArcSendPayload(staticSendText, lineNum, addErr);
      }
    }

    lines[lineNum] = statement; order.push(lineNum);

    if (!/^(REM\b|END\b)$/i.test(statement)) {
      executableCount += 1;
      const key = statement.replace(/\s+/g, ' ').toUpperCase();
      const bucket = statementBuckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.lines.push(lineNum);
      } else {
        statementBuckets.set(key, { count: 1, lines: [lineNum], sample: statement });
      }
    }
  });

  if (executableCount >= 12) {
    let top = null;
    statementBuckets.forEach(bucket => {
      if (!top || bucket.count > top.count) top = bucket;
    });
    if (top) {
      const ratio = top.count / executableCount;
      if (top.count >= 12 && ratio >= 0.5) {
        addErr(
          top.lines[0] || null,
          `repeated line-content detected: the same statement appears ${top.count} times (${Math.round(ratio * 100)}% of executable lines). Sample: "${top.sample}"`,
          VALIDATION_DIAGNOSTIC_CODES.E005_INVALID_STATEMENT
        );
      }
    }
  }
  
  if (order.length && !/^END$/i.test(lines[order[order.length - 1]])) {
    addErr(order[order.length - 1], `program must end with END`, VALIDATION_DIAGNOSTIC_CODES.E010_MISSING_END);
  }
  
  return { diagnostics: state, lines, order, definedVars };
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

    // Validation API endpoint
    if (url.pathname === '/api/validation') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: SCRIPT_CORS_HEADERS });
      }
      
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS }
        });
      }
      
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON', details: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS }
        });
      }
      
      const source = String(body.source || '').trim();
      const vars = body.vars && typeof body.vars === 'object' ? body.vars : {};
      const profile = String(body.profile || 'grbl').toLowerCase();
      
      if (!source) {
        return new Response(JSON.stringify({ error: 'Missing source code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS }
        });
      }
      
      try {
        const result = validateGcomSource(source, vars);
        return new Response(JSON.stringify({
          success: true,
          diagnostics: result.diagnostics.all,
          summary: result.diagnostics.summary,
          byLine: result.diagnostics.byLine,
          bySeverity: result.diagnostics.bySeverity,
          profile,
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Validation failed', details: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...SCRIPT_CORS_HEADERS }
        });
      }
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
      const intent = String(body.intent || 'neutral').toLowerCase();

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
- IF statements must be single-line and complete: IF <condition> THEN <action>. Never emit a bare THEN with no action.
- Every FOR must have a matching NEXT, and every generated script must include a final END line.
- Never emit bare identifiers in expressions unless they were defined by LET earlier or are declared placeholders {name}.
- Emit only supported statements listed above.
- Prefer SEND + REQUIRE_OK/BUFFERED modifiers over legacy SENDACK/SENDBUFF spellings.

TEXT / FONT ENGRAVING RULES (must follow when user asks for words/letters/text/font):
- Treat each character as a geometric stroke shape made of multiple line/arc segments; never represent a letter with one single straight segment.
- Build text using pen-up / pen-down behavior (or laser-off / laser-on equivalent) between disconnected strokes.
- For each glyph, emit a short sequence of segment moves that visibly forms that character (for example vertical + horizontal segments for H, loop-like segments for O).
- Use consistent baseline, x-advance, and spacing variables so words are readable and characters do not overlap.
- Prefer concise reusable logic (for example per-glyph dispatch with shared stroke primitives) over giant repetitive unrolled line spam.
- If the requested text is long, generate a representative subset plus clear variables for scale/spacing instead of thousands of repeated lines.

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
For script-generation requests (for example: make/create/write/generate), output ONLY:
1) One \`\`\`gcom fenced block
2) Optional ACTIONS HTML comment
Do not prepend explanatory prose before the fenced block.
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
- For FluidNC, reset modal state early in files/macros (for example: G0 G54 G17 G21 G90 G94).
- Always set the arc plane before arcs. Use G17 for XY-plane arcs in this app unless the user explicitly requests G18/G19.
- For arcs in G17, include X and/or Y endpoint and include I and/or J center offsets.
- I/J are center offsets from the arc start point (incremental arc center style).
- Do not emit SET G17 or other SET G/M statements; modal gcode belongs in SEND "...".
- Keep feed explicit before arc motion (set F in a prior move or on the arc command).
- FluidNC requires feed rate > 0 before G1/G2/G3 motion.
- Helical arcs in G17 may include Z while X/Y follow the circular path.
- For helical arcs, keep center format explicit (I/J with optional Z endpoint), not ambiguous R-only arcs.
- For full circles or multi-turn arcs, prefer center format with P turns; avoid R-format full-circle construction.
- If using R format: R>0 means sweep under 180 deg, R<0 means sweep over 180 deg.
- Never mix R with I/J/K in a single G2/G3 command.
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
- For text/letter engraving examples, include at least one character that uses 3+ segments so stroke-font intent is explicit.

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
- Wrong: SEND "G2 ... R... P2" for full-circle or multi-turn behavior.
  Reason: FluidNC arc validation for full rotations is center-format sensitive; use I/J (+P) instead of R.
- Wrong: SEND "G3 Z... R..." for helical interpolation in XY workflows.
  Reason: helical intent is clearer and safer with explicit I/J center offsets and Z endpoint.

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

      // ─── PHASE 5: STRUCTURED DIAGNOSTICS RENDERER ───────────────────────────
      // Converts structured validation diagnostics into AI-friendly context blocks
      const diagnosticsCtx = (body.diagnosticsContext && typeof body.diagnosticsContext === 'object') ? body.diagnosticsContext : null;
      let diagnosticsContextBlock = '';
      
      if (diagnosticsCtx && diagnosticsCtx.summary && diagnosticsCtx.summary.totalCount > 0) {
        const summary = diagnosticsCtx.summary;
        const allDiags = Array.isArray(diagnosticsCtx.all) ? diagnosticsCtx.all : [];
        const byLine = (diagnosticsCtx.byLine && typeof diagnosticsCtx.byLine === 'object') ? diagnosticsCtx.byLine : {};
        const bySeverity = (diagnosticsCtx.bySeverity && typeof diagnosticsCtx.bySeverity === 'object') ? diagnosticsCtx.bySeverity : {};
        
        // Build diagnostics summary organized by severity and code
        const diagParts = [];
        diagParts.push(`\n\n=== STRUCTURED VALIDATION DIAGNOSTICS ===`);
        diagParts.push(`Summary: ${summary.errorCount || 0} error(s), ${summary.warningCount || 0} warning(s), ${summary.infoCount || 0} info(s).`);
        
        // Group diagnostics by severity
        if (Array.isArray(bySeverity.error) && bySeverity.error.length) {
          diagParts.push(`\nERRORS (${bySeverity.error.length}):`);
          const errorsByCode = {};
          for (const diag of bySeverity.error) {
            if (!errorsByCode[diag.code]) errorsByCode[diag.code] = [];
            errorsByCode[diag.code].push(diag);
          }
          for (const [code, diags] of Object.entries(errorsByCode)) {
            diagParts.push(`  [${code}] ${diags[0].message}${diags.length > 1 ? ` (${diags.length} instances)` : ''}`);
            for (const d of diags.slice(0, 3)) {
              if (d.lineNum != null) diagParts.push(`    Line ${d.lineNum}: ${d.message}`);
            }
          }
        }
        
        if (Array.isArray(bySeverity.warning) && bySeverity.warning.length) {
          diagParts.push(`\nWARNINGS (${bySeverity.warning.length}):`);
          const warnsByCode = {};
          for (const diag of bySeverity.warning) {
            if (!warnsByCode[diag.code]) warnsByCode[diag.code] = [];
            warnsByCode[diag.code].push(diag);
          }
          for (const [code, diags] of Object.entries(warnsByCode)) {
            diagParts.push(`  [${code}] ${diags[0].message}${diags.length > 1 ? ` (${diags.length} instances)` : ''}`);
            for (const d of diags.slice(0, 2)) {
              if (d.lineNum != null) diagParts.push(`    Line ${d.lineNum}: ${d.message}`);
            }
          }
        }
        
        // For AI diagnostic mode, include full detail breakdown by line
        if (intent === 'diagnostic') {
          const linesSorted = Object.keys(byLine).map(Number).sort((a, b) => a - b);
          if (linesSorted.length > 0) {
            diagParts.push(`\nDiagnostics by line number:`);
            for (const lineNum of linesSorted.slice(0, 30)) {
              const lineDiags = byLine[lineNum] || [];
              for (const d of lineDiags) {
                diagParts.push(`  L${lineNum}: [${d.code}] ${d.message}`);
              }
            }
          }
        }
        
        diagParts.push(`=== END DIAGNOSTICS ===`);
        diagnosticsContextBlock = diagParts.join('\n');
      }

      let contextAddendum = '';
      const ctx = (body.gcomContext && typeof body.gcomContext === 'object') ? body.gcomContext : null;
      if (ctx) {
        const cmds = Array.isArray(ctx.commands) ? ctx.commands : [];
        const segs = Array.isArray(ctx.segments) ? ctx.segments : [];
        const tape = Array.isArray(ctx.commandTape) ? ctx.commandTape : [];
        const srcCtx = Array.isArray(ctx.sourceContext) ? ctx.sourceContext : [];
        const geo = (ctx.geometric && typeof ctx.geometric === 'object') ? ctx.geometric : {};
        const selectionSummary = (ctx.selectionSummary && typeof ctx.selectionSummary === 'object') ? ctx.selectionSummary : null;
        if (cmds.length > 0 || tape.length > 0) {
          const parts = [];
          parts.push(`\n\n=== COMMAND TAPE SELECTION CONTEXT ===`);
          parts.push(`The user selected ${cmds.length} command(s) and ${segs.length} motion segment(s) from the preview of script: "${ctx.scriptTitle || 'Untitled'}".`);
          parts.push(`Script totals: ${ctx.totalCommandsInScript || '?'} commands, ${ctx.totalSegmentsInScript || '?'} segments.`);
          if (selectionSummary && selectionSummary.note) parts.push(`Focus rule: ${selectionSummary.note}`);

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

          if (tape.length > 0) {
            const selectedIds = new Set(Array.isArray(selectionSummary?.selectedCommandIds) ? selectionSummary.selectedCommandIds : cmds.map(c => c.commandId));
            parts.push(`\nFull command tape (all commands; * marks selected focus):`);
            for (const c of tape) {
              const marker = selectedIds.has(c.commandId) ? '*' : ' ';
              parts.push(` ${marker} [${Number(c.commandId) + 1}] L${c.sourceLine ?? '?'} | ${c.raw || c.display || ''}`);
            }
          }

          // GCOM source lines that generated the selection — this is the genesis context
          if (srcCtx.length > 0) {
            parts.push(`\nGCOM source lines that generated the selection (with surrounding context):`);
            for (const entry of srcCtx.slice(0, 120)) {
              const lineNumber = entry.lineNumber != null ? entry.lineNumber : entry.physicalLineNumber;
              parts.push(`  ${String(lineNumber).padStart(4, ' ')}: ${entry.text}`);
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

      let machineContractSystemMessage = '';
      let activeProfileRuleSet = null;
      let activeProfileOperations = null;
      const composerCtx = (body.composerContext && typeof body.composerContext === 'object') ? body.composerContext : null;
      if (composerCtx) {
        const composerParts = [];
        const meta = (composerCtx.meta && typeof composerCtx.meta === 'object') ? composerCtx.meta : {};
        const uiFields = (composerCtx.uiFields && typeof composerCtx.uiFields === 'object') ? composerCtx.uiFields : {};
        const vars = (composerCtx.vars && typeof composerCtx.vars === 'object') ? composerCtx.vars : {};
        const validation = (composerCtx.validation && typeof composerCtx.validation === 'object') ? composerCtx.validation : null;
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
        if (uiFields && Object.keys(uiFields).length) {
          composerParts.push(`Composer UI fields:`);
          if (uiFields.descriptionRendered) composerParts.push(`- rendered description: ${uiFields.descriptionRendered}`);
          if (uiFields.sourceId) composerParts.push(`- source id: ${uiFields.sourceId}`);
          if (uiFields.descriptionTab) composerParts.push(`- description tab: ${uiFields.descriptionTab}`);
        }
        if (varEntries.length) {
          composerParts.push(`Current variable defaults:`);
          for (const [k, v] of varEntries) composerParts.push(`- ${k}=${v}`);
        }
        if (validation) {
          composerParts.push(`Latest syntax check:`);
          composerParts.push(`- has errors: ${validation.hasErrors ? 'yes' : 'no'}`);
          composerParts.push(`- has warnings: ${validation.hasWarnings ? 'yes' : 'no'}`);
          if (validation.summaryText) composerParts.push(`- summary: ${validation.summaryText}`);
          if (Array.isArray(validation.errors) && validation.errors.length) {
            composerParts.push('Validation errors:');
            for (const err of validation.errors.slice(0, 40)) composerParts.push(`- ${String(err)}`);
          }
          if (Array.isArray(validation.warnings) && validation.warnings.length) {
            composerParts.push('Validation warnings:');
            for (const warn of validation.warnings.slice(0, 40)) composerParts.push(`- ${String(warn)}`);
          }
        }
        if (composerCtx.scriptSource && String(composerCtx.scriptSource).trim()) {
          const lines = String(composerCtx.scriptSource).split('\n');
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
          const profileMachine = (profile.machine_description && typeof profile.machine_description === 'object')
            ? profile.machine_description
            : profile;
          const ruleSet = (profile.rule_set && typeof profile.rule_set === 'object' && !Array.isArray(profile.rule_set))
            ? profile.rule_set
            : null;
          const operations = (profile.operations && typeof profile.operations === 'object' && !Array.isArray(profile.operations))
            ? profile.operations
            : null;
          activeProfileRuleSet = ruleSet;
          activeProfileOperations = operations;
          const guidance = (profileMachine.ai_guidance && typeof profileMachine.ai_guidance === 'object') ? profileMachine.ai_guidance : {};
          const ackPolicy = (profileMachine.ack_policy && typeof profileMachine.ack_policy === 'object') ? profileMachine.ack_policy : {};
          const capabilities = (profileMachine.capabilities && typeof profileMachine.capabilities === 'object') ? profileMachine.capabilities : {};
          const gcodeCore = Array.isArray(capabilities.gcode_core) ? capabilities.gcode_core.slice(0, 120) : [];

          composerParts.push(`Active controller profile:`);
          if (profileMachine.id) composerParts.push(`- id: ${profileMachine.id}`);
          if (profileMachine.label) composerParts.push(`- label: ${profileMachine.label}`);
          if (profileMachine.controller_family) composerParts.push(`- family: ${profileMachine.controller_family}`);
          if (profileMachine.status) composerParts.push(`- status: ${profileMachine.status}`);
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

          const contractParts = [];
          contractParts.push('=== MACHINE CONTRACT (MUST FOLLOW) ===');
          contractParts.push('- You MUST use abstract keywords from the active rule_set. Writing SEND "$H" when HOME exists in the rule_set is an error. Writing SEND "M3 S..." when SPINDLE_ON exists in the rule_set is an error.');
          contractParts.push('- You MUST use named operations for motion sequences. Do not write raw SEND "G0..." or SEND "G1..." lines when rapid_move or cut_move exist in the operations block.');
          contractParts.push('- Never concatenate multiple G-code commands into a single SEND string. Each SEND must contain exactly one G-code command.');
          contractParts.push('- Never use a spindle/laser power variable as a feed rate. Feed rate is speed. Laser power is spindlespeed. These are distinct variables with different defaults and purposes.');

          const orderedKeywords = ['HOME', 'STATUS', 'RESET', 'SPINDLE_ON', 'PROBE'];
          const ruleEntries = ruleSet
            ? orderedKeywords
              .filter(keyword => ruleSet[keyword] && typeof ruleSet[keyword] === 'object')
              .map(keyword => [keyword, ruleSet[keyword]])
            : [];
          if (ruleEntries.length) {
            contractParts.push('Active rule_set keyword table (keyword -> emit template):');
            contractParts.push('| Keyword | Emit Template |');
            contractParts.push('| --- | --- |');
            for (const [keyword, definition] of ruleEntries) {
              const emit = typeof definition.emit === 'string' ? definition.emit.trim() : '';
              const unsupported = definition.unsupported === true;
              contractParts.push(`| ${keyword} | ${unsupported ? 'unsupported' : (emit || 'emit not defined')} |`);
            }
          }

          const boilerplate = (profileMachine.boilerplate_gcom && typeof profileMachine.boilerplate_gcom === 'object')
            ? profileMachine.boilerplate_gcom
            : null;
          if (boilerplate && typeof boilerplate.gcom === 'string' && boilerplate.gcom.trim()) {
            composerParts.push('Recommended boilerplate prior (use as preferred script structure for this machine):');
            if (typeof boilerplate.title === 'string' && boilerplate.title.trim()) {
              composerParts.push(`- title: ${boilerplate.title.trim()}`);
            }
            if (typeof boilerplate.description === 'string' && boilerplate.description.trim()) {
              composerParts.push(`- description: ${boilerplate.description.trim()}`);
            }
            composerParts.push('```gcom');
            composerParts.push(String(boilerplate.gcom).trim());
            composerParts.push('```');
          }

          const operationVariables = (operations && operations.variables && typeof operations.variables === 'object' && !Array.isArray(operations.variables))
            ? operations.variables
            : null;
          const operationEntries = operations
            ? Object.entries(operations).filter(([name, value]) => name !== 'variables' && value && typeof value === 'object' && !Array.isArray(value))
            : [];

          if (operationEntries.length) {
            const variableEntries = operationVariables ? Object.entries(operationVariables) : [];
            if (variableEntries.length) {
              contractParts.push('Active operations variable defaults table:');
              contractParts.push('| Variable | Default | Description |');
              contractParts.push('| --- | --- | --- |');
              for (const [name, definition] of variableEntries) {
                const desc = (definition && typeof definition.description === 'string' && definition.description.trim())
                  ? definition.description.trim()
                  : '';
                const hasDefault = definition && Object.prototype.hasOwnProperty.call(definition, 'default');
                const defaultValue = hasDefault ? JSON.stringify(definition.default) : 'null';
                contractParts.push(`| ${name} | ${defaultValue} | ${desc || '-'} |`);
              }
            }

            contractParts.push('Active operations table (name -> template behavior):');
            contractParts.push('| Operation | Template(s) |');
            contractParts.push('| --- | --- |');
            for (const [name, definition] of operationEntries) {
              const templates = Array.isArray(definition.template)
                ? definition.template.map(line => String(line || '').trim()).filter(Boolean)
                : [];
              if (!templates.length) continue;
              contractParts.push(`| ${name} | ${templates.join(' <br> ')} |`);
            }
          }

          if (contractParts.length > 1) {
            machineContractSystemMessage = contractParts.join('\n');
          }
        }
        composerParts.push(`=== END COMPOSER CONTEXT ===`);

        contextAddendum += composerParts.join('\n');
      }

      // Add structured diagnostics context to overall AI context
      contextAddendum += diagnosticsContextBlock;

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
        const intentInstruction = (() => {
          if (intent === 'creative') {
            const hasDiagErrors = diagnosticsCtx && diagnosticsCtx.summary && diagnosticsCtx.summary.errorCount > 0;
            if (hasDiagErrors) {
              return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is CREATIVE/GENERATIVE but validation found ERRORS. First show a concise "Before I can help" explanation citing the 1-2 most critical errors from the Structured Diagnostics section above, then suggest a focused repair. After errors are fixed, help generate the new script.`;
            }
            return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is CREATIVE/GENERATIVE. If the user is asking for a script, return ONLY one \`\`\`gcom fenced block (plus optional ACTIONS comment), with no leading prose. Do NOT include diagnostic sections (Evidence from terminal log, Most likely cause, Suggested next checks) unless explicitly requested. Focus on script quality, correctness, and concise output.`;
          }
          if (intent === 'diagnostic') {
            const hasDiags = diagnosticsCtx && diagnosticsCtx.summary && diagnosticsCtx.summary.totalCount > 0;
            if (hasDiags) {
              return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is DIAGNOSTIC/TROUBLESHOOTING. Validation diagnostics are included above. Structure your reply: 1) Root cause identified from the diagnostic codes (e.g. [E002_UNDEFINED_VAR] means undefined variable), 2) Evidence from terminal log (if present), 3) Suggested next checks and repair steps. Use the line numbers and error codes as anchors.`;
            }
            return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is DIAGNOSTIC/TROUBLESHOOTING. If terminal output is provided in context, structure your reply: 1) Evidence from terminal log (quote 1-3 relevant lines), 2) Most likely cause, 3) Suggested next checks. Be concise but thorough.`;
          }
          const hasDiags = diagnosticsCtx && diagnosticsCtx.summary && diagnosticsCtx.summary.totalCount > 0;
          if (hasDiags) {
            return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is NEUTRAL. Structured validation diagnostics are available above. If there are errors or warnings, mention them briefly and offer to help fix. Otherwise respond directly to their question.`;
          }
          return `\n=== RESPONSE FORMAT DIRECTIVE ===\nUser intent is NEUTRAL. Respond naturally to their question. If terminal output is provided and diagnosis seems relevant, use the diagnostic structure (Evidence/Cause/Checks). Otherwise respond directly.`;
        })();

        const extractFirstGcomBlock = (text) => {
          const raw = String(text || '');
          const fenced = raw.match(/```gcom\s*\n([\s\S]*?)```/i);
          if (fenced) return String(fenced[1] || '').trim();
          const openOnly = raw.match(/```gcom\s*\n([\s\S]*)$/i);
          if (openOnly) return String(openOnly[1] || '').trim();
          return '';
        };

        const analyzeGcomBlock = (text) => {
          const block = extractFirstGcomBlock(text);
          if (!block) {
            return {
              hasBlock: false,
              lineCount: 0,
              hasEndLine: false,
              suspiciousTail: true,
              sendCount: 0,
              letCount: 0,
              uniqueLineRatio: 1,
              dominantLetVarRatio: 0,
              looksLikeArithmeticChurn: false,
              block,
            };
          }

          const allLines = block.split('\n').map(line => String(line || '').trim()).filter(Boolean);
          const numberedLines = allLines.filter(line => /^\d+\s+/.test(line));
          const executable = numberedLines.map(line => line.replace(/^\d+\s+/, '').trim());
          const nonCommentExec = executable.filter(line => !/^REM\b/i.test(line));
          const hasEndLine = nonCommentExec.some(line => /^END\b/i.test(line));
          const lastLine = nonCommentExec.length ? nonCommentExec[nonCommentExec.length - 1] : '';
          const suspiciousTail = /(?:=\s*$|&\s*$|\+\s*$|-\s*$|\*\s*$|\/\s*$|THEN\s*$|GOTO\s*$|LET\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*$)/i.test(lastLine);

          const sendCount = nonCommentExec.filter(line => /^SEND\b/i.test(line)).length;
          const letLines = nonCommentExec.filter(line => /^LET\b/i.test(line));
          const letCount = letLines.length;

          const normalizedSet = new Set(nonCommentExec.map(line => line.replace(/\s+/g, ' ').toUpperCase()));
          const uniqueLineRatio = nonCommentExec.length ? (normalizedSet.size / nonCommentExec.length) : 1;

          const letVarCounts = new Map();
          let arithmeticChurnCount = 0;
          for (const line of letLines) {
            const m = line.match(/^LET\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
            if (!m) continue;
            const lhs = String(m[1]).toUpperCase();
            const rhs = String(m[2]).trim();
            letVarCounts.set(lhs, (letVarCounts.get(lhs) || 0) + 1);
            if (new RegExp(`^${lhs}\\s*[+\\-*/]\\s*[-+]?\\d+(?:\\.\\d+)?$`, 'i').test(rhs)) {
              arithmeticChurnCount += 1;
            }
          }
          let topVarCount = 0;
          for (const count of letVarCounts.values()) {
            if (count > topVarCount) topVarCount = count;
          }
          const dominantLetVarRatio = letCount ? (topVarCount / letCount) : 0;

          const looksLikeArithmeticChurn =
            nonCommentExec.length >= 60 &&
            letCount >= 40 &&
            dominantLetVarRatio >= 0.7 &&
            uniqueLineRatio <= 0.35 &&
            arithmeticChurnCount >= 20 &&
            sendCount <= 6;

          return {
            hasBlock: true,
            lineCount: nonCommentExec.length,
            hasEndLine,
            suspiciousTail,
            sendCount,
            letCount,
            uniqueLineRatio,
            dominantLetVarRatio,
            looksLikeArithmeticChurn,
            block,
          };
        };

        const isLikelyTruncatedGcomReply = (text) => {
          const raw = String(text || '');
          if (!/```gcom\s*\n/i.test(raw)) return false;
          const analysis = analyzeGcomBlock(raw);
          return !analysis.hasEndLine || analysis.suspiciousTail;
        };

        const applyDeterministicGcomRepair = (replyText, ruleSet, operations) => {
          console.log('[gcom-repair] pass invoked');
          const rawReply = String(replyText || '');
          const fencedMatch = rawReply.match(/```gcom\s*\n([\s\S]*?)```/i);
          if (!fencedMatch) {
            return { reply: rawReply, diagnostics: [] };
          }

          if (!ruleSet || typeof ruleSet !== 'object' || Array.isArray(ruleSet) || !operations || typeof operations !== 'object' || Array.isArray(operations)) {
            return { reply: rawReply, diagnostics: [] };
          }

          const supportsKeyword = (keyword) => {
            const definition = ruleSet[keyword];
            if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return false;
            return definition.unsupported !== true;
          };

          const operationVariables = (operations.variables && typeof operations.variables === 'object' && !Array.isArray(operations.variables))
            ? operations.variables
            : null;
          if (!operationVariables) {
            return { reply: rawReply, diagnostics: [] };
          }

          const resolveOperationVariableRole = (matcher) => {
            for (const [name, definition] of Object.entries(operationVariables)) {
              const description = String(definition && definition.description ? definition.description : '').trim().toLowerCase();
              if (matcher(description, name)) return String(name);
            }
            return '';
          };

          const feedVariableName = resolveOperationVariableRole((description, name) => {
            return /feed rate|feedrate|feed/.test(description) || /^feed(?:_rate)?$/i.test(String(name));
          });
          const spindleVariableName = resolveOperationVariableRole((description, name) => {
            return /spindle|laser power|power/.test(description) || /spindle|power/i.test(String(name));
          });

          const escapeQuoted = (value) => String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');

          const blockText = String(fencedMatch[1] || '');
          const rawLines = blockText.split('\n');
          const usedLineNumbers = new Set();
          for (const line of rawLines) {
            const numbered = String(line || '').match(/^\s*(\d+)\s+/);
            if (numbered) usedLineNumbers.add(Number(numbered[1]));
          }

          const allocateInsertedLineNumbers = (count, prevNum, currentNum) => {
            if (!Number.isFinite(count) || count <= 0) return [];
            if (!Number.isFinite(currentNum) || currentNum <= 1) return [];

            const min = Number.isFinite(prevNum) ? prevNum : 0;
            const picks = [];
            for (let candidate = currentNum - 1; candidate > min && picks.length < count; candidate -= 1) {
              if (!usedLineNumbers.has(candidate)) picks.push(candidate);
            }
            if (picks.length < count) return [];
            picks.sort((a, b) => a - b);
            for (const n of picks) usedLineNumbers.add(n);
            return picks;
          };

          const repairDiagnostics = [];
          const repairedLines = [];
          let lastNumberedLine = 0;

          for (let index = 0; index < rawLines.length; index += 1) {
            const line = rawLines[index];
            const source = String(line || '');
            const numbered = source.match(/^(\s*)(\d+)\s+(.*)$/);
            if (!numbered) {
              repairedLines.push(source);
              continue;
            }

            const indent = String(numbered[1] || '');
            const lineNumber = Number(numbered[2]);
            let stmt = String(numbered[3] || '');
            const sendMatch = stmt.match(/^SEND\s+"([^\"]*)"(\s+.*)?$/i);

            if (sendMatch) {
              let commandText = String(sendMatch[1] || '');
              const suffix = String(sendMatch[2] || '');

              let correctedFeedText = commandText;
              if (supportsKeyword('SPINDLE_ON') && feedVariableName && spindleVariableName) {
                const spindleFeedPattern = new RegExp(`\\bF\\{\\s*${spindleVariableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'gi');
                correctedFeedText = commandText.replace(spindleFeedPattern, `F{${feedVariableName}}`);
              }
              if (correctedFeedText !== commandText && /\bG1\b/i.test(commandText)) {
                commandText = correctedFeedText;
                stmt = `SEND "${commandText}"${suffix}`;
                repairDiagnostics.push(`line ${lineNumber}: repaired feed placeholder F{${spindleVariableName}} -> F{${feedVariableName}}`);
              }

              const placeholderRegex = /\{([^}]+)\}/g;
              const placeholders = [];
              let placeholderMatch;
              while ((placeholderMatch = placeholderRegex.exec(commandText)) !== null) {
                placeholders.push({
                  start: placeholderMatch.index,
                  end: placeholderRegex.lastIndex,
                  raw: String(placeholderMatch[0] || ''),
                  content: String(placeholderMatch[1] || '').trim(),
                });
              }

              const expressionPlaceholders = placeholders.filter(item => /^([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*(\d+(?:\.\d+)?)$/.test(item.content));
              if (expressionPlaceholders.length > 0) {
                const axisTempCounters = { _x: 0, _y: 0, _z: 0 };
                const placeholderValueExpr = new Map();
                const letStatements = [];

                for (const item of placeholders) {
                  const expressionMatch = item.content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
                  if (!expressionMatch) continue;

                  const baseVar = String(expressionMatch[1]);
                  const operator = String(expressionMatch[2]);
                  const amount = String(expressionMatch[3]);
                  const axisChar = commandText.slice(Math.max(0, item.start - 1), item.start).toUpperCase();
                  const axisBase = axisChar === 'X' ? '_x' : (axisChar === 'Y' ? '_y' : '_z');
                  const axisCount = axisTempCounters[axisBase] || 0;
                  axisTempCounters[axisBase] = axisCount + 1;
                  const tempName = axisCount === 0 ? axisBase : `${axisBase}${axisCount + 1}`;

                  placeholderValueExpr.set(item, tempName);
                  letStatements.push(`LET ${tempName} = {${baseVar}} ${operator} ${amount}`);
                }

                const insertedLineNumbers = allocateInsertedLineNumbers(letStatements.length, lastNumberedLine, lineNumber);
                if (insertedLineNumbers.length === letStatements.length) {
                  for (let i = 0; i < letStatements.length; i += 1) {
                    repairedLines.push(`${indent}${insertedLineNumbers[i]} ${letStatements[i]}`);
                  }

                  const sendExprParts = [];
                  let cursor = 0;
                  for (const item of placeholders) {
                    const staticPart = commandText.slice(cursor, item.start);
                    if (staticPart.length > 0) sendExprParts.push(`"${escapeQuoted(staticPart)}"`);

                    if (placeholderValueExpr.has(item)) {
                      sendExprParts.push(placeholderValueExpr.get(item));
                    } else {
                      sendExprParts.push(`{${item.content}}`);
                    }
                    cursor = item.end;
                  }
                  const tail = commandText.slice(cursor);
                  if (tail.length > 0) sendExprParts.push(`"${escapeQuoted(tail)}"`);

                  if (!sendExprParts.length) sendExprParts.push(`"${escapeQuoted(commandText)}"`);
                  stmt = `SEND ${sendExprParts.join(' & ')}${suffix}`;
                  repairDiagnostics.push(`line ${lineNumber}: rewrote inline SEND expression(s) to LET + concatenation`);
                } else {
                  repairDiagnostics.push(`line ${lineNumber}: skipped inline-expression rewrite (no available line numbers for LET insertion)`);
                }
              }
            }

            repairedLines.push(`${indent}${lineNumber} ${stmt}`);
            lastNumberedLine = lineNumber;
          }

          if (!repairDiagnostics.length) {
            return { reply: rawReply, diagnostics: [] };
          }

          const repairedBlock = repairedLines.join('\n');
          const repairedReply = rawReply.replace(fencedMatch[0], `\`\`\`gcom\n${repairedBlock}\n\`\`\``);
          return { reply: repairedReply, diagnostics: repairDiagnostics };
        };

        const asksForTextEngraving = (() => {
          const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
          const text = String(lastUser && lastUser.content ? lastUser.content : '').toLowerCase();
          return /(laser|engrave|burn).*(text|word|letter|font)|\btext\b|\bfont\b|\bhello world\b/.test(text);
        })();

        const baseSystemPrompt = GCOM_SYSTEM + '\n\n' + GCOM_HELP_MANIFEST + '\n\n' + (mode === 'repair' ? REPAIR_SYSTEM : '') + contextAddendum + intentInstruction;

        const buildAiMessages = (systemPrompt, conversationMessages) => {
          const convo = Array.isArray(conversationMessages) ? conversationMessages : [];
          const merged = [{ role: 'system', content: systemPrompt }];
          if (machineContractSystemMessage && machineContractSystemMessage.trim()) {
            const firstUserIdx = convo.findIndex(msg => msg && msg.role === 'user');
            if (firstUserIdx === -1) {
              merged.push({ role: 'system', content: machineContractSystemMessage });
              merged.push(...convo);
            } else {
              merged.push(...convo.slice(0, firstUserIdx));
              merged.push({ role: 'system', content: machineContractSystemMessage });
              merged.push(...convo.slice(firstUserIdx));
            }
          } else {
            merged.push(...convo);
          }
          return merged;
        };

        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: buildAiMessages(baseSystemPrompt, messages),
          max_tokens: 1800,
          temperature: 0.4,
        });
        let reply = String(aiResponse.response || '');

        const initialAnalysis = analyzeGcomBlock(reply);
        const lowQualityTextScript = asksForTextEngraving && initialAnalysis.looksLikeArithmeticChurn;

        // One-shot recovery for truncated script responses.
        if (isLikelyTruncatedGcomReply(reply) || lowQualityTextScript) {
          const recoveryPrompt = `\n\n=== OUTPUT RECOVERY DIRECTIVE ===\nThe previous draft is invalid for output quality (truncated and/or repetitive line spam). Regenerate from scratch and return ONLY one complete \`\`\`gcom fenced block (plus optional ACTIONS comment). Keep it concise (<= 120 numbered lines), avoid repetitive unrolled lines, and ensure the script contains a final END line. If the request is text/font engraving, characters must be built from multiple geometric segments with explicit stroke moves; do not emit arithmetic churn loops with LET local_value.`;
          const retryResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: buildAiMessages(baseSystemPrompt + recoveryPrompt, messages),
            max_tokens: 1800,
            temperature: 0.2,
          });
          const retried = String(retryResponse.response || '').trim();
          if (retried) reply = retried;
        }

        // Guardrail: if model opened a fenced block but missed the closing fence, close it.
        if (/```gcom\s*\n/i.test(reply)) {
          const fenceCount = (reply.match(/```/g) || []).length;
          if (fenceCount % 2 === 1) reply += '\n```';
        }

        const repairResult = applyDeterministicGcomRepair(reply, activeProfileRuleSet, activeProfileOperations);
        if (repairResult.diagnostics.length) {
          for (const message of repairResult.diagnostics) {
            console.log(`[gcom-repair] ${message}`);
          }
          reply = repairResult.reply;
        }

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
