# Critical-path desktop regression

These scenarios run against one controller-owned Electron instance per platform. The [controller](../../../scripts/e2e/regression/README.md) installs and launches either the requested development checkout or release installer.
The separate [Playwright config](../../../playwright.regression.config.ts) uses CDP rather than the per-test launch fixture used by the older E2E smoke suite.

## File organization

- `phases/*.test.ts` files register the CI phases. Phase IDs match their camelCase file stems, without numeric prefixes. The manifest's first-occurrence order in `scripts/e2e/regression/cases.ts` defines the phase order; the workflow follows that order rather than filename sorting.
- `scenarios/*.ts` files implement individual case workflows. Keep their names aligned with the exported scenario function or the behavior under test.
- `helpers/*.ts` files contain reusable navigation, model setup, and domain interactions. Use camelCase names for function modules.
- `fixtures/` contains test data, sample skills, and HTTP/MCP servers. Executable Node servers may use `.mjs`; sample skills retain their required `SKILL.md` convention.
- `fixture.ts` validates required capabilities and owns each test's CDP connection and failure evidence.
- `RegressionApp.ts` locates windows and delegates process operations. Connecting or locating a window does not change application preferences.
- `setup.ts` explicitly establishes English locale, onboarding/telemetry settings, a visible conversation sidebar, and disabled desktop assistants before each non-startup scenario.
- Domain helpers such as `helpers/models.ts`, `helpers/knowledge.ts`, and `helpers/agents.ts` express reusable user workflows.
- `helpers/navigation.ts` and `helpers/settings.ts` own shared navigation; `helpers/chat.ts` owns chat interactions and response assertions.
- The controller owns `RegressionReporter.ts` and its unit tests.
- Phase entry points import the extended `test` from `fixture.ts`. Scenario implementations and helpers use Playwright assertions directly and do not register tests.

## State ownership

The application process and configured service providers are shared within a run. Provider configuration comes from the same run environment and is not changed between scenarios.
Custom assistants and knowledge bases are named with their case ID. Agent work directories are case-scoped; file tasks remove their own previous output before asserting newly produced content.
M-02 creates a case-owned assistant with no custom prompt and an empty setup topic so it appears in the conversation list, restores sidebar visibility after reloading, sends its provider-verification message through a new UI-created chat, and removes that assistant and its topics after the persistence check.
`custom-provider-chat,polish-prompts,browser-recovery` selects only M-02, MP-16 and MP-125 for combined provider, polishing and local-service recovery checks.
Each non-startup scenario begins on Chat with quick/selection assistants disabled. Persistence assertions restart the application inside the same scenario without repeating setup, so initialization cannot hide lost persisted state.
The built-in assistant's tests start new tasks and clear skill tokens where required. A scenario that mutates a shared resource must restore its intended state explicitly before relying on it.

A failed scenario must not supply the expected result for another scenario. Assert a new assistant response, a newly written file, or a real native event; do not inject success markers through IPC.

`MCP-01` uses a scripted loopback model with declared function-call support and a
128k context window. It still creates the real Everything server through the UI,
executes `get-sum` in that process, verifies the actual tool response and persisted
input/output, and reconnects after a restart. External model behavior is outside
this case; provider-backed chat cases retain their separate coverage.

