#!/usr/bin/env node
//
// Verify a Konpro session endpoint returns a complete session payload.
//
//   node verify-integration.mjs <session-endpoint-url>
//   node verify-integration.mjs http://localhost:3000/api/widget-session
//
// Sends exactly what the widget sends — POST { audioOnly: false } — and
// checks the response the way the widget reads it. The check that matters
// most is `avatar.id`: a payload missing it mints a session successfully and
// then fails at WebSocket connect with
// "Missing required fields: token, agenticAvatarId, userId".
//
// Never prints the token. Exits non-zero on failure.

const TIMEOUT_MS = 15_000;

const url = process.argv[2];

if (!url || url === "--help" || url === "-h") {
  console.error("Usage: node verify-integration.mjs <session-endpoint-url>");
  console.error("Example: node verify-integration.mjs http://localhost:3000/api/widget-session");
  process.exit(2);
}

try {
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    console.error(`Not an HTTP(S) URL: ${url}`);
    process.exit(2);
  }
} catch {
  console.error(`Not a valid URL: ${url}`);
  process.exit(2);
}

const checks = [];
const pass = (name, detail) => checks.push({ level: "pass", name, detail });
const warn = (name, detail) => checks.push({ level: "warn", name, detail });
const fail = (name, detail) => checks.push({ level: "fail", name, detail });

/** Read a field the way the widget does: camelCase first, then snake_case. */
const field = (obj, camel, snake) => obj?.[camel] ?? obj?.[snake];

/**
 * Structural JWT check only — three base64url segments with a decodable
 * JSON header and payload. Signature verification is the server's job and
 * needs a key we do not have.
 */
function inspectJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, reason: "not three dot-separated segments" };
  try {
    const decode = (seg) =>
      JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (!header || typeof header !== "object") return { ok: false, reason: "header is not a JSON object" };
    if (!payload || typeof payload !== "object") return { ok: false, reason: "payload is not a JSON object" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "segments are not base64url-encoded JSON" };
  }
}

/**
 * Node wraps connection failures as `TypeError: fetch failed` with the real
 * reason on `.cause` — which for a dual-stack host is an AggregateError whose
 * own message is empty. Dig for something that names the actual problem.
 */
function describeFetchError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return `no response within ${TIMEOUT_MS / 1000}s`;
  }
  const seen = new Set();
  const causes = [];
  for (let e = error; e && !seen.has(e); e = e.cause) {
    seen.add(e);
    causes.push(e, ...(Array.isArray(e.errors) ? e.errors : []));
  }
  const coded = causes.find((e) => e?.code);
  if (coded) {
    const hint = { ECONNREFUSED: "connection refused", ENOTFOUND: "host not found" }[coded.code];
    return `${coded.code}${hint ? ` (${hint})` : ""}${coded.message ? ` — ${coded.message}` : ""}`;
  }
  return causes.find((e) => e?.message)?.message ?? String(error);
}

