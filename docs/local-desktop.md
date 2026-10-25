# CLI subscriptions and a local macOS app

This edition keeps every API-key provider and existing subscription connection. It adds two independent choices: **Codex CLI** (`codex-cli`) and **Claude Code** (`claude-code`). Selecting either uses the installed CLI and its subscription login; it never falls back to an API-key provider.

## Build on your Mac

Use Node.js 24 LTS and npm. From this checkout:

```sh
npm ci
npm run desktop:local
```

On Apple Silicon, open `dist/local/mac-arm64/LearnHarness Local.app`. On Intel, open `dist/local/mac/LearnHarness Local.app`. To also produce a drag-and-drop installer:

```sh
npm run desktop:local -- --dmg
```

The command builds Next's standalone server, runs payload smoke checks, and packages the Electron app for the current Mac's architecture. It uses the existing flat icon, requires no original-author signing certificate, Apple team, notary profile, or full Xcode 26 installation, and publishes nothing. The result is a local unsigned/unnotarized build, not a distributable signed release. If macOS blocks your own build, use System Settings → Privacy & Security → Open Anyway.

The app is named **LearnHarness Local** and stores its data in `~/Library/Application Support/LearnHarness Local/`. It does not consume the upstream automatic-update feed. Rebuild this checkout to update it. The original `desktop:dist` release command is unchanged.

## Connect your subscriptions

Install the official [Codex CLI](https://developers.openai.com/codex/cli/) and/or [Claude Code](https://code.claude.com/docs/en/setup). The CLIs are not bundled into the app. Sign in from Terminal:

```sh
codex login
claude auth login
```

In LearnHarness Local:

1. Open **Settings → Providers**.
2. Under **Use your CLI subscriptions**, click **Use existing login** for the CLI you want. **Sign in** can also start its browser login; follow **Continue in browser** if shown.
3. If automatic discovery fails, expand **CLI setup & executable path**, enter the absolute path returned by `which codex` or `which claude`, and click **Save & refresh**.
4. Select **Codex CLI** or **Claude Code** in model settings, choose a runtime-discovered model, and save. Configure the strong, cheap and vision slots for the learning/background roles you want to use.
5. Start a lesson. Interactive learning tools and quizzes still run in LearnHarness.

The background-use checkbox controls whether that connection may run background learning tasks. Those requests use your subscription allowance too. Disconnect disables this app's connection and cancels its work; it does not log your terminal out. Existing API-key options remain available separately, including for tools such as web search and dictation.

Credentials remain in the CLI's own credential store, including the macOS Keychain. LearnHarness stores only connection preferences and executable paths in `data/cli-providers.json` beneath its application data directory. It does not copy OAuth tokens into its API-key store. Finder's limited PATH is handled by checking common installation locations as well as the optional explicit path.

## Runtime adaptation

Based on [T3 Code's provider/runtime patterns](t3-code-attribution.md): Codex uses `codex app-server` JSON-RPC (account read/login, model list, threads and turns). Claude uses the Claude Agent SDK with the installed Claude Code executable, an initialization-only account/model probe, and `claude auth login` for browser login. Both keep the real HOME for CLI credential access and remove API-key environment overrides.

LearnHarness has a different agent architecture from T3 Code. Each Pi request is translated into a bounded native CLI turn with the current system instructions, conversation and learning-tool definitions. Native tool calls return to LearnHarness; the next request replays the resulting authoritative transcript. This preserves browser-owned quizzes, edited sessions and context compaction. Coding/shell tools, project hooks and unrelated user MCP tools are disabled for lessons.

Model catalogs come from the installed runtime. Context limits are shown only when matching Pi metadata exists; unknown limits stay unknown. Subscription usage is labeled separately from API cost. Token counts can be incomplete when a runtime hands off a tool before reporting usage; these counts are not a subscription quota meter. Model access and limits depend on your plan and CLI version.

Development can use `npm run desktop:dev` or `npm run dev`. CLI login/configuration endpoints are limited to local hosts and same-origin browser requests; packaged apps also use the existing desktop API capability protection.

## Verification for this change

Verified locally on macOS Apple Silicon on 2026-10-25:

- `npm run typecheck`, `npm run lint`, and all **2,141** tests passed. The added deterministic transport tests use real subprocesses/Agent SDK against fixture CLIs, including tool handoff/replay, cancellation, admission and account changes.
- Live installed Codex 0.164.0 and Claude Code 2.1.310 reused existing subscription logins, discovered their model catalogs, and generated responses. A lesson generated a Codex multiple-choice quiz; switching that session to Claude Code and answering continued with a new interactive quiz. The CLI identities are checked again before each generation.
- `npm run desktop:local -- --dmg` passed standalone/payload checks and produced the Apple Silicon app and DMG. The packaged app launched, connected both CLIs (7 Codex and 13 Claude model entries at verification time), and retained the desktop API guard: an outside-window API request received HTTP 403.

Fresh browser authorization was not completed against the real accounts (the existing terminal logins were retained). Intel packaging, signing/notarization, and every learning/background tool were not individually exercised. Model counts and availability are runtime-dependent.
