# Mock provider fixtures

`chat.json` is served by the exactly pinned `@copilotkit/aimock@1.48.0` on a run-owned free loopback port when the workflow runs with
the local mock provider. It answers the prompts the regression scenarios send through the custom
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

The `translation-settings` pilot retains real model selection, clipboard, history,
usage persistence and application restart. Its responses and token counts are mock
data, not translation-quality evidence. The in-process service is closed in the case's
`finally`; the separate workflow service is owned by `mock-start`/`mock-stop` and
`cleanup`. Worker logs and request-count summaries are retained under the run's logs;
ownership tokens and raw provider request bodies are not uploaded by the controller.
