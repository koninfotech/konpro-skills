# CSP, permissions and the AudioWorklet

Two independent mechanisms. Getting one right does not help with the other, and
both fail in ways that do not name the real cause.

- **CSP** controls what the page may load and connect to. A blocked AudioWorklet
  reports as a `script-src-elem` violation, never as a microphone error.
- **Permissions Policy** controls whether the microphone may be used at all. When
  it blocks, no permission prompt ever appears — there is no error, just nothing.

## Baseline CSP

```
Content-Security-Policy:
  script-src   'self' https://cdn.konpro.ai;
  style-src    'self' 'unsafe-inline';
  connect-src  'self' wss://api.konpro.ai https://api.konpro.ai https://inference.konpro.ai;
  img-src      'self' data: https:;
  media-src    'self' blob: https://cdn.konpro.ai;
```

Real hosts, not placeholders:

| host | used for |
|---|---|
| `https://cdn.konpro.ai` | CDN bundle, worklet and ringtone (script-tag integrations) |
| `https://api.konpro.ai` / `wss://api.konpro.ai` | session API and the realtime WebSocket |
| `https://inference.konpro.ai` | model inference |

`style-src 'unsafe-inline'` is required — the widget injects its stylesheet.
`media-src blob:` is required for avatar audio/video playback.

`media-src https://cdn.konpro.ai` covers the outgoing-call ringtone
(`kon-ringtone.mp3`), played while the connect pipeline runs. It is an `<audio>`
element, so it falls under `media-src` — not `connect-src`. Like the worklet, it
is a sibling of the bundle, so CDN integrations load it from the CDN and bundled
installs get it from `'self'`.

Drop `https://cdn.konpro.ai` from `script-src` if you install from npm and bundle
the widget: it is then served from `'self'`. The same applies to `media-src`,
unless you point `ringtone` at a URL of your own.

## Feature-gated additions

Only add these if you use the feature.

| feature | add |
|---|---|
| Panorama | `script-src` / `connect-src`: `https://cdn.jsdelivr.net`, plus your image hosts |
| Virtual tour | `frame-src https://studio.konpro.ai` (or your tour host) |
| Google Map (`city` display type) | Google Maps origins in `script-src`, `connect-src`, `img-src` |

## Permissions Policy

```
Permissions-Policy: microphone=(self), autoplay=(self), fullscreen=(self)
```

`autoplay` matters: without it the avatar's first audio can be blocked by the
browser and the call appears connected but silent.

### Next.js

`next.config.js`:

```js
const csp = [
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' wss://api.konpro.ai https://api.konpro.ai https://inference.konpro.ai",
  "img-src 'self' data: https:",
  "media-src 'self' blob: https://cdn.konpro.ai",
].join("; ");

module.exports = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Permissions-Policy",
            value: "microphone=(self), autoplay=(self), fullscreen=(self)",
          },
        ],
      },
    ];
  },
};
```

`'unsafe-eval'` in `script-src` is Next.js's development requirement, not the
widget's. Tighten it for production per the Next.js CSP guide; the widget itself
does not need `eval`.

### Express (helmet)

```js
import helmet from "helmet";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.konpro.ai"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          "wss://api.konpro.ai",
          "https://api.konpro.ai",
          "https://inference.konpro.ai",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "blob:", "https://cdn.konpro.ai"],
      },
    },
  }),
);

app.use((req, res, next) => {
  res.set("Permissions-Policy", "microphone=(self), autoplay=(self), fullscreen=(self)");
  next();
});
```

## Embedding in an iframe

Both sides must grant the microphone. Either alone silently fails.

Parent page header:

```
Permissions-Policy: microphone=(self "https://widget.example.com")
```

Iframe element:

```html
<iframe
  src="https://widget.example.com/assistant"
  allow="microphone; autoplay; fullscreen"
></iframe>
```

Diagnose from inside the frame:

```js
document.featurePolicy?.allowsFeature("microphone"); // false → blocked, no prompt will appear
```

If that returns `false`, the problem is the header or the `allow` attribute.
Nothing in the widget config can fix it.

