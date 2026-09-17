# Vanilla / script-tag client

For anything that is not React: plain JS, Vue, Svelte, Angular, Rails, Django,
WordPress, static HTML.

Full config reference: https://www.npmjs.com/package/@konpro/widget

## Bundler (Vite, webpack, Rollup)

```bash
npm install @konpro/widget
```

```js
import { init } from "@konpro/widget";

const widget = init({
  sessionEndpoint: "/api/widget-session",
  containerId: "assistant",
});
```

```html
<div id="assistant" style="width: 380px; height: 560px"></div>
```

`init()` returns an instance that is already initialising — do not call
`instance.init()` again. The container needs real dimensions; the widget fills
it at 100% × 100%.

The AudioWorklet is handled automatically here: the ESM build resolves it via
`new URL("./mic-capture.worklet.js", import.meta.url)`, which bundlers rewrite.
Vite typically inlines it as a `data:` URI (it is under the 4 KB limit); webpack
and Rollup emit a real asset served from `'self'`.

## CDN script tag

```html
<script src="https://cdn.konpro.ai/widget/index.min.js"></script>
<div id="assistant" style="width: 380px; height: 560px"></div>
<script>
  KonproWidget.init({
    sessionEndpoint: "/api/widget-session",
    containerId: "assistant",
  });
</script>
```

Globals: `window.KonproWidget`, with `window.KonAI` as a legacy alias for the
same object. Both expose `init`, `version`, `KonAIWidget`, `KonAIBubble`.

Load the script without `type="module"`. The IIFE build resolves its worklet via
`document.currentScript`, which is `null` inside an ES module.

## Self-hosting the bundle — ship the worklet with it

If you serve the bundle from your own origin rather than the CDN, copy **both**
files:

```
/assets/konpro/index.min.js
/assets/konpro/mic-capture.worklet.js
```

The widget derives the worklet URL from its own script `src`, so the worklet
must sit next to the bundle. Copy it from
`node_modules/@konpro/widget/dist/mic-capture.worklet.js`, or via the export
`@konpro/widget/worklet`.

If it is missing the widget degrades to an inlined `blob:` worklet — a console
warning and up to a 6-second stall on first microphone use, not a hard failure —
unless your CSP also blocks `blob:`, in which case mic capture fails outright.
Nothing goes wrong at deploy time. It surfaces only on first microphone use.

Under a strict CSP, skip the guessing and be explicit:

```js
init({
  sessionEndpoint: "/api/widget-session",
  containerId: "assistant",
  workletUrl: "/assets/konpro/mic-capture.worklet.js",
});
```

## Bubble launcher

```js
const bubble = init({
  sessionEndpoint: "/api/widget-session",
  bubble: { side: "right", label: "Talk to us", size: 64 },
});
```

With `bubble` set, `init()` returns a `KonAIBubble` — `expand()`, `collapse()`,
`toggle()`, `getWidget()`, `destroy()`, `isOpen`. It attaches to `document.body`
and positions itself fixed, so it ignores `containerId`.

`prefetch` defaults to `true` (session minted on mount, instant open, one session
per page view). With `prefetch: false`, `getWidget()` is `null` while collapsed
and after every collapse — do not cache it across a close.

## Instance methods

```js
const widget = init({ sessionEndpoint: "/api/widget-session", containerId: "assistant" });

widget.startCall();
widget.toggleMute();
widget.interruptAI();                  // no-op when allowInterruption: false
const sent = widget.sendTextMessage("Hello");  // returns whether it was delivered
widget.setInputMode("ptt");            // "vad" | "ptt"
widget.getModeInfo();                  // authoritative after connecting
widget.destroy();                      // before removing the container
```

Always `destroy()` before removing the container from the DOM — it releases the
microphone, closes the socket and balances the injected-styles refcount. In an
SPA, hook it to the route teardown.

## Callbacks

```js
init({
  sessionEndpoint: "/api/widget-session",
  containerId: "assistant",
  onReady: (widget) => console.log("ready", widget.getModeInfo()),
  onError: (error) => console.error("Konpro:", error.message),
  onTranscription: (text) => console.log("user:", text),
  onResponse: (text) => console.log("avatar:", text),
  onAvatarStateChange: (state) => console.log(state), // idle|listening|thinking|speaking
});
```

`onAudioOnlyChange` fires when the mode changes between calls, but **not** for a
server override on `ready` — read `getModeInfo()` after connecting for the real
value.

## One instance at a time

The widget's DOM uses global element ids (`konai-widget`, `konai-avatar-video`),
so two live instances collide. To switch avatars, `destroy()` the current
instance and `init()` a new one against the endpoint that mints the other avatar.

## SPA frameworks

Mount on element-ready, destroy on teardown:

- **Vue** — `onMounted` / `onBeforeUnmount`
- **Svelte** — `onMount`, returning the destroy function
- **Angular** — `ngAfterViewInit` / `ngOnDestroy`

```js
// Vue
import { onMounted, onBeforeUnmount } from "vue";
import { init } from "@konpro/widget";

let widget = null;
onMounted(() => {
  widget = init({ sessionEndpoint: "/api/widget-session", containerId: "assistant" });
});
onBeforeUnmount(() => widget?.destroy());
```

## Server-rendered pages

The widget touches `document` at init time only, not at import time — the
package declares `"sideEffects": false`. Still, call `init()` from a
browser-only lifecycle hook, never during SSR.
