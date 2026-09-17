# Troubleshooting

Keyed by the literal string that appears in the console or network tab.

## Quick index

| symptom | cause | fix |
|---|---|---|
| `Missing required fields: token, agenticAvatarId, userId` | endpoint didn't return `avatar` / `avatar.id` | return the full session payload |
| `Session response had no avatar.id — falling back to the token's agenticAvatarId claim` | same, masked by the JWT fallback | same — fix it now, don't ship on the fallback |
| WebSocket opens, then closes 1000 immediately | same as above | same |
| `Could not determine the avatar for this session.` | no `avatar.id`, and no claim to fall back to | same |
| `Session response missing token` | wrong envelope, or non-JSON response | return `session.data` |
| `Failed to fetch session from endpoint` | endpoint returned non-2xx | check the route's own logs |
| `Refused to load the script` / `script-src-elem` violation | worklet blocked by CSP | allow it, or self-host + `workletUrl` |
| `🎤 worklet URL load failed` then `via blob` | worklet not deployed beside the bundle | ship both files together |
| `🎤 worklet blob fallback also failed` | CSP blocks the origin *and* `blob:` | self-host + `workletUrl` |
| mic permission never prompts | missing `Permissions-Policy` / iframe `allow` | add both |
| connection error after long idle | expired token | return `expiresAt` / `expiresIn` |
| avatar interrupts itself | audio-only echo | expected — use push-to-talk |
| `agenticAvatarId is required when using apiKey` | `apiKey` mode without an avatar id | switch to `sessionEndpoint` |
| `One authentication method is required` | no auth option in config | set `sessionEndpoint` |
| widget renders blank / zero height | container has no dimensions | size the parent |

---

## `Missing required fields: token, agenticAvatarId, userId`

Server-side WebSocket rejection. The widget connected and sent an init message
with `agenticAvatarId: null`.

The session endpoint did not return `avatar`, or returned it without `id`. The
session token itself is fine — this is why the failure arrives at connect time
rather than at fetch time.

Fix: return the complete payload. With `@konpro/js-sdk` that is `session.data`,
not a hand-picked subset.

```ts
// wrong — mints fine, fails at connect
return Response.json({ session_token: session.data.sessionToken });

// right
return Response.json(session.data);
```

Check the response in the Network tab: the POST to your endpoint must contain an
`avatar` object with a non-empty `id`.

If it reproduces in production but not in your demo, check whether the demo
passes `agenticAvatarId` in client config. That masks exactly this bug — see
Rule 2 in SKILL.md.

## `Session response had no avatar.id — falling back to the token's agenticAvatarId claim`

Console warning, widget 2.0.5 and later. Same root cause as above; the widget
recovered by decoding the JWT claim.

It works, so it is easy to ignore. Do not. It is the same broken endpoint, one
fallback away from failing, and the fallback does not apply to every token or to
older widget versions. Fix the endpoint.

## WebSocket opens, then closes with code 1000 immediately

`1000` is a normal close, so the widget does not reconnect — by design.
Immediately after opening, it means the server rejected the session. Almost
always the missing-`avatar` case above.

If the payload is complete, check `allowedOrigins` on the session: a mismatched
origin is rejected deliberately and identically every time, and the widget does
not burn a retry on it.

## `Could not determine the avatar for this session.`

Thrown client-side before connecting. No `avatar.id` in the session, no
`agenticAvatarId` claim in the token, no previous value, nothing in config.

Your endpoint is returning something that is not the Konpro session payload.
Verify with `node scripts/verify-integration.mjs <url>`.

## `Session response missing token`

The widget could not find `sessionToken` or `session_token`. Retries three times
with backoff, then fails.

Causes:

- Custom envelope. The widget unwraps one level of `data`, so `{ data: {...} }`
  works and `{ session: {...} }` or `{ success: true, payload: {...} }` do not.
- The route returned HTML — a framework error page or a redirect to a login page
  because the route is behind auth middleware.
- The route returned 200 with an empty body.

## `Failed to fetch session from endpoint`

The endpoint returned a non-2xx status. The widget does not surface the body, so
read your own server logs.

Common: `500` from a missing `KONPRO_API_KEY`, `404` from a route path typo,
`405` from defining `GET` where the widget POSTs, `401` from auth middleware
covering the route.

Reproduce it directly:

```bash
curl -i -X POST http://localhost:3000/api/widget-session \
  -H 'Content-Type: application/json' -d '{"audioOnly":false}'
```

## `script-src-elem` CSP violation / `Refused to load the script`

The AudioWorklet was blocked. This is a CSP failure, not a microphone failure —
the message never mentions the microphone.