## The AudioWorklet

The widget captures the microphone through an AudioWorklet. It resolves the
worklet URL in this order:

1. `workletUrl` from config, if you set it.
2. **ESM build** — the URL the bundler rewrote. Vite inlines it as a `data:` URI
   (under its 4 KB limit); webpack/Rollup emit an asset served from `'self'`.
3. **IIFE/CDN build** — a sibling of `document.currentScript.src`.
4. `https://cdn.konpro.ai/widget/mic-capture.worklet.js` as a last resort.

If the resolved URL fails to load — CSP, CORS, 404 or network — the widget falls
back to an inlined `blob:` worklet, after up to a 6-second timeout. If `blob:`
is also blocked, both paths are dead and microphone capture fails:

```
🎤 worklet blob fallback also failed: … — host CSP likely blocks both the CDN origin and blob: in script-src.
```

So the directive you need depends on how you ship:

| you ship | `script-src` must allow | `media-src` must allow |
|---|---|---|
| CDN script tag | `https://cdn.konpro.ai` | `https://cdn.konpro.ai` |
| Vite | `data:` (or `blob:` for the fallback) | `'self'` |
| webpack / Rollup | `'self'` | `'self'` |
| self-hosted bundle | `'self'` | `'self'` |

Adding `blob:` to `script-src` keeps the worklet fallback available in every case.

## The ringtone

`kon-ringtone.mp3` plays while the connect pipeline runs. It resolves through the
same sibling-asset path as the worklet — bundler-rewritten URL for the ESM build,
`document.currentScript` sibling for the CDN build, then
`https://cdn.konpro.ai/widget/kon-ringtone.mp3` — which is why `media-src` tracks
`script-src` in the table above. The mp3 is past Vite's inline limit, so bundlers
emit a real asset served from `'self'` rather than a `data:` URI.

Unlike the worklet there is no fallback, and none is needed: a ringtone blocked
by CSP, refused by autoplay policy or 404ing because the asset was not deployed
is cosmetic. It logs and the call proceeds.

```
🔔 Ringtone could not play (non-fatal): …
```

To avoid the directive entirely, point it at your own asset or switch it off:

```js
init({ sessionEndpoint: "/api/widget-session", ringtone: "/audio/our-ring.mp3" });
init({ sessionEndpoint: "/api/widget-session", ringtone: false });
```

### Strict CSP — no `data:`, no `blob:`

Serve the worklet yourself and point the widget at it. No fallback needed, so
nothing depends on `data:` or `blob:`.

```bash
cp node_modules/@konpro/widget/dist/mic-capture.worklet.js public/konpro/
cp node_modules/@konpro/widget/dist/kon-ringtone.mp3 public/konpro/
```

```js
init({
  sessionEndpoint: "/api/widget-session",
  containerId: "assistant",
  workletUrl: "/konpro/mic-capture.worklet.js",
  ringtone: "/konpro/kon-ringtone.mp3",
});
```

`script-src 'self'` and `media-src 'self'` then cover both. Re-copy on every
upgrade of `@konpro/widget` — a stale worklet and a new bundle is a version
mismatch the build will not catch. A `postinstall` script or a build step is the
reliable place for it.

## HTTPS

Microphone access requires a secure context. `localhost` is exempt; a LAN IP
like `http://192.168.1.10:3000` is not — use a tunnel or a local TLS cert when
testing on a phone.

## Verifying

1. DevTools → Console, filter for `Refused to` — CSP violations report there with
   the directive that blocked them.
2. `document.featurePolicy?.allowsFeature("microphone")` — must be `true`.
3. Network tab, filter `worklet` — confirm it loads, and from where.
4. Console line `🎤 worklet loaded via url` (good) or `via blob` (the fallback
   ran — your intended URL failed).
5. Start a call and listen for the ringtone. Silence plus a `media-src` violation
   or `🔔 Ringtone could not play` means `kon-ringtone.mp3` is blocked or missing.
   Cosmetic, so it is easy to ship broken — check it deliberately.
