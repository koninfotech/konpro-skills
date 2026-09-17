# Konpro Agent Skills

Agent Skills for integrating the [Konpro](https://konpro.ai) AI voice-avatar
widget. Install them once and your coding agent can wire up a complete
integration — client embed *and* the server-side session endpoint — without
rediscovering the failure modes that make the two halves disagree.

## Install

```bash
npx skills add konpro/skills
```

Installs into whichever agents you have — Claude Code, Cursor, Codex, Copilot,
Gemini CLI, opencode and others. Project scope by default; `-g` for global.

Then just ask:

> Add an interactive avatar to our support page.

<details>
<summary>Claude Code plugin marketplace</summary>

```
/plugin marketplace add konpro/skills
/plugin install konpro-skills@konpro
```

</details>

## The skills

| skill | what it does |
|---|---|
| **konpro-widget-integration** | Mount the widget (vanilla JS or React), implement the session endpoint with `@konpro/js-sdk`, configure CSP and microphone permissions, and debug connection, token, worklet and mic errors. |
| **konpro-avatar-setup** | Get from zero to credentials: API key, listing and creating avatars and agents, and finding the `agenticAvatarId` a session binds to. |

They are separate on purpose — provisioning an avatar does not load the
integration skill, and vice versa.

## What they encode

A Konpro integration always has two halves:

| half | package |
|---|---|
| client — mounts the widget, opens the WebSocket, handles mic and WebRTC | [`@konpro/widget`](https://www.npmjs.com/package/@konpro/widget), [`@konpro/widget-react`](https://www.npmjs.com/package/@konpro/widget-react) |
| server — mints a short-lived session token | [`@konpro/js-sdk`](https://www.npmjs.com/package/@konpro/js-sdk) |

The widget never talks to the Konpro API with a long-lived key. Your app exposes
its own endpoint, that endpoint calls Konpro server-side with the secret key, and
returns a session payload to the browser.

The second half is where the real bugs live. These skills carry the decisions and
failure modes, not the option tables — for those they link to the package
READMEs, which stay current:

- Return the **complete** session payload. An endpoint that drops `avatar` mints a
  session that works right up until the WebSocket opens, then fails with
  `Missing required fields: token, agenticAvatarId, userId`.
- Do **not** put `agenticAvatarId` in client config when using `sessionEndpoint`.
  It masks exactly the bug above — which is how a working CDN demo and a broken
  React integration can differ by one redundant line.
- Never ship `apiKey` in the browser.
- CSP and `Permissions-Policy` are separate mechanisms with separate failures. A
  blocked AudioWorklet reports as a `script-src-elem` violation, never as a
  microphone error.
- `audioOnly` is fixed for the lifetime of a session, and voice barge-in does not
  work in it.

## Verify an integration

```bash
node skills/konpro-widget-integration/scripts/verify-integration.mjs \
  http://localhost:3000/api/widget-session
```

POSTs what the widget posts and checks the response the way the widget reads it —
above all that `avatar.id` is present. Exits non-zero on failure. Never prints
the token.

## Local development

```bash
git clone https://github.com/konpro/skills
cd skills
npx skills add ./
```

## Documentation

- [Widget integration guide](https://docs.konpro.ai/api/widget-integration)
- [`@konpro/widget`](https://www.npmjs.com/package/@konpro/widget) — full config reference
- [`@konpro/widget-react`](https://www.npmjs.com/package/@konpro/widget-react) — React bindings
- [`@konpro/js-sdk`](https://www.npmjs.com/package/@konpro/js-sdk) — server SDK
- [Konpro Studio](https://studio.konpro.ai/api-keys) — API keys

## License

MIT