Fix per how you ship: allow `https://cdn.konpro.ai` (CDN), `data:` (Vite),
`'self'` (webpack/Rollup/self-hosted), or self-host the worklet and set
`workletUrl`. See `csp.md`.

## `🎤 worklet URL load failed (...). Falling back to inline blob.`

The worklet was not at the URL the widget derived. For a self-hosted bundle,
that means `mic-capture.worklet.js` was not deployed as its sibling.

The widget recovers via the inlined blob, so the visible cost is a warning and up
to a 6-second stall on first microphone use. It becomes a hard failure the moment
a CSP without `blob:` is added.

```bash
cp node_modules/@konpro/widget/dist/mic-capture.worklet.js public/konpro/
```

A successful load logs `🎤 worklet loaded via url`. `via blob` means the fallback
ran.

## `🎤 worklet blob fallback also failed`

Both paths dead: CSP allows neither the worklet's origin nor `blob:` in
`script-src`. Microphone capture cannot start.

Self-host the worklet and set `workletUrl` so no fallback is needed.

## Microphone permission never prompts

Not a widget problem. Check, in order:

1. **HTTPS.** Required. `localhost` is exempt; a LAN IP is not.
2. **Permissions Policy.** `document.featurePolicy?.allowsFeature("microphone")`
   must be `true`. If `false`, add
   `Permissions-Policy: microphone=(self), autoplay=(self), fullscreen=(self)`.
3. **Iframe.** Both the parent header *and* `allow="microphone"` on the element.
4. **Previously denied.** Once dismissed, the browser will not re-prompt — reset
   it in site settings.

## Connection error after a long idle period

The session token expired and the widget could not refresh pre-emptively.

Look for: `Session response has no usable expiry (expiresAt / expiresIn)`.

Return `expiresAt` (ISO) or `expiresIn` (seconds). `session.data` already
contains both — another reason not to trim the payload.

Also check `Session expiresAt is not a valid date (...) — ignoring it`, which
means the field is present but not a parseable timestamp. Send ISO 8601, not a
Unix epoch integer.

## The avatar interrupts itself

Expected in audio-only mode. The avatar's audio plays outside the WebRTC
pipeline that browser echo cancellation references, so the mic hears the avatar
and server-side VAD fires barge-in on it.

The widget already sends silence while the avatar speaks, so voice barge-in does
not work in audio-only. Push-to-talk, the interrupt button and text input all
still interrupt.

```js
{ audioOnly: true, pushToTalk: true }
```

If this happens in video mode, WebRTC audio failed and playback fell back to the
streaming player mid-call. Check `getModeInfo().webrtcAudioEnabled`.

## The video/audio switcher does not appear

Two reasons, both by design:

- It is opt-in: `uiDetails: { showTopButtons: { mediaMode: true } }`.
- It only shows between calls. `audioOnly` is negotiated at connect time and
  cannot change mid-session; `setAudioOnly()` logs a warning and is ignored while
  connected or connecting.

## `audioOnly` in config is ignored

The server's value wins. `session.audioOnly` overrides client config, and the
`ready` message is authoritative.

`onAudioOnlyChange` does **not** fire for a server override on `ready` — read
`getModeInfo()` after connecting.

If you want per-session control, pass `audioOnly` through your session endpoint
into `createWidgetSession` — the widget POSTs it to you.

## `KonAI Widget: agenticAvatarId is required when using apiKey`

You are in `apiKey` mode. Do not ship that — it exposes the key to every
visitor. Switch to `sessionEndpoint` and delete both `apiKey` and
`agenticAvatarId` from client config.

## `KonAI Widget: One authentication method is required`

No `apiKey`, `sessionEndpoint` or `getSessionToken` in config. Usually an env var
that did not reach the client: `sessionEndpoint: process.env.SESSION_URL` is
`undefined` in the browser without the framework's public prefix. A relative path
like `/api/widget-session` needs no env var at all.

## Widget renders blank or zero-height

The mount element fills its parent at 100% × 100%. A parent with no height
renders nothing, with no error.

```html
<div id="assistant" style="width: 380px; height: 560px"></div>
```

In React, size the wrapper around `<KonproWidget>`, or pass `style`.

## The session endpoint is called twice in development

React 18 StrictMode mounts, unmounts and remounts. The widget cancels the
in-flight session on `destroy()`, so no live session is orphaned. Not a bug, and
it does not happen in production builds.

## Two widgets on one page fight

The widget's DOM uses global element ids, so only one live instance is supported.
Mount one and swap its config — in React by changing `key`, elsewhere by
`destroy()` then `init()`.