Development update checks in `MP-114` start the [loopback update feed](../../helpers/http/README.md#mock-development-update-feed)
from `dev-app-update.yml`, serving the running version without an installer.
The real updater performs the HTTP request and version comparison; installer
runs keep their packaged feed. Diagnostic export uses Help → System diagnostics → More.
The separate assertion about the feedback dialog's Report a problem entrance remains in place.

The `knowledge-smoke` task is one end-to-end case (`K-01`): create and index a knowledge
base, verify recall, restart the application, then query the persisted base and
verify the answer and citations. It imports the fixtures only once. The `knowledge`
module task also includes the implemented knowledge case-library scenarios.

### Web tools, estimated cost, and note recall

- `MP-10` and `MP-35` declare `function-call` on their test models so Chat can enable client-side web tools. `MP-10` checks the DuckDuckGo settings and runs a live lookup. `MP-35` supplies a dated bulletin over loopback through the Tavily adapter and fetches `https://example.com/` through the public URL fetch adapter. In mock mode, the model sends `web_fetch` a `urls` array and uses the title, content, and citation ID returned by each tool.
- `MP-39` checks the `Estimated` label and the exact USD amount separately in the matching Usage row, alongside the token count, time to first token, and generation speed.
- `MP-79` exports a real note, waits for BM25 indexing, and checks retrieval through both the knowledge API and Chat. The mock model recognizes the recall prompt with the composer’s appended knowledge-base context, searches the case-owned base, and quotes the marker and citation ID from the retrieved note. Re-exporting the note must create a second ready source while preserving the first.

### Code preview, settings, and file library

- `MP-10` and `MP-40` reopen the conversation sidebar after reload when needed and reveal their assistant in the virtualized list. `MP-40` then positions the code preview inside the message list and measures wheel scrolling in the list and preview separately.
- `MP-107` opens Settings through the sidebar account trigger, which can display a profile name. The case verifies the keyboard bindings, long-paste attachment, delete confirmation, and persisted preferences.
- `MP-68` reconnects to the controller-owned profile for file cleanup if a restart closes the original page. See the [controller shutdown contract](../../../scripts/e2e/regression/README.md#responsibilities) for the Windows CDP release check. `MP-70` uses case-specific file names so its open and reveal actions resolve to the files it imported.
- `CODE-03` waits for the configured provider to become active before launching OpenClaw. A failure reports launch alerts and, in branch runs, redacted OpenClaw entries from the run-owned application log. The case verifies the real gateway and dashboard.

## Adding or selecting a case

1. Add the case to `scripts/e2e/regression/cases.ts`, including its phase, module and focused `tasks`, and required capabilities. Task IDs remain English kebab-case and are independent of phase IDs.
2. Register it in `phases/<phaseId>.test.ts` with `test(...caseDefinition('CASE-ID'), async ({ app, mainWindow }) => { ... })`.
3. Establish its preconditions in the scenario or domain helper. Keep selectors scoped to the relevant product surface.
4. Run manifest tests, typechecking, and Playwright enumeration. Add a workflow step only when introducing a new phase.

Select `suite=regression` to run just the desktop regression. Use the task IDs from the manifest in the workflow's string `task` input (`all` selects every case). Combine modules or focused tasks with commas, for example `chat-core,browser,settings`; overlapping cases execute once in manifest order. Within an initialized run, execute a phase through the same controller as CI:

```sh
pnpm exec tsx scripts/e2e/regression/cli.ts run-phase \
  --run-dir /absolute/run-directory --phase basicFeatures
```

`cherryin-chat` selects M-01 on macOS and Windows. It starts in Model Provider settings, completes real CherryIN OAuth in an isolated Chromium session, checks the desktop balance, syncs `deepseek/deepseek-flash` and verifies a completed chat reply before signing out. The workflow reads `CHERRY_TEST_CHERRYIN_ACCOUNT` and `CHERRY_TEST_CHERRYIN_PASSWORD` from repository Actions secrets. The account needs an enabled API Key in the `default` group that can call this model. For a local run, initialize with `--task cherryin-chat`, install the browser with `pnpm exec playwright install --only-shell chromium` and pass the same variables in the environment of `run-phase --phase cherryIn`.

`settings-search` selects SET-01 and SET-02. They verify that pointer clearing keeps
search open, focused, and on the same tab, and that a blank query and a query
with no matches show different prompts.

`native-notifications` selects MP-110 for notification settings, actual system delivery,
native activation and disabled-category suppression. `native-settings` selects the same case.

`marketplace-smoke` selects MARKET-01: open Marketplace from Launchpad, switch resource
categories, search the built-in MCP catalog, and open server management. `scheduled-tasks`
selects MP-58 through the standalone Scheduled Tasks app, including task creation,
execution conversations, pause and resume. MCP server creation and persistence continue
to run in `everything-mcp`, reached through Marketplace's Manage MCP action.

The run's task selection controls which cases execute. Use `--task notes` for all
implemented Notes cases, including those in other phases, or `--task notes-smoke` for
the create-and-save flow. Do not narrow an all-task run manually and then treat it as
a full pass.

## Local streaming failure regression

`chat-stream-failure` selects `C-03` (OpenAI Chat Completions) and `C-04`
(Claude Messages) in the `modelsAndAssistants` phase. Use `claude-stream-failure`
to select only `C-04`. Both cases run without external provider credentials.
`C-03` uses the [shared mock chat HTTP server](../../helpers/http/README.md).
`C-04` uses a case-owned AIMock server and checks the matched requests and
interruption in its journal. Each case seeds its provider, assistant, and topic
through DataApi and sends a message in the real UI. After partial text becomes visible,
the test destroys the HTTP connection without a finish event. It checks that
the text remains visible, the stored
message has status `error` with text state `done`, and the same message survives
an Electron restart. A follow-up message must then complete successfully. The case
restores topic naming and removes its test resources.

Run from the repository root, with CDP port 9222 and inspector port 9229 free:

```sh
pnpm install
pnpm download:binaries
pnpm rebuild:electron
pnpm run build:utility-process
pnpm exec dotenv -v CHERRY_EDITION=global -- electron-vite build
TEST_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cherry-stream-failure.XXXXXX")"
pnpm exec tsx scripts/e2e/regression/cli.ts preflight --task chat-stream-failure
pnpm exec tsx scripts/e2e/regression/cli.ts initialize \
  --run-dir "$TEST_RUN_DIR" --mode branch --platform macos \
  --task chat-stream-failure --ref "$(git branch --show-current)" \
  --sha "$(git rev-parse HEAD)" --runner local
pnpm exec tsx scripts/e2e/regression/cli.ts launch \
  --run-dir "$TEST_RUN_DIR" --target-root "$PWD" --run-key "$(basename "$TEST_RUN_DIR")"
pnpm exec tsx scripts/e2e/regression/cli.ts run-phase \
  --run-dir "$TEST_RUN_DIR" --phase modelsAndAssistants
pnpm exec tsx scripts/e2e/regression/cli.ts finalize --run-dir "$TEST_RUN_DIR"
pnpm exec tsx scripts/e2e/regression/cli.ts gate --run-dir "$TEST_RUN_DIR"
pnpm exec tsx scripts/e2e/regression/cli.ts cleanup --run-dir "$TEST_RUN_DIR"
```

Always run `cleanup`, including after a failure. The controller stops only its
recorded process. The run directory contains the report and failure evidence;
boot configuration and application data are isolated under the run directory. Keep
local runs outside the source checkout so generated extension code is not scanned
by repository lint. Do not run Node SQLite tests
while Electron is running, since native dependency rebuilds switch its ABI.

Detached-tab checks select the child by its `window.get_init_data` tab ID. A URL
alone can also match the hidden prewarmed SubWindow and produce a false empty-page failure.

## Configuration and evidence

MP-77 verifies PDF text/fonts, DOCX text and table structure, native PDF preview,
print preview, and empty-note export errors. Editing documents in a third-party
word processor is outside this application's regression contract.

MP-52 opens the edited source file itself in TextEdit on macOS or Notepad on Windows, copies the editor selection, and compares it with the expected file content. Its registered editor window and newly launched process are cleaned up after the check.

Windows MP-90 opens the exported image in Microsoft Edge with a run-owned profile under `private/`, checks its decoded dimensions, and closes that browser. Edge must be installed on the runner. MP-82 runs the document-drop flow on both platforms.

`translation-settings` selects only MP-86. The case uses pinned aiMock responses for
language detection and translation, while exercising the real settings UI, model
routing, automatic clipboard copy, history and usage storage, and restart persistence.
Its `data-source` annotation and request-journal attachment identify the mocked model
boundary. Mock provider provenance is recorded independently in the run reports;
fixture success does not establish external model quality.

Never attach credentials or enable credential-bearing Playwright traces. HTML reports and failure screenshots are produced by Playwright and the fixture; sanitized Electron logs are copied during finalization.

Use the [frontend testing guidelines](../../../docs/dev/references/testing/frontend-testing.md). Keep local changes separate from hosted runtime validation; successful enumeration and unit tests do not prove desktop permissions or external model availability.


## Desktop platform coverage

All registered regression cases participate on both macOS and Windows, including the marketplace navigation smoke case. The additional 23 cases in [draft #23868](https://github.com/CherryHQ/cherry-studio/pull/23868) are deferred and are not part of this layer's coverage. Platform-specific subflows use the actual desktop integration: TextEdit or Notepad, native file and print dialogs, native notification and tray menus, and Terminal or the Windows console. macOS permission prompts and transparent window controls are checked only where the product exposes them; shared settings, execution, persistence and cleanup assertions still run on Windows.

Windows single-instance checks use Restart Manager's [resource-user query](https://learn.microsoft.com/en-us/windows/win32/api/_rstmgr/) to verify SQLite file owners. The probe never calls shutdown or restart APIs. Native console input is limited to the new Claude launch process under the isolated run directory, with PID and creation-time checks before each operation.

These adapters require real desktop execution; successful typechecking or enumeration is not cross-platform acceptance.

## Partial coverage

A passing implemented flow does not cover capabilities absent from the current product. Scenarios record these gaps with `uncovered` annotations; they do not search for fictional controls.

| Case | Implemented checks | Uncovered capability |
| --- | --- | --- |
| MP-18 | Message queue, hover card, attachment preview, copy source, MCP inline images, URL fallback and Chinese title search | A direct Delete action in the sent-image menu; public tool-result image URL previews; pinyin-initial search |
| MP-19 | Markdown, DOCX, video, empty PPTX error, pasted-text preview and clipboard round trip | Rendering a nonempty PPTX; external-app fallback; a Quote selection button in plain-text previews |
| MP-48 | Window-local draft recovery across topic switches and clearing after send | Process-restart recovery is outside the documented composer memory-cache contract |
| MP-69 | File categories, counts and clearing filters | Filename search and result highlighting |
| MP-72 | Not registered: the product has no library-file reference entry point | Referencing an existing library file from the composer |
| MP-74 | Draft persistence and external-edit conflict handling | An explicit Saved status indicator |
| MP-82 | Document import, size limit, translation and Notes export control | Source character counter, Markdown save-as and translated-file naming |
| MP-90 | Preview zoom, pan, rotation and saving the original image | Image upscaling or enhancement |
| MP-107 | Shortcut configuration, paste-as-file, delete confirmation and settings persistence | Live token counting in the draft composer |
| MP-115 | Backup archive creation and backup-manager visibility | Native notification delivery |
| MP-144 | Queue, steer, edited queue targets and exclusion of conflicting shortcuts | A warning after attempting to select a conflicting shortcut; those choices are absent |
| MP-150 | Files RTF formatting, encoding, validation, preview switching, links and restart; Chat attachment transport | Ordinary Chat RTF side panel, a 360px side panel, and Shift-JIS/Big5 fixtures |
