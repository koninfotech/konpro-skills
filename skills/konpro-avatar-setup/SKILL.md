---
name: konpro-avatar-setup
description: >
  Provision Konpro credentials and avatars with @konpro/js-sdk — get an API key,
  list avatars, voices and brains, create an agentic avatar, and find the
  agenticAvatarId that binds a widget session. Use when setting up a Konpro
  account, choosing or creating an avatar or agent, or when an integration needs
  an agenticAvatarId and none is available yet.
---

# Konpro avatar setup

Getting from zero to the two values a widget integration needs:
`KONPRO_API_KEY` and `KONPRO_AGENTIC_AVATAR_ID`.

For wiring the widget itself, use the `konpro-widget-integration` skill.

Reference: https://www.npmjs.com/package/@konpro/js-sdk

## 1. API key

Generate at **https://studio.konpro.ai/api-keys**.

Server-side only. Never in browser code, never in a `NEXT_PUBLIC_` / `VITE_`
variable, never committed. Put it in `.env` and confirm `.env` is gitignored.

```bash
# .env
KONPRO_API_KEY=...
```

Verify it before anything else — a bad key surfaces later as a confusing 401 from
an unrelated call:

```js
import { KonPro } from "@konpro/js-sdk";

const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY });
const { data } = await konpro.apiKeys.validateApiKey();
console.log(data);
```

## 2. The object model

```
Avatar   (appearance)  ─┐
Voice    (speech)      ─┼─→ AgenticAvatar  ──→ widget session
Brain    (behaviour)   ─┘
```

An **AgenticAvatar** binds the three together. Its `id` is the
`agenticAvatarId` — the only one of these the widget integration needs.
`avatarId` (appearance) is a different id; passing it where `agenticAvatarId`
belongs fails at session creation.

## 3. Find an existing agentic avatar

Most accounts already have one. Check before creating another.

```js
import { KonPro } from "@konpro/js-sdk";

const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY });

const { data, meta } = await konpro.agenticAvatars.listAgenticAvatars({ pageSize: 50 });

for (const a of data) {
  console.log(a.id, "—", a.name, a.description ?? "");
}
console.log(`${data.length} of ${meta.total}`);
```

Copy the `id` you want:

```bash
# .env
KONPRO_AGENTIC_AVATAR_ID=...
```

That is everything the integration needs. Stop here unless you are building a new
agent.

Fetch one by id, with its related objects resolved:

```js
const { data } = await konpro.agenticAvatars.getAgenticAvatar({
  agenticAvatarId: process.env.KONPRO_AGENTIC_AVATAR_ID,
});
console.log(data.name, data.avatar?.name, data.voice?.name, data.brain?.name);
```

## 4. Create a new one

Needs an `avatarId`, a `voiceId` and a `brainId`. All three are required.

```js
import { KonPro } from "@konpro/js-sdk";

const konpro = new KonPro({ apiKey: process.env.KONPRO_API_KEY });

const { data: avatars } = await konpro.avatars.listAvatars({ pageSize: 50 });
const { data: voices } = await konpro.voices.listVoices();
const { data: brains } = await konpro.brains.listBrains();

const { data: agent } = await konpro.agenticAvatars.createAgenticAvatar({
  agenticAvatarCreate: {
    name: "Support Agent",
    description: "Answers product and billing questions",
    avatarId: avatars[0].id,
    voiceId: voices[0].id,
    brainId: brains[0].id,
  },
});

console.log("KONPRO_AGENTIC_AVATAR_ID=" + agent.id);
```

Do not index blindly into `[0]` in real setup code — inspect the lists and pick
deliberately. `listAvatars` accepts a `scope` to separate stock avatars from your
own; `Avatar` carries `name`, `gender`, `occupation`, `previewImage` and
`cdnUrl` to choose from.

## 5. Pagination

Every list returns `{ data, meta }` with
`meta: { page, pageSize, total, totalPages, hasNext, hasPrev }`. Pages are
1-based.

```js
const all = [];
let page = 1;
while (true) {
  const { data, meta } = await konpro.agenticAvatars.listAgenticAvatars({ page, pageSize: 50 });
  all.push(...data);
  if (!meta.hasNext) break;
  page++;
}
```

## 6. Errors

```js
import { KonPro, KonProError } from "@konpro/js-sdk";

try {
  await konpro.agenticAvatars.getAgenticAvatar({ agenticAvatarId: "nope" });
} catch (error) {
  if (error instanceof KonProError) {
    console.error(error.status, error.code, error.message, error.requestId);
  }
}
```

| status | code | meaning |
|---|---|---|
| 401 | `MISSING_API_KEY` | no key provided |
| 401 | `INVALID_API_KEY` | key invalid or expired |
| 404 | `NOT_FOUND` | wrong id — check it is an agentic avatar id, not an avatar id |
| 422 | `VALIDATION_ERROR` | bad request parameters |
| 429 | `RATE_LIMIT_EXCEEDED` | too many requests |

Quote `requestId` when contacting support. Never return `error.message` to a
browser — log it server-side and send something generic.

## Handing off

With both values set, switch to `konpro-widget-integration`. The client never
sees either one: the session endpoint holds the key and the token carries the
avatar binding.
