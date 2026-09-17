# React client

```bash
npm install @konpro/widget-react
```

`@konpro/widget` is a dependency of it — do not install both explicitly unless
you import types from the core package directly.

Full prop and config reference:
https://www.npmjs.com/package/@konpro/widget-react

## Inline widget

```tsx
"use client";

import { KonproWidget } from "@konpro/widget-react";

export function SupportAvatar() {
  return (
    <div style={{ width: 380, height: 560 }}>
      <KonproWidget
        config={{ sessionEndpoint: "/api/widget-session" }}
        onError={(error) => console.error("Konpro:", error.message)}
      />
    </div>
  );
}
```

That is the whole client half. No `agenticAvatarId` — the token determines the
avatar. No `apiKey`.

`<KonproWidget>` renders a mount div the widget fills at 100% × 100%, so it
needs a parent with real dimensions. A parent of height 0 renders an invisible
widget with no error.

## Bubble launcher

```tsx
"use client";

import { KonproBubble } from "@konpro/widget-react";

export function SupportBubble() {
  return (
    <KonproBubble
      config={{ sessionEndpoint: "/api/widget-session" }}
      bubble={{ side: "right", label: "Talk to us", size: 64 }}
    />
  );
}
```

`<KonproBubble>` renders `null` — it attaches to `document.body` and positions
itself fixed against the viewport. Do not wrap it in a sized or transformed
container expecting that to place it; use the `offsetX` / `offsetY` /
`side` bubble options.

`prefetch` defaults to `true`: the session is minted when the bubble mounts, so
the launcher can show the real avatar image and opening is instant. That costs
one session per page view. Set `prefetch: false` to defer until first open — but
then `getWidget()` returns `null` while collapsed and after each collapse, so do
not cache the instance across a close.

## App Router placement

Both components are client components. In a server component, either mark the
wrapper `"use client"` as above, or import it dynamically:

```tsx
import dynamic from "next/dynamic";

const SupportBubble = dynamic(() => import("./support-bubble"), { ssr: false });
```

Mount it in `app/layout.tsx` for a site-wide bubble, or in the specific page for
an inline widget.

## Config is applied once on mount

There is no `updateConfig()`, and re-applying config mid-call would tear down a
live conversation. To change config, change the component's `key`:

```tsx
<KonproWidget key={avatarSlug} config={{ sessionEndpoint: `/api/widget-session?for=${avatarSlug}` }} />
```

That remounts: the old instance is destroyed and a new session is minted.

Handler props (`onReady`, `onError`, `onTranscription`, `onResponse`,
`onAvatarStateChange`, `onBubbleOpen`, `onBubbleClose`) are exempt — they are
forwarded through a ref, so inline arrow functions are fine and do not cause
re-initialisation.

## One instance at a time

The widget's internal DOM uses global element ids, so two live widgets on one
page collide even though React gives each its own mount node. For a switcher or
carousel, render exactly one `<KonproWidget>` and drive it with `key`.

## StrictMode

Handled. React 18 StrictMode mounts, unmounts and remounts in development; the
widget's `destroy()` cancels an in-flight session fetch, so the discarded mount
does not leave a live session behind. You do not need to disable StrictMode.

You will still see the session endpoint called twice in development. That is
StrictMode, not a bug.

## Driving the instance

```tsx
"use client";

import { useRef } from "react";
import { KonproWidget, type KonproWidgetInstance } from "@konpro/widget-react";

export function Assistant() {
  const widget = useRef<KonproWidgetInstance | null>(null);

  return (
    <>
      <KonproWidget
        config={{ sessionEndpoint: "/api/widget-session" }}
        onReady={(instance) => { widget.current = instance; }}
        onAvatarStateChange={(state) => console.log(state)}
      />
      <button onClick={() => widget.current?.startCall()}>Start</button>
      <button onClick={() => widget.current?.sendTextMessage("Hello")}>Say hi</button>
    </>
  );
}
```

`sendTextMessage` returns whether the message was actually delivered — check it
rather than assuming. `interruptAI()` is a no-op when `allowInterruption: false`.

Do not call `destroy()` yourself; the component owns the instance lifetime.

## Noisy environments

```tsx
config={{ sessionEndpoint: "/api/widget-session", pushToTalk: true }}
```

Required for kiosks and lobbies, and strongly advisable whenever `audioOnly` is
on — see Rule 7 in SKILL.md.

## Types

`KonproWidgetConfig`, `KonproWidgetInstance`, `KonproBubbleOptions` and
`AvatarState` are re-exported from `@konpro/widget-react`. The `config` prop is
`Omit<KonproWidgetConfig, "containerId" | "bubble">` — the component owns both.
