# Mock provider fixtures

`chat.json` is served by `@copilotkit/aimock` on `127.0.0.1:4010` when the workflow runs with
`provider_mode=mock`. It answers the prompts the regression scenarios send through the custom
provider, so a phase can run without repository provider credentials and without network flakiness.

First match wins. A prompt with no fixture gets HTTP 404 `no_fixture_match`, which fails the phase
instead of silently passing it.

## Covered tasks

| Task | Prompt | Reply |
| --- | --- | --- |
| `custom-provider-chat`, `custom-assistant`, `provider-model-scroll` | `Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.` `In one sentence, what is two plus two?` `Hello` `markdown table please` | the marker the assertion waits for |
| `chat-stream-failure` | the scenario drives its own in-process server; these fixtures only cover the recovery turn | marker text |
| `translation` | `CherryStudio Neptune 27182 TRANSLATION_MARKER`, `PDF_TRANSLATION_MARKER_314159` | input markers echoed so the output assertion sees them |
| `quick-assistant` | `Reply with exactly QUICK_ASSISTANT_PASS and nothing else.` | `QUICK_ASSISTANT_PASS` |
| `startup-smoke`, `mini-app`, `notes` | no provider prompt | — |

## Tasks that mock mode refuses

`provider_mode=mock` fails fast for every other task (see the mock step in
`.github/workflows/e2e-regression-test.yml`) because a fixture cannot drive them:

- `knowledge` — K-01 asserts semantic retrieval. With no embedding fixture aimock returns its
  deterministic fallback vectors, so a "pass" would carry no semantic evidence.
- `everything-mcp` — MCP-01 asserts a persisted, successful `everything/get-sum` execution. The
  application exposes MCP tools to the model only through the deferred-tool meta tools
  (`tool_search`, `tool_inspect`, `tool_invoke`); a measured request offered exactly
  `automation_repl`, `automation_repl_reset`, `fs_read`, `mcp_resource_read`, `tool_search`,
  `tool_inspect`, `tool_invoke` and no `mcp__everything__get-sum`. A single tool-call fixture
  therefore cannot reach the server; scripting the meta-tool loop would pin three internal tool
  names and break on any exposition change.
- `skill-import`, `claude-agent-runtime`, `pi-runtime`, `agent-basic-task` — multi-leg agent tool
  loops (inspect, invoke, file write, skill token).
- `cherryin-chat`, `image-generation` — own upstream models (CherryIn credentials, image model);
  mock mode only repoints the custom provider.
- `code-cli`, `openclaw` — external CLIs, no provider traffic of their own.
