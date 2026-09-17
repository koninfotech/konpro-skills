---
name: konpro-widget-integration
description: >
  Integrate the Konpro AI voice-avatar widget into a web app — mount the client
  (vanilla JS or React), implement the server-side session endpoint with
  @konpro/js-sdk, and configure CSP and microphone permissions. Use when adding
  a voice avatar, AI assistant, or interactive avatar to a site, or when
  debugging Konpro connection, session-token, avatar-id, worklet, or microphone
  errors.
---

# Konpro widget integration

Every integration has two halves. Build both. Most reported bugs are the server
half returning an incomplete payload.

| half | packages |
|---|---|
| client — mounts widget, opens WebSocket, mic + WebRTC | `@konpro/widget`, `@konpro/widget-react` |
| server — mints a short-lived session token | `@konpro/js-sdk` |

Option reference lives in the package READMEs. Do not restate them here:

- https://www.npmjs.com/package/@konpro/widget — full config reference, source of truth
- https://www.npmjs.com/package/@konpro/widget-react — React bindings
- https://www.npmjs.com/package/@konpro/js-sdk — server SDK
- https://docs.konpro.ai/api/widget-integration

## Before generating

Infer silently: React vs vanilla (read `package.json`), framework and route
conventions (read the repo). Do not ask what the repo already answers.

Ask once, batched, then build — never one question at a time:

- Which agentic avatar, if the account has more than one. Cannot be guessed;
  the session binds to it. `konpro-avatar-setup` lists them.
- Bubble launcher or inline widget, when the request does not settle it.
  Default to bubble for site-wide or support use, inline for a named page or a
  sized area.

Do not ask about CSP, the worklet, theme, or caption toggles. Apply the defaults
below, then state what you chose.

Raise these only if the context does:

- `pushToTalk: true` — kiosks, lobbies, noisy environments.
- `audioOnly` — bandwidth limits or an explicit voice-only request.

Write the route against `process.env`. Never hard-code a placeholder avatar id
or key — that fails at runtime, not at build.

## Build order

1. Server route first (`references/session-endpoint.md`).
2. Verify it: `node scripts/verify-integration.mjs <url>`. Do not mount the
   client until this passes.
3. Client mount (`references/client-react.md` or `references/client-vanilla.md`).
4. CSP + `Permissions-Policy` (`references/csp.md`).

Reference files, load as needed:

- `references/session-endpoint.md` — Next.js App Router, Express, Fastify.
- `references/client-react.md` — `<KonproWidget>`, `<KonproBubble>`, StrictMode.
- `references/client-vanilla.md` — `init()`, CDN script tag, worklet deployment.
- `references/csp.md` — real header values, iframe embedding, worklet strategies.
- `references/troubleshooting.md` — lookup table keyed by literal error string.

## Rule 1 — return the complete session payload

The endpoint's response is the single largest source of integration bugs.

`@konpro/js-sdk` returns `{ data, meta }`. Return `session.data`:

```ts
const session = await konpro.widget.createWidgetSession({
  widgetSessionCreate: { agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID },
});
return Response.json(session.data); // the whole object — never a subset
```

Never hand-pick fields. The widget reads each of these, camelCase or snake_case:

| field | accepted as | required |
|---|---|---|
| session token | `sessionToken` / `session_token` | yes |
| avatar object | `avatar` — must contain `avatar.id` | yes |
| user id | `userId` / `user_id` | yes |
| websocket url | `websocketUrl` / `websocket_url` | yes |
| expiry | `expiresAt` / `expires_at` (ISO) | strongly — enables pre-emptive refresh |
| expiry | `expiresIn` / `expires_in` (seconds) | alternative to `expiresAt` |
| audio-only | `audioOnly` / `audio_only` | no — server value overrides client config |

`avatar` is the field people trim, because a response carrying only
`{ session_token }` looks complete. It is not. The widget sources
`agenticAvatarId` for the WebSocket init message from `sessionData.avatar.id`.

Without it, widget 2.0.5 falls back to the `agenticAvatarId` claim in the JWT and
logs `Session response had no avatar.id — falling back to the token's
agenticAvatarId claim`. Treat that warning as a bug to fix, not as working. When
the fallback cannot apply, the WebSocket opens and the server closes it
immediately with `Missing required fields: token, agenticAvatarId, userId`.

The widget unwraps one level of `data`, so returning the SDK wrapper untouched
also happens to work. Any other envelope (`{ success, session }`) does not.
Return `session.data`.

The widget POSTs `{ audioOnly }` to the endpoint, plus `agenticAvatarId` only if
that was set in client config.

