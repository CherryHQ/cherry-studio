# Mock provider fixtures

`chat.json` is served by the exactly pinned `@copilotkit/aimock@1.46.0` on a run-owned free loopback port when the workflow runs with
`provider_mode=mock`. It answers the prompts the regression scenarios send through the custom
provider, so a phase can run without repository provider credentials and without network flakiness.

First match wins. Strict mode returns HTTP 503 for a prompt with no fixture, which fails the request
instead of silently passing it.

## Covered tasks

| Task | Prompt | Reply |
| --- | --- | --- |
| `custom-provider-chat`, `custom-assistant`, `provider-model-scroll` | `Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.` `In one sentence, what is two plus two?` `Hello` `markdown table please` | the marker the assertion waits for |
| `chat-stream-failure` | the scenario drives its own in-process server; these fixtures only cover the recovery turn | marker text |
| `translation-smoke` | `CherryStudio Neptune 27182 TRANSLATION_MARKER`, `PDF_TRANSLATION_MARKER_314159` | input markers echoed so the output assertion sees them |
| `translation-settings` | MP-86 starts a case-owned aiMock instance in `tests/e2e/regression/fixtures/translationSettingsServer.ts` | Separate language-detection and streaming translation responses, with explicit token usage |
| `quick-assistant` | `Reply with exactly QUICK_ASSISTANT_PASS and nothing else.` | `QUICK_ASSISTANT_PASS` |
| `startup-smoke`, `mini-app-smoke`, `notes-smoke` | no provider prompt | — |

## Tasks that mock mode refuses

`provider_mode=mock` fails fast for every other task (see the mock step in
`mockProvider.ts`) because a fixture cannot drive them:

- `knowledge`, `knowledge-smoke` — K-01 asserts semantic retrieval. With no embedding fixture aimock returns its
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

Module tasks such as `notes`, `mini-app`, and `translation` include additional
case-library scenarios. Only the focused tasks listed above are covered by these fixtures.

The `translation-settings` pilot retains real model selection, clipboard, history,
usage persistence and application restart. Its responses and token counts are mock
data, not translation-quality evidence. The in-process service is closed in the case's
`finally`; the separate workflow service is owned by `mock-start`/`mock-stop` and
`cleanup`. Worker logs and request-count summaries are retained under the run's logs;
ownership tokens and raw provider request bodies are not uploaded by the controller.
