# Session endpoint

The host app exposes this route. It calls the Konpro API server-side with the
secret key and returns the session payload to the browser. The widget never
holds a long-lived key.

```bash
npm install @konpro/js-sdk
```

```bash
# .env — server-side only. Never NEXT_PUBLIC_ / VITE_ prefixed.
KONPRO_API_KEY=...
KONPRO_AGENTIC_AVATAR_ID=...
```

Get both from https://studio.konpro.ai/api-keys (see the `konpro-avatar-setup`
skill for finding the `agenticAvatarId`).

## The contract

Return `session.data` — the whole object. `createWidgetSession` resolves to
`{ data, meta }`; `data` is the payload the widget expects, already in camelCase
with a populated `avatar`.

```ts
{
  sessionToken: string;   // short-lived JWT
  sessionId: string;
  expiresAt: string;      // ISO
  expiresIn: number;      // seconds
  websocketUrl: string;
  userId: string;
  avatar: { id, name, video_url, image_url };  // avatar.id is mandatory
  audioOnly?: boolean;
  enableWebrtc?: boolean;
}
```

Do not destructure it down to a subset. Dropping `avatar` produces a session
that mints fine and fails at WebSocket connect — see Rule 1 in SKILL.md.

`createWidgetSession` accepts `agenticAvatarId` (required), `userMetadata`,
`allowedOrigins`, `audioOnly`, `enableWebrtc`.

## Next.js — App Router (most common)

`app/api/widget-session/route.ts`:

```ts
import { KonPro, KonProError } from "@konpro/js-sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY! });

export async function POST(request: Request) {
  // The widget POSTs { audioOnly }, plus agenticAvatarId only if the client
  // config set one — which it should not.
  const { audioOnly = false } = await request.json().catch(() => ({}));

  try {
    const session = await konpro.widget.createWidgetSession({
      widgetSessionCreate: {
        agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID!,
        audioOnly,
        // Identify the end user however your app does. Reaches your agent
        // as session metadata; do not put secrets in it.
        userMetadata: { visitorId: crypto.randomUUID() },
      },
    });

    // The complete payload. No field picking.
    return NextResponse.json(session.data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof KonProError) {
      console.error("Konpro session failed", error.code, error.requestId);
      return NextResponse.json(
        { error: "Could not start a session" },
        { status: error.status === 401 ? 500 : error.status },
      );
    }
    throw error;
  }
}
```

Notes:

- `runtime = "nodejs"`. The SDK is a server SDK; do not run it on the Edge
  runtime without checking its fetch requirements.
- `dynamic = "force-dynamic"` and `Cache-Control: no-store`. A cached session
  response hands the same expiring token to every visitor.
- Never return `error.message` to the browser — upstream messages can name
  internal resources. Log server-side, return something generic.
- Pages Router: the same body works in `pages/api/widget-session.ts` with
  `(req, res)` and `res.status(200).json(session.data)`.

## Express

```js
import express from "express";
import { KonPro, KonProError } from "@konpro/js-sdk";

const app = express();
app.use(express.json());

const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY });

app.post("/api/widget-session", async (req, res) => {
  const { audioOnly = false } = req.body ?? {};

  try {
    const session = await konpro.widget.createWidgetSession({
      widgetSessionCreate: {
        agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID,
        audioOnly,
      },
    });

    res.set("Cache-Control", "no-store").json(session.data);
  } catch (error) {
    if (error instanceof KonProError) {
      console.error("Konpro session failed", error.code, error.requestId);
      return res.status(502).json({ error: "Could not start a session" });
    }
    console.error(error);
    res.status(500).json({ error: "Could not start a session" });
  }
});

app.listen(3000);
```

`express.json()` is required. Without it `req.body` is `undefined` and
`audioOnly` silently defaults — the session then negotiates video when the
client asked for audio-only.

## Fastify

```js
import Fastify from "fastify";
import { KonPro, KonProError } from "@konpro/js-sdk";

const app = Fastify({ logger: true });
const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY });

app.post("/api/widget-session", async (request, reply) => {
  const { audioOnly = false } = request.body ?? {};

  try {
    const session = await konpro.widget.createWidgetSession({
      widgetSessionCreate: {
        agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID,
        audioOnly,
      },
    });

    return reply.header("Cache-Control", "no-store").send(session.data);
  } catch (error) {
    if (error instanceof KonProError) {
      request.log.error({ code: error.code, requestId: error.requestId });
      return reply.code(502).send({ error: "Could not start a session" });
    }
    throw error;
  }
});

await app.listen({ port: 3000 });
```

Fastify parses JSON bodies by default. If you attach a schema to this route,
allow `audioOnly` and `agenticAvatarId` through or the widget's POST is rejected.

## Restricting who can start a session

The route mints billable sessions. It is public unless you gate it.

- **Authenticate the caller.** Check the session cookie / bearer token before
  calling `createWidgetSession`, exactly as any other privileged route.
- **Pin the origin.** Pass `allowedOrigins` so a token minted for your site
  cannot be used from another:

  ```ts
  widgetSessionCreate: {
    agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID!,
    allowedOrigins: ["https://www.example.com"],
    audioOnly,
  }
  ```

  The server rejects a mismatched origin at WebSocket connect, deliberately and
  without retry.
- **Rate-limit it** per IP or per user.

## Choosing the avatar per request

Do not accept an `agenticAvatarId` from the request body — that lets any visitor
bind a session to any avatar in your account. Derive it server-side:

```ts
const avatarId = AVATARS[resolveTenant(request)] ?? process.env.KONPRO_AGENTIC_AVATAR_ID!;
```

## Token refresh

Return `expiresAt` (or `expiresIn`). The widget refreshes pre-emptively before
expiry; without either it logs a warning and can only react after the connection
has already failed. `session.data` includes both — another reason not to trim it.

## Multiple avatars, one route

One route per avatar is unnecessary. Keep a single route and select the avatar
from server-side state (tenant, page, logged-in plan). Client config stays
identical across all of them and carries no `agenticAvatarId`.
