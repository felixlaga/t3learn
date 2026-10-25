# T3 Code attribution

Adapted from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at commit `5b35402623d7d1d88eaa472807272a6c2e78012a` (reviewed 2026-10-25).

Relevant reference surfaces include the Codex app-server account/login and runtime integration, Claude Agent SDK runtime and initialization probes, real-HOME/Keychain handling, and the centered transcript, rounded layered composer and compact model controls:

- `apps/server/src/provider/CodexChatGptAuth.ts`
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`
- `apps/server/src/textGeneration/ClaudeTextGeneration.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/ComposerSurface.tsx`
- `apps/web/src/components/chat/ComposerControlsBar.tsx`

The LearnHarness adaptations are in `src/agent/cli-{process,providers,stream}.ts`, the CLI settings/API surfaces, `components/composer-surface.tsx`, and the chat/composer/model-control styles. The runtime bridge translates to LearnHarness's existing Pi learning tools rather than replacing them with T3 Code's coding-agent orchestration. This is an independent adaptation, not an official T3 product. LearnHarness retains its existing AGPL-3.0-only license; the following notice is retained for the T3-derived portions and included in desktop resources.

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