async function main() {
  console.log(`Konpro session endpoint check\n  POST ${url}\n`);

  // ── Request ──────────────────────────────────────────────────────────
  let response;
  const startedAt = Date.now();
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioOnly: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`FAIL  request failed — ${describeFetchError(error)}`);
    console.error("\nThe endpoint is unreachable. Check the server is running and the path is correct.");
    process.exit(1);
  }
  const elapsedMs = Date.now() - startedAt;

  // ── Transport ────────────────────────────────────────────────────────
  if (response.ok) {
    pass("HTTP 200", `${response.status} in ${elapsedMs}ms`);
  } else {
    fail("HTTP 200", `got ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = await response.text();

  if (contentType.includes("application/json")) {
    pass("JSON response", contentType.split(";")[0]);
  } else {
    fail("JSON response", `content-type was "${contentType || "(none)"}"`);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    fail("parseable body", "response body is not valid JSON");
    report();
    return;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("payload shape", "response is not a JSON object");
    report();
    return;
  }

  // The widget unwraps one level of `data` before reading fields.
  const session = body.data && typeof body.data === "object" ? body.data : body;
  if (session !== body) {
    warn("payload envelope", "wrapped in `data` — the widget unwraps it, but returning session.data is clearer");
  }

  // ── Session token ────────────────────────────────────────────────────
  const token = field(session, "sessionToken", "session_token");
  if (!token) {
    fail("sessionToken", "missing (accepted as sessionToken or session_token)");
  } else if (typeof token !== "string" || token.length === 0) {
    fail("sessionToken", "present but not a non-empty string");
  } else {
    const jwt = inspectJwt(token);
    if (jwt.ok) {
      pass("sessionToken", "present, parses as a JWT");
      if (typeof jwt.payload.exp === "number") {
        const secondsLeft = Math.round(jwt.payload.exp - Date.now() / 1000);
        if (secondsLeft <= 0) warn("token exp", `already expired ${-secondsLeft}s ago`);
        else pass("token exp", `valid for ${secondsLeft}s`);
      }
    } else {
      fail("sessionToken", `present but does not parse as a JWT — ${jwt.reason}`);
    }
  }

  // ── Avatar — the one that matters ────────────────────────────────────
  const avatar = session.avatar;
  if (avatar === undefined || avatar === null) {
    fail(
      "avatar",
      "MISSING — the widget sources agenticAvatarId from avatar.id. Return the full session payload (session.data)",
    );
  } else if (typeof avatar !== "object" || Array.isArray(avatar)) {
    fail("avatar", `present but not an object (got ${Array.isArray(avatar) ? "array" : typeof avatar})`);
  } else if (typeof avatar.id !== "string" || avatar.id.trim() === "") {
    fail("avatar.id", "avatar is present but avatar.id is missing or empty — this fails at WebSocket connect");
  } else {
    pass("avatar.id", `present${avatar.name ? ` (${avatar.name})` : ""}`);
  }

  // ── Remaining required fields ────────────────────────────────────────
  const userId = field(session, "userId", "user_id");
  if (typeof userId === "string" && userId.length > 0) pass("userId", "present");
  else fail("userId", "missing (accepted as userId or user_id)");

  const websocketUrl = field(session, "websocketUrl", "websocket_url");
  if (typeof websocketUrl === "string" && websocketUrl.length > 0) {
    if (/^wss?:\/\//.test(websocketUrl)) pass("websocketUrl", "present");
    else fail("websocketUrl", `present but not a ws:// or wss:// URL ("${websocketUrl}")`);
  } else {
    fail("websocketUrl", "missing (accepted as websocketUrl or websocket_url)");
  }

  // ── Expiry — warn, do not fail ───────────────────────────────────────
  const expiresAt = field(session, "expiresAt", "expires_at");
  const expiresIn = field(session, "expiresIn", "expires_in");
  if (expiresAt) {
    if (Number.isNaN(new Date(expiresAt).getTime())) {
      warn("expiresAt", `not a parseable date ("${expiresAt}") — the widget ignores it. Send ISO 8601`);
    } else {
      pass("expiresAt", "present");
    }
  } else if (typeof expiresIn === "number" && expiresIn > 0) {
    pass("expiresIn", `${expiresIn}s — works, though expiresAt is more precise`);
  } else {
    warn("expiry", "neither expiresAt nor expiresIn — the widget cannot refresh pre-emptively and will fail after idle");
  }

  // ── Optional ─────────────────────────────────────────────────────────
  const audioOnly = field(session, "audioOnly", "audio_only");
  if (audioOnly !== undefined) {
    pass("audioOnly", `${audioOnly} (server value overrides client config)`);
    if (audioOnly === true) {
      warn("audioOnly", "requested false but the server returned true — the widget will run audio-only");
    }
  }

  report();
}

function report() {
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const { level, name, detail } of checks) {
    const label = { pass: "PASS", warn: "WARN", fail: "FAIL" }[level];
    console.log(`${label}  ${name.padEnd(width)}  ${detail}`);
  }

  const failed = checks.filter((c) => c.level === "fail");
  const warned = checks.filter((c) => c.level === "warn");

  console.log("");
  if (failed.length === 0) {
    console.log(
      warned.length
        ? `PASSED with ${warned.length} warning${warned.length === 1 ? "" : "s"} — the endpoint returns a usable session payload.`
        : "PASSED — the endpoint returns a complete session payload.",
    );
    process.exit(0);
  }

  console.log(`FAILED — ${failed.length} check${failed.length === 1 ? "" : "s"} did not pass.`);

  // Only worth suggesting when the endpoint actually returned a payload to
  // inspect. On a 500 or an HTML error page the payload shape is not the bug.
  const servedAPayload = !failed.some((c) => c.name === "HTTP 200" || c.name === "JSON response");
  if (servedAPayload && failed.some((c) => c.name.startsWith("avatar"))) {
    console.log("");
    console.log("The avatar failure is the common one. Return the complete payload:");
    console.log("");
    console.log("  const session = await konpro.widget.createWidgetSession({");
    console.log("    widgetSessionCreate: { agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID },");
    console.log("  });");
    console.log("  return Response.json(session.data);  // not a subset");
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("Unexpected error:", error?.message ?? error);
  process.exit(1);
});
