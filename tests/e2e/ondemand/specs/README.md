# Reviewed code scenarios

Prefer a temporary JSON plan for supported UI actions. Add `<safe-name>.ts` only when the scenario requires reviewed code, and export a default async function accepting `ScenarioContext` from `scripts/e2e/ondemand/steps.ts`.

Use `context.page` for the owned main window, `context.runSteps(steps, options?)` for recorded actions/assertions, `context.screenshot(name?)` for masked evidence, and `context.ensureChinese()` for language preparation. At least one recorded required step must complete. A scenario cannot return its own passing verdict. The controller owns attachment, final environment checks, reporting, and cleanup; do not launch a second application or close its browser connection.

The dispatch `plan` is not an argument to a code scenario: when supplied, it defines the entire temporary test. Code scenarios undergo normal repository review; the QA read-only identity does not need write access to dispatch temporary plans.

## Conversation performance

Run the macOS scenario against a branch build after the controller containing the scenario is available on the selected ref.

```sh
gh workflow run qa-ondemand.yml --repo CherryHQ/cherry-studio --ref main \
  -f platform=macos -f mode=branch -f ref=main -f profile=clean \
  -f spec=conversation-performance
```

AIMock drives Chat and Work through 20 turns with 360 MCP calls per surface. The Work mixed case runs 96 Bash calls, 36 local image reads, and 24 MCP calls with results up to 512 KiB across 12 turns of long context. The large-image case reads twelve generated 6144 × 4096 PNGs in batches of three. All fixtures are local and require no model credentials.

The scenario checks visible replies, persisted tool results, outgoing image counts, long-context size, and actual scroll movement. The job log records frame-interval P95, P99, maximum, and counts over 50 ms. Frame timings are diagnostic because hosted runner scheduling varies. The image relay counts full request payloads before substituting inline data in requests that exceed the fixture server's capacity.

### Rich conversation stress

Select `spec=conversation-stress` with the same macOS branch dispatch parameters. Work builds 120 real turns, including four 48-call bursts. The fixture mixes Bash directory listings and stdout, MCP results up to 512 KiB, directory trees, highlighted code, JSON, diffs, tables, and math. The last turn must still reach the oldest user message through the history viewport. The run logs steady-state generation, generation during scrolling, and history scrolling at successive checkpoints.

### Message parts and interrupted conversations

Select `spec=conversation-interaction` with the same branch dispatch parameters. The Chat case loads 32 turns through the production message API. The [part fixtures](fixtures/conversationParts.ts) cover Markdown, reasoning, code, images, a file attachment, video, translations, errors, timeline markers, tool output and hidden metadata. The case verifies a decoded 6144 × 4096 image, reopened reasoning and tool results, a citations pill, a rendered Mermaid diagram, and the contents of an HTML artifact preview. Work-only actions such as opening a fork source are outside the Chat case.

AIMock streams the new replies through the live composer. The replies use separate payloads for the initial report, queued report with reasoning and previews, paused terminal output, interrupted checklist, and recovery JSON and diff. The case measures send-to-user-row, typing and Chinese IME composition during generation, queueing a follow-up, normal completion, manual pause, provider disconnect and retry recovery. It checks that queued input is sent once, that a disconnect preserves the draft and partial reply, and that retry status appears live and is absent from the saved message. Action durations include automation and polling. Frame intervals are recorded per phase.