## Rule 2 — no `agenticAvatarId` in client config

When using `sessionEndpoint`, the avatar is determined server-side by the token.
Generate client config without it.

It is not merely redundant. It is the last-resort fallback in the widget's avatar
resolution chain, so it masks a session endpoint that has dropped `avatar` — the
integration works until something else changes, and a demo that passes it can
work perfectly while a correct, minimal integration fails. This exact asymmetry
has cost multi-hour debugging sessions.

Only set it alongside the deprecated `apiKey` mode, where it is required.

## Rule 3 — never `apiKey` in the browser

`apiKey` is local-development only and exposes the key to every visitor. Ship
`sessionEndpoint`, or `getSessionToken` for custom auth flows. Always generate
the server route. Keep `KONPRO_API_KEY` server-side; never prefix it with
`NEXT_PUBLIC_`, `VITE_`, or any other client-exposed prefix.

## Rule 4 — CSP and Permissions-Policy are separate

Both are easy to miss and both fail confusingly. Details in `references/csp.md`.

- The widget loads an AudioWorklet for mic capture. A strict CSP surfaces this as
  a `script-src-elem` violation, never as a microphone error.
- Microphone access is Permissions Policy, not CSP:
  `Permissions-Policy: microphone=(self), autoplay=(self), fullscreen=(self)`.
  In an iframe the parent header *and* `allow="microphone"` on the element are
  both required.
- HTTPS is required for microphone access. localhost is exempt.

Baseline CSP:

```
script-src   'self' https://cdn.konpro.ai;
style-src    'self' 'unsafe-inline';
connect-src  'self' wss://api.konpro.ai https://api.konpro.ai https://inference.konpro.ai;
img-src      'self' data: https:;
media-src    'self' blob:;
```

If the host CSP allows neither `data:` nor `blob:` script sources, serve
`@konpro/widget/dist/mic-capture.worklet.js` yourself and pass its URL as
`workletUrl`.

## Rule 5 — the worklet ships beside the bundle

Bundler users (Vite, webpack 5, Rollup) get this automatically from the ESM
build. Nothing to do.

Script-tag/CDN integrations self-hosting the bundle must deploy
`mic-capture.worklet.js` as a sibling of it — the widget derives the worklet URL
from its own script `src`. If it is missing, 2.0.5 degrades to an inlined `blob:`
worklet, so the failure is a console warning plus up to a 6-second stall on first
microphone use rather than a hard error — unless the CSP also blocks `blob:`, in
which case mic capture fails outright. Deploy both files. Nothing surfaces at
deploy time; only on first microphone use.

## Rule 6 — pick the right client package

| host app | package | entry |
|---|---|---|
| React | `@konpro/widget-react` | `<KonproWidget>`, `<KonproBubble>` |
| anything else | `@konpro/widget` | `init()` |
| script tag | CDN IIFE build | `window.KonproWidget.init()` (legacy alias `KonAI`) |

The widget is single-instance by construction — its internal DOM uses global ids
(`konai-widget`, `konai-avatar-video`). For a carousel of several agents, mount
one instance and swap its config; do not run several at once. In React, change
config by changing the component's `key` — config is applied once on mount and
there is no `updateConfig()`.

## Rule 7 — audio-only is fixed per session

`audioOnly` is negotiated at connect time and gates whether the server builds a
video transport, so it cannot change mid-call. `setAudioOnly()` is ignored with a
console warning while connected or connecting, and the built-in switcher
(`uiDetails.showTopButtons.mediaMode`, opt-in) only appears between calls. The
server's `ready` message is authoritative — read `getModeInfo()` after connecting
for the real value.

Voice barge-in does not work in audio-only. Browser echo cancellation subtracts
what the WebRTC pipeline renders; audio-only plays the avatar through a separate
AudioContext that never enters that pipeline, so the mic hears the avatar
uncancelled and server-side VAD would interrupt the session with its own voice.
The widget sends silence while the avatar speaks. This also applies in video mode
if WebRTC audio fails and playback falls back mid-call.

Push-to-talk, the interrupt button and text input still interrupt — none depend
on the mic. For kiosks, lobbies and other noisy environments set
`pushToTalk: true`.

## Verify

```bash
node scripts/verify-integration.mjs https://example.com/api/widget-session
```

POSTs `{ audioOnly: false }` and asserts the payload is complete — above all that
`avatar.id` is present and non-empty. Exits non-zero on failure. It never prints
the token. Run it after wiring the endpoint and again after any change to it.
