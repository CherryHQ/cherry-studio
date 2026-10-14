# Agent Runtime Background Subagents (L6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Pi runtime in `packages/agent-runtime` run subagents in the background, deliver their results to the parent as notifications, message and continue subagents (also across restarts), stop them, and let goals wait for and budget them, with L4 foreground behaviour kept.

**Architecture:** L4's `subagent.ts` splits into four files: `subagent.ts` (public types and the three tools), `subagentRun.ts` (one run of a child session: build, inbox, request cap, outcome), `subagentRegistry.ts` (the parent's subagent table: live runs, cap, stops, snapshots, restore) and `subagentDelivery.ts` (when results reach the parent: settle merge, idle runs under a prompt/compact lock, abort suppression, status messages). Everything rides on Pi extension events of the parent session; the goal extension talks to the registry over Pi's per-session event bus (`pi.events`), never through the host.

**Tech Stack:** TypeScript (ESM), `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` 1.1.0 (compiled JS in `node_modules`), AI SDK v6 (`ai`, `MockLanguageModelV3` in tests), Vitest 5, TypeBox (`Type` from `pi-ai`).

**Spec:** `docs/superpowers/specs/2026-10-14-agent-runtime-background-subagent-design.md`

## Global Constraints

- Package boundary: nothing under `packages/agent-runtime` imports `src/`, `@main`, `@shared`, `@logger`, `@application` or `@data`; no logging; external code enters through `src/index.ts` only.
- Subagent ids: `randomUUID()` from `node:crypto`; the host API calls it `sessionId`, the model's parameter is `id`. Never derive it from the parent's id.
- One run makes at most 200 model requests (`MAX_SUBAGENT_REQUESTS = 200`, checked at `turn_start`).
- At most 20 background subagents of one parent run at once (`DEFAULT_MAX_BACKGROUND = 20`, `SubagentPort.maxBackground` overrides); foreground subagents do not count; moving one to the background is never refused but counts afterwards.
- A notification result over the offload threshold goes through `ToolOutputStore` (`offload.thresholdChars`, with its 3,000-character floor); without offload the threshold is 20,000 characters (`NOTIFICATION_THRESHOLD_CHARS = 20_000`) and the head and tail are kept (8,000 + 8,000).
- Lists of subagents in errors and status messages: at most 20, most recently active first. An unmatched `model` lists at most 5 similar names.
- Tool names: `subagent({ description, prompt, fork?, background?, model? })` (`model` only when the host provides `SubagentPort.findModels`), `message_subagent({ id, message })`, `stop_subagent({ id })`; all `model-only`.
- Entry types: parent `cherry.subagent-state` (state), `cherry.subagent-notification` (custom message, user role to the model), `cherry.subagent-status` (custom message); child `cherry.subagent-origin` (state, data `{ parentToolCallId, fork, description, modelKey }`), `cherry.subagent-message` (custom message).
- Exact texts (from spec §5, §8.2, §8.3, §11.4, §6.7, §7.2):
  - background start: `Subagent started in the background (id: <sessionId>). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
  - moved to background: `The user moved this subagent to the background (id: <sessionId>); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`
  - foreground trailer, after a blank line: `(id: <sessionId> — continue this subagent with message_subagent.)`
  - cap: `<n> background subagents are already running; wait for one to finish before starting another.`
  - `Message queued for subagent <id>; it reads it after its current step.` / `Subagent <id> resumed in the background with your message; you will be notified when it finishes.`
  - `Subagent <id> was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.` / `Subagent <id> has finished and this app cannot continue finished subagents. Start a new subagent instead.` / `Subagent <id> cannot be continued: its transcript is not available.`
  - unknown id: `No subagent with id <id> in this conversation. Subagents you can address:` then one `<id> — <description> — <status>` line each (the second sentence and lines only when there are any).
  - `Stopped subagent <id>.` (plus `Partial output before it stopped:\n<partial>` when there is one) / `Subagent <id> is not running (<status>).`
  - in a subagent: `Subagents cannot start or manage subagents.`
  - interrupted call result (`error-text`): `This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.`
  - recovery hint, then a blank line, then the message: `Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.`
  - notification head: `Background subagent update (automatic message, not from the user):`
  - `A fork shares this conversation's prompt cache and must use the current model; drop model or fork.` / `No enabled model with tool support matches "<model>".` (+ ` Similar: <provider> / <model>, …`) / `Several models match "<model>":` + `- <provider> / <model>` lines + `Ask the user which one to use, then call subagent again with the provider and model name.`
  - `The goal's budget is used up; background subagents cannot be started.` / `/goal` status line `Waiting for <n> background subagent(s)`.
- Naming: `docs/references/architecture/naming-conventions.md`; new files follow the package's camelCase module names (`subagentRun.ts`, …). Inline comments at most 2 lines and only say why.
- Tests: no behaviour-pinning tests; every test states what breaking it catches (`// Breaks when …`). Use the package's own helpers (`tests/support.ts`, `tests/subagentSupport.ts`, `tests/goalSupport.ts`).
- Commits: Conventional Commits, scope `agent-runtime`, made with `git -c core.hooksPath=/dev/null commit -S --signoff -m "<message>"`, no attribution lines.
- Per-task gates, run serially, on the files the task changed: `pnpm exec oxfmt --write <files>`, `pnpm exec oxlint --deny-warnings <files>`, `pnpm exec eslint <files>`, `pnpm --filter @cherrystudio/agent-runtime typecheck`, the focused `pnpm exec vitest run --project agent-runtime <test files>`, then `pnpm test:agent-runtime` once.

## Review Focus

1. A host whose `configure` throws (or whose `load` has nothing) for a background launch or a continuation: the failed call must free its background slot, or after 20 failures no background subagent can ever start (Task 2 "frees the background slot of a launch that fails", Task 6 "fails when the host cannot load the transcript, and frees the slot").
2. The model sends two `message_subagent` calls to one finished subagent in one step: one continuation starts and reads both messages; two runs on one session would corrupt it (Task 6 "sends two messages of one step to a single continuation").
3. A background fork (`fork: true, background: true`): it starts from the conversation as it is, exactly like a foreground fork (Task 2 "starts a background fork from the conversation as it is").
4. A result waits for the user's next message (after the user stopped a turn) and the user runs a command that starts its own turn (`/goal resume`): no prompt carries the result, so that turn's settle must deliver it instead of stranding it (Task 3 "delivers a waiting result in a turn a command starts").
5. The user closes the conversation while a continuation is loading its transcript: once the parent is disposed, no subagent session keeps running (Task 6 "leaves no subagent running when the parent is disposed during a continuation").

---

## Notes: the Pi behaviour this plan relies on (verified 2026-10-14)

(a)–(h) and (u) were probed with scratch Vitest files under `packages/agent-runtime-pi/tests/` driving real sessions over `MockLanguageModelV3` (all deleted); the last two items come from reading Pi's dist and are exercised by Tasks 8 and 11's tests. Pi line references are to `pi-coding-agent/dist/core/agent-session.js` (AS).

- **(a) Settle merge.** `agent_before_settle` returning `{ entries: [...event.entries, customMessageDraft], continue: true }` continues the run in a new low-level run (`agent_start`, `turn_start`, then the request); the next request ends with the custom message as a `user` message. The entry is committed with `entry_appended` (the transcript tap emits it) and gets **no** `message_start`/`message_end`. Handlers after it see the draft in `event.entries` and `event.continue === true` (runner `emitBoundary` passes the accumulated entries). Several custom drafts in one result all reach the next request.
- **(b) Idle start, and the prompt race.** `pi.sendMessage(custom, { triggerTurn: true })` from a timer on an idle session starts a run; the custom message gets `message_end` and is persisted then. While `session.prompt()` waits in a `before_agent_start` handler, `isIdle` is `true`; a notification sent then starts a run, the prompt rejects with `Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.`, the user's text never reaches the model, and `agent_settled` fires twice. Hence the `AgentRuntimeSession.prompt`/`compact` hold (Task 3; its test fails without the hold).
- **(c) `nextTurn`.** `deliverAs: 'nextTurn'` messages are injected right after the user's message of the next `session.prompt()` (order: user, nextTurn messages, `before_agent_start` messages) and persisted; but a command whose handler starts a run with `sendMessage(…, { triggerTurn: true })` (like `/goal resume`) does not carry them: they stay in Pi's queue for the next typed prompt, unseen by the package. A `before_agent_start` result `{ message }` lands in the same place and only when a prompt really runs. See Spec amendment 2.
- **(d) Steering a running child.** A `triggerTurn: true` custom message sent while a tool runs is steered: the next request is `[..., tool result, user message]`, with `message_end` for it. A custom entry returned from the child's `agent_before_settle` with `continue: true` continues it. A steer sent inside `agent_before_settle` makes Pi continue (`hasQueuedMessages`). A steer sent a few microtasks after the boundary decided to settle (3 hops in the probe) is left unread in Pi's queue: no request, `hasQueuedMessages()` true on an idle session. Back-to-back `session.sendCustomMessage(m1/m2, { triggerTurn: true })`: `isStreaming` is `true` right after the first call, so m2 is steered and the first request carries both. See Spec amendment 1.
- **(e) `appendEntry` at start and shutdown.** `pi.appendEntry` in `session_start` works and the tap emits it while the session is created. In `session_shutdown` during `AgentRuntimeSession.dispose()` it also works and is emitted (listeners are still attached); after `dispose()` every `pi.*` call throws `This extension ctx is stale…`. The spec's choice to write nothing at shutdown stands (the registry ignores runs that end while closing).
- **(f) A tool call without a result.** Rebuilt from `[user, assistant(toolUse, call c1)]`, Pi sends c1 an `error-text` result `No result provided`. With a tool entry for c1 appended, rebuild accepts it and the model sees that text instead. If the assistant entry is `aborted` (or `error`), Pi drops it but keeps the appended result: an orphan result in the request. So only calls of the last replayed reply are answered (Task 6 `answerInterrupted`).
- **(g) `session.abort()` during a tool.** `agent_before_settle` does not run; `agent_settled { aborted: true }` does; the tool's own result is recorded, followed by an assistant entry with `stopReason: 'error'` and no content. A request the host aborts through its own signal settles through `agent_before_settle` with `outcome: 'aborted'` and `agent_settled { aborted: false }` (L5 note in `goalExtension.ts`), so the delivery suppression starts on either (see Spec amendment 6).
- **(h) Compaction.** In `session_compact` during a manual `compact()`, `ctx.isIdle()` is `false`; `sendMessage(…, { triggerTurn: false })` appends right after the compaction entry and the next request carries it after the kept messages. `compact()` starts with `abort()`. The extension sees no event after the manual compaction state clears, so delivery is re-checked when `AgentRuntimeSession.compact` returns.
- **(u) Queued user messages at settle.** A follow-up queued while a run ends (`agent_end`) is consumed before `agent_before_settle` (AS `_handlePostAgentRun` continues for queued messages), so the first settle handler practically never sees a pending `user` message. The spec's user-first rule (§7.3 step 1) is still applied; the observable ordering is tested with a follow-up queued mid-turn.
- **Tool approvals.** `tool_execution_start` is emitted before the `tool_call` hooks run (pi-agent-core `executeToolCalls…`), so an approval's `pending` event names a call already in flight; parallel calls are prepared one at a time.
- **Event bus.** `pi.events` is one bus per session (`DefaultResourceLoader` creates it); `session_start` handlers run in extension order, and `createAgentRuntimeSession` loads the subagent extension before the host's `extensionFactories` (the goal), so the goal's factory-time `pi.events.on` hears the link the subagent extension emits at its `session_start`.

## File Structure

| File | Responsibility |
|---|---|
| `src/subagent.ts` | Public types (`SubagentPort`, `Subagent`, `SubagentSessionOptions`, `SubagentDetails`, `SubagentOutcome`, `SubagentStopper`, `SubagentModelCandidate`), `isSubagentSession`, the three tools, the internal goal link, and `createSubagentExtension` wiring the registry and delivery to Pi events. |
| `src/subagentRun.ts` (new) | One run: `forkTranscript`, `originEntry`, `readOrigin`, `answerInterrupted`, `pickModel`, `openChild` (hand the host its new entries, build the session), `SubagentInbox`, `runSubagent` (replies, usage, 200-request cap, outcome, inbox segments). |
| `src/subagentRegistry.ts` (new) | The parent's subagents: records, live runs, cap reservations, foreground and background runs, moving to the background, stops, approvals, continuation lock, `cherry.subagent-state` snapshots, `subagents` views, `restoreSubagents`. |
| `src/subagentDelivery.ts` (new) | Notification text and details, long results, the queue, settle merge, idle runs under the host's hold, abort suppression, `before_agent_start` hand-over, the post-compaction status message. |
| `src/session.ts` | Wires the extension, passes parent model/offload/`onEvent`, adds `prompt`, `compact`, `stopSubagent`, `backgroundSubagent` to `AgentRuntimeSession`, and the `model` override for children. |
| `src/transcriptTap.ts` | `AgentRuntimeEvent` gains `subagents`. |
| `src/offload.ts` | `offloadText` extracted for notifications. |
| `src/ports.ts` | `ToolApprovalEvent` (was `GoalApprovalEvent`). |
| `src/goalExtension.ts`, `src/goalState.ts` | Spec §11: waiting, yielding to a notification, notification turns, budget and usage, own-call approvals; `turnStarter`. |
| `src/index.ts`, `README.md` | Exports and docs. |
| `tests/subagentSupport.ts` | `routedModel` with async routes, `lastText`/`humanText`, `gate`, `waitFor`, `storingSubagentPort`, `subagentStates`, `subagentViews`. |
| `tests/subagent{Background,Delivery,Message,Stop,Continue,Rebuild,Approval,Move,Model}.test.ts`, `tests/goalSubagents.test.ts` (new) | One file per task's behaviour. |

Each task below lists the exact code. "Apply" blocks are unified diffs against the state the previous task leaves, in order (`patch -p1` from the repository root applies them); "Create" and "Replace the whole of" blocks give whole files. Replaying every block of this plan in order onto the branch reproduces the validated code byte for byte (checked). The code was implemented and run task by task: at each task `pnpm test:agent-runtime`, typecheck, oxlint and eslint were green. The Review Focus tests (Tasks 2, 3, 6) and the two §15 additions (Task 5's `stop_subagent` fork refusal, Task 6's single origin entry) were written after Task 12 and run against the final code (282 tests); they rely only on code their task adds, but run them at their task as Step 4 says.

### Task 1: Shared runner, random ids and the whole child transcript for the host

Spec: §4.1, §4.3 (origin entry), §5.1 (foreground trailer), §6.1, §6.2, §8.1, D7

**Files:**
- Create: `packages/agent-runtime-pi/src/subagentRun.ts`
- Modify: `packages/agent-runtime-pi/src/subagent.ts` (whole file), `packages/agent-runtime-pi/src/session.ts`
- Test: `packages/agent-runtime-pi/tests/subagent.test.ts`, `packages/agent-runtime-pi/tests/subagentFork.test.ts`, `packages/agent-runtime-pi/tests/subagentStops.test.ts`

**Interfaces:**
- Consumes: L4/L5 code as it is on the branch (`createAgentRuntimeSession`, `TranscriptEntry`, `AgentRuntimeEvent`).
- Produces (`subagentRun.ts`): `MAX_SUBAGENT_REQUESTS = 200`; `SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'`; `type RunEnd = 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'`; `interface RunResult { end: RunEnd; report?: string; reason?: string; partial?: string; usage: Usage }`; `interface SubagentOrigin { parentToolCallId: string; fork: boolean; description: string; modelKey: string }`; `interface SubagentSessionOverrides { sessionId; transcript; extensionFactories; onEvent; fork }`; `type CreateSubagentSession = (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>`; `forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[]`; `originEntry(origin: SubagentOrigin): TranscriptStateEntry`; `openChild(input: { subagent: Subagent; options: SubagentSessionOptions; prefix: TranscriptEntry[]; parentModelKey: string; createSession: CreateSubagentSession }): Promise<AgentRuntimeSession>`; `addUsage(sum: Usage, usage: Usage): Usage`; `runSubagent(child: AgentRuntimeSession, task: string, signal: AbortSignal): Promise<RunResult>`.
- Produces (`subagent.ts`): `interface Subagent { parentToolCallId: string; sessionId: string; description: string; fork: boolean; background: boolean }`; `type SubagentOutcome = RunEnd | 'stopped' | 'interrupted'`; `type SubagentDetails = { sessionId: string; fork: boolean; background: false; outcome: SubagentOutcome } | { sessionId: string; fork: boolean; background: true }`; `SubagentToolOptions` gains `parentModelKey: string`; `subagentExtension(options: SubagentToolOptions): ExtensionFactory` keeps its name for now.

- [ ] **Step 1: Write the failing tests**

Edit the three L4 test files for the new contract (UUID ids, `background: false`, the id trailer, the origin entry first) and add the fork hand-over test.

Apply to `packages/agent-runtime-pi/tests/subagent.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagent.test.ts
+++ b/packages/agent-runtime-pi/tests/subagent.test.ts
@@ -13,7 +13,7 @@
   toolResultOf,
   toolResults
 } from './subagentSupport'
-import { createTestSession, finish, hostStore, scriptedModel, streamTextPort, textParts } from './support'
+import { createTestSession, finish, hostStore, MODEL, scriptedModel, streamTextPort, textParts } from './support'
 
 const DELEGATE_A = 'Delegate the check of module A'
 const TASK_A = { description: 'Check module A', prompt: 'TASK-A: inspect module A' }
@@ -48,11 +48,14 @@
     expect(first.options.prompt.map((message) => message.role)).toEqual(['system', 'user'])
     expect(first.userText).not.toContain(DELEGATE_A)
     expect(first.options.tools?.map((tool) => tool.name)).not.toContain('subagent')
-    expect(toolResults(calls.at(-1)!).map((part) => outputText(part.output))).toEqual(['REPORT-A'])
+    const { sessionId } = host.subagents[0]
+    expect(toolResults(calls.at(-1)!).map((part) => outputText(part.output))).toEqual([
+      `REPORT-A\n\n(id: ${sessionId} — continue this subagent with message_subagent.)`
+    ])
 
     const result = toolResultOf(session, 'call_a')
     expect(result.isError).toBe(false)
-    expect(result.details).toEqual({ sessionId: host.subagents[0].sessionId, fork: false, outcome: 'completed' })
+    expect(result.details).toEqual({ sessionId, fork: false, background: false, outcome: 'completed' })
     // Two replies: 100 + 20 + 2 cached and 200 + 40 + 2 cached tokens.
     expect(result.usage?.totalTokens).toBe(364)
     expect(result.usage?.cost.total).toBeCloseTo(0.0004204, 10)
@@ -67,7 +70,9 @@
     expect(calls[0].tools?.map((tool) => tool.name) ?? []).not.toContain('subagent')
   })
 
-  it('sends subagent entries only to its own listener; the parent transcript gains only the call and its result', async () => {
+  // Breaks when the origin entry is not handed to the host (a stored subagent transcript could not
+  // rebuild a subagent's session) or when any entry reaches the host twice.
+  it('sends subagent entries only to its own listener, starting with the origin entry', async () => {
     const { model } = delegateOnce()
     const host = recordingSubagentPort()
     const parent = hostStore()
@@ -86,7 +91,13 @@
     expect(JSON.stringify(parent.entries)).not.toContain('noted')
     const childEvents = host.events.get(host.subagents[0].sessionId)!
     const childEntries = childEvents.flatMap((event) => (event.type === 'transcript-append' ? event.entries : []))
-    expect(roles(childEntries)).toEqual(['user', 'assistant', 'tool', 'assistant'])
+    expect(roles(childEntries)).toEqual(['state', 'user', 'assistant', 'tool', 'assistant'])
+    expect(childEntries[0]).toMatchObject({
+      kind: 'state',
+      type: 'cherry.subagent-origin',
+      data: { parentToolCallId: 'call_a', fork: false, description: 'Check module A', modelKey: MODEL.key }
+    })
+    expect(new Set(childEntries.map((entry) => entry.id)).size).toBe(childEntries.length)
     expect(childEvents.at(-1)).toMatchObject({ type: 'turn-complete', aborted: false })
   })
 
@@ -231,8 +242,9 @@
     expect(outputText(result.output)).toMatch(/non-empty description and prompt/)
   })
 
-  // Breaks when two subagents of one parent can share a session id, or the host and the result disagree on it.
-  it('gives every subagent its own session id, even when provider call ids collide', async () => {
+  // Breaks when two subagents of one parent can share a session id, the host and the result disagree
+  // on it, or it is derived from the parent's id (Cherry's Pi session ids change between rebuilds).
+  it('gives every subagent its own random UUID, even when provider call ids collide', async () => {
     const check = (id: string) => subagentCall(id, { description: 'Check', prompt: `TASK ${id}` })
     const { model } = routedModel(({ userText, lastRole, options }) => {
       if (!options.tools?.some((tool) => tool.name === 'subagent')) return [...textParts('r', 'REPORT'), finish('stop')]
@@ -252,7 +264,7 @@
     const ids = host.subagents.map((subagent) => subagent.sessionId)
     expect(ids).toHaveLength(5)
     expect(new Set(ids).size).toBe(5)
-    for (const id of ids) expect(id.startsWith(`${session.sessionId}.`)).toBe(true)
+    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
     expect(new Set(requests.map((request) => request.sessionId).filter((id) => id !== session.sessionId))).toEqual(
       new Set(ids)
     )
@@ -264,7 +276,7 @@
     )
     const configured = host.subagents.map((subagent) => ({
       toolCallId: subagent.parentToolCallId,
-      details: { sessionId: subagent.sessionId, fork: false, outcome: 'completed' }
+      details: { sessionId: subagent.sessionId, fork: false, background: false, outcome: 'completed' }
     }))
     expect(results).toHaveLength(5)
     expect(results).toEqual(expect.arrayContaining(configured))
@@ -307,7 +319,7 @@
       { type: 'compaction-end', reason: 'threshold', entryId: expect.any(String) }
     ])
     const result = toolResultOf(session, 'call_a')
-    expect(result.content).toEqual([{ type: 'text', text: 'REPORT-A' }])
+    expect(result.content).toEqual([{ type: 'text', text: expect.stringMatching(/^REPORT-A\n\n\(id: /) }])
     expect(result.usage?.totalTokens).toBe(112 + 20_022 + 112)
     expect(summarizedSessions).toEqual([host.subagents[0].sessionId])
     expect(summarizedSessions[0]).not.toBe(session.sessionId)
````

Apply to `packages/agent-runtime-pi/tests/subagentFork.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentFork.test.ts
+++ b/packages/agent-runtime-pi/tests/subagentFork.test.ts
@@ -12,7 +12,7 @@
   toolResultOf,
   toolResults
 } from './subagentSupport'
-import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
+import { createTestSession, finish, hostStore, plain, streamTextPort, textParts } from './support'
 
 const forkA = { description: 'Check A', prompt: 'TASK-A', fork: true }
 const forkB = { description: 'Check B', prompt: 'TASK-B', fork: true }
@@ -150,6 +150,32 @@
     expect(outputText(nested.output)).toMatch(/cannot start subagents/)
   })
 
+  // Breaks when the fork prefix is not handed to the host: the stored transcript would start at the
+  // origin entry and a rebuilt fork would lose the conversation it was forked from.
+  it("hands the host a fork's whole transcript, so the stored copy rebuilds it with the forked prefix", async () => {
+    const { model, calls } = routedModel(({ userText, lastRole }) => {
+      if (userText.includes('TASK-A')) return [...textParts('r', 'REPORT-A'), finish('stop')]
+      return lastRole === 'user'
+        ? [subagentCall('call_a', forkA), finish('tool-calls')]
+        : [...textParts('d', 'Done'), finish('stop')]
+    })
+    const host = recordingSubagentPort()
+    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
+    await session.prompt('Check module A with the codename ORCHID')
+
+    const stored = host.events
+      .get(host.subagents[0].sessionId)!
+      .flatMap((event) => (event.type === 'transcript-append' ? event.entries : []))
+    const rebuilt = await createTestSession({ port: streamTextPort(model).port, transcript: plain(stored) })
+    await rebuilt.session.prompt('FOLLOW-UP')
+
+    const request = calls.at(-1)!
+    expect(request.userText).toContain('ORCHID')
+    expect(request.userText).toContain('TASK-A')
+    expect(toolResults(request).map((part) => part.toolCallId)).toEqual(['call_a'])
+    expect(outputText(toolResults(request)[0].output)).toMatch(/still running/)
+  })
+
   it('forks a session rebuilt from the host transcript with the replayed history', async () => {
     const earlier = routedModel(() => [...textParts('a', 'Noted.'), finish('stop')])
     const host = hostStore()
````

Apply to `packages/agent-runtime-pi/tests/subagentStops.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentStops.test.ts
+++ b/packages/agent-runtime-pi/tests/subagentStops.test.ts
@@ -89,7 +89,7 @@
 
     const [a, b] = toolResults(calls.at(-1)!)
     expect(a.output.type).toBe('error-text')
-    expect(outputText(b.output)).toBe('REPORT-B')
+    expect(outputText(b.output)).toMatch(/^REPORT-B\n\n\(id: /)
   })
 
   it('stops the subagent and shuts it down when the parent turn aborts', async () => {
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts`

Expected: FAIL. The new and changed tests fail: the foreground result has no `(id: … — continue this subagent with message_subagent.)` trailer and its `details` lack `background: false`; the child's first emitted entry is the user prompt, not the `cherry.subagent-origin` state entry; ids match `<parent session id>.<uuid>` instead of a bare UUID; the stored fork transcript lacks the forked prefix, so the rebuilt fork's request has no `ORCHID`.

- [ ] **Step 3: Implement**

`subagentRun.ts` takes L4's `run()`, `forkTranscript`, `originEntry` and usage sum out of `subagent.ts`; `openChild` hands the start entries to the host's `onEvent` before building the session (Spec amendment 4); the foreground call links the parent's signal to a controller of its own, which Task 9 needs.

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -146,7 +146,8 @@
             // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
             createSession: ({ fork, ...overrides }) =>
               createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
-            parentTranscript: () => tap.entries()
+            parentTranscript: () => tap.entries(),
+            parentModelKey: key
           })
         ]
       : []),
````

Replace the whole of `packages/agent-runtime-pi/src/subagent.ts` with:

````ts
import { randomUUID } from 'node:crypto'

import { Type } from '@earendil-works/pi-ai'
import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'

import {
  type CreateSubagentSession,
  forkTranscript,
  MAX_SUBAGENT_REQUESTS,
  openChild,
  type RunEnd,
  type RunResult,
  runSubagent,
  SUBAGENT_ORIGIN_STATE
} from './subagentRun'
import type { TranscriptEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

export { SUBAGENT_ORIGIN_STATE } from './subagentRun'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'

/** True inside a subagent's session. */
export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom' && entry.customType === SUBAGENT_ORIGIN_STATE)
}

/** Host side of `subagent`: gives each subagent its extensions and listeners. */
export interface SubagentPort {
  /**
   * Called once per subagent, before its session is built. A throw fails the call. For a fork,
   * `extensionFactories` must yield the parent's tools: the same tools, in the same order.
   */
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
}

/** The subagent about to be created. */
export interface Subagent {
  /** The `subagent` call that creates it. */
  parentToolCallId: string
  /** Its Pi session id, its requests' `sessionId` and the id the model sees: a random UUID. */
  sessionId: string
  description: string
  fork: boolean
  /** Whether this run is in the background. */
  background: boolean
}

/** The session options the host gives each subagent; everything else comes from the parent. */
export interface SubagentSessionOptions {
  extensionFactories?: ExtensionFactory[]
  /**
   * The subagent's own transcript events, shaped like the parent's `onEvent`; they never reach the
   * parent's. The first `transcript-append` holds its start entries (fork prefix and origin entry).
   */
  onEvent?: (event: AgentRuntimeEvent) => void
  /** Called before the subagent's first model request; subscribe to its live output here. */
  onSessionCreated?: (session: AgentSession) => void
}

/** How a subagent's run ended. */
export type SubagentOutcome = RunEnd | 'stopped' | 'interrupted'

/**
 * `details` of every result the tool returns once the subagent's session is built, and of a call
 * aborted before then. Calls that throw carry none, `onSessionCreated` throwing included.
 */
export type SubagentDetails =
  | { sessionId: string; fork: boolean; background: false; outcome: SubagentOutcome }
  | { sessionId: string; fork: boolean; background: true }

/** What the session that registers `subagent` lends it. */
export interface SubagentToolOptions {
  port: SubagentPort
  /** Builds a session from the parent's options with these overrides. */
  createSession: CreateSubagentSession
  /** The parent's transcript so far, including the running turn. */
  parentTranscript: () => readonly TranscriptEntry[]
  /** Key of the parent's model, recorded as the model a subagent runs on. */
  parentModelKey: string
}

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.'
].join('\n')

const PREAMBLE =
  'You are a subagent working for another agent, not for the user. Do the task below with your tools, then finish with one final message that reports the result in full — the other agent sees only that final message. You cannot ask the user questions and you cannot start subagents.'

const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'

const STOPPED: Record<Exclude<RunEnd, 'completed'>, string> = {
  failed: 'The subagent failed',
  truncated: 'The subagent hit its output limit before finishing',
  aborted: 'The subagent was stopped because the turn was aborted',
  limit_reached: `The subagent was stopped after ${MAX_SUBAGENT_REQUESTS} model requests`
}

const text = (value: string) => ({ type: 'text' as const, text: value })
const taskText = (prompt: string) => `${PREAMBLE}\n\nTask:\n${prompt}`
const idTrailer = (sessionId: string) => `(id: ${sessionId} — continue this subagent with message_subagent.)`

/** The L4 result text: the final message, or why the run stopped and its last partial output. */
function runText(result: RunResult): string {
  if (result.end === 'completed') return result.report || NO_FINAL_MESSAGE
  const lines = [result.reason ? `${STOPPED[result.end]}: ${result.reason}` : `${STOPPED[result.end]}.`]
  if (result.partial) lines.push(`Partial output before it stopped:\n${result.partial}`)
  return lines.join('\n')
}

const notStarted = (sessionId: string, fork: boolean): AgentToolResult<SubagentDetails> => ({
  content: [text('The subagent was not started because the turn was aborted.')],
  details: { sessionId, fork, background: false, outcome: 'aborted' },
  isError: true
})

const parameters = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
  prompt: Type.String({ description: 'The task for the subagent.' }),
  fork: Type.Optional(
    Type.Boolean({
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    })
  )
})

/** The `subagent` tool: each call runs a subagent session in-process and returns its final report. */
export function subagentExtension({
  port,
  createSession,
  parentTranscript,
  parentModelKey
}: SubagentToolOptions): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error('Subagents cannot start subagents.')
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: randomUUID(),
          description,
          fork,
          background: false
        }
        // Built before `configure`, so a failure building the fork transcript never reaches the host.
        const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
        const options = await port.configure(subagent)
        if (signal?.aborted) return notStarted(subagent.sessionId, fork)
        const child = await openChild({ subagent, options, prefix, parentModelKey, createSession })
        try {
          const run = new AbortController()
          const onAbort = () => run.abort()
          if (signal?.aborted) run.abort()
          else signal?.addEventListener('abort', onAbort, { once: true })
          const result = await runSubagent(child, taskText(prompt), run.signal).finally(() =>
            signal?.removeEventListener('abort', onAbort)
          )
          const details: SubagentDetails = {
            sessionId: subagent.sessionId,
            fork,
            background: false,
            outcome: result.end
          }
          return {
            content: [text(`${runText(result)}\n\n${idTrailer(subagent.sessionId)}`)],
            details,
            usage: result.usage,
            ...(result.end === 'completed' ? {} : { isError: true })
          }
        } finally {
          await child.dispose()
        }
      }
    })
  }
}
````

Create `packages/agent-runtime-pi/src/subagentRun.ts`:

````ts
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ToolCallPart } from 'ai'

import type { AgentRuntimeSession } from './session'
import type { Subagent, SubagentSessionOptions } from './subagent'
import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

/** Model requests one run may make before it is stopped (Claude Code's limit for a fork). */
export const MAX_SUBAGENT_REQUESTS = 200

/** State entry naming the call that created a session; it marks a subagent's session. */
export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'

/** How one run of a subagent session ended, as the session itself saw it. */
export type RunEnd = 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'

export interface RunResult {
  end: RunEnd
  /** The final message, trimmed; set when the run completed. */
  report?: string
  /** The error that ended the run. */
  reason?: string
  /** The last non-empty reply of a run that did not complete. */
  partial?: string
  /** The sum of the run's replies. */
  usage: Usage
}

/** Data of the origin entry; a continuation replays it. */
export interface SubagentOrigin {
  parentToolCallId: string
  fork: boolean
  description: string
  /** The model the subagent actually runs on. */
  modelKey: string
}

/** What a subagent's session overrides in the parent's options. */
export interface SubagentSessionOverrides {
  sessionId: string
  transcript: TranscriptEntry[]
  extensionFactories: NonNullable<SubagentSessionOptions['extensionFactories']>
  onEvent: ((event: AgentRuntimeEvent) => void) | undefined
  /** A fork keeps `subagent` registered so its tools match the parent's. */
  fork: boolean
}

export type CreateSubagentSession = (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>

const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'

const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function toolCallsOf(entry: TranscriptEntry): ToolCallPart[] {
  if (entry.kind !== 'message' || entry.message.role !== 'assistant' || typeof entry.message.content === 'string')
    return []
  return entry.message.content.filter((part): part is ToolCallPart => part.type === 'tool-call')
}

/**
 * The parent's transcript up to the assistant message holding `toolCallId`, every call of that
 * message answered by the same placeholder, so sibling forks send the same prefix.
 */
export function forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[] {
  // Last: some providers reuse call ids across turns, and the running call is in the latest message.
  const index = entries.findLastIndex((entry) => toolCallsOf(entry).some((call) => call.toolCallId === toolCallId))
  if (index < 0) throw new Error(`No assistant message holds the call ${toolCallId}.`)
  const assistant = entries[index]
  const placeholders = toolCallsOf(assistant).map(
    (call, i): TranscriptMessageEntry => ({
      id: `${assistant.id}-fork-${i}`,
      timestamp: assistant.timestamp,
      kind: 'message',
      message: {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: 'text', value: PLACEHOLDER }
          }
        ]
      }
    })
  )
  return [...entries.slice(0, index + 1), ...placeholders]
}

export const originEntry = (origin: SubagentOrigin): TranscriptStateEntry => ({
  id: `subagent-origin-${origin.parentToolCallId}`,
  timestamp: Date.now(),
  kind: 'state',
  type: SUBAGENT_ORIGIN_STATE,
  data: { ...origin }
})

/**
 * Configures and builds the session of a new subagent. Its start entries (the fork prefix and the
 * origin entry) go to the host's `onEvent` first, so the host stores the whole transcript.
 */
export async function openChild(input: {
  subagent: Subagent
  options: SubagentSessionOptions
  prefix: TranscriptEntry[]
  parentModelKey: string
  createSession: CreateSubagentSession
}): Promise<AgentRuntimeSession> {
  const { subagent, options, prefix } = input
  const transcript = [
    ...prefix,
    originEntry({
      parentToolCallId: subagent.parentToolCallId,
      fork: subagent.fork,
      description: subagent.description,
      modelKey: input.parentModelKey
    })
  ]
  options.onEvent?.({ type: 'transcript-append', entries: plainJson(transcript) })
  const child = await input.createSession({
    sessionId: subagent.sessionId,
    transcript,
    fork: subagent.fork,
    extensionFactories: options.extensionFactories ?? [],
    onEvent: options.onEvent
  })
  try {
    options.onSessionCreated?.(child.session)
  } catch (error) {
    await child.dispose()
    throw error
  }
  return child
}

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
})

export function addUsage(sum: Usage, usage: Usage): Usage {
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    ...(sum.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (sum.reasoning ?? 0) + (usage.reasoning ?? 0) }),
    totalTokens: sum.totalTokens + usage.totalTokens,
    cost: {
      input: sum.cost.input + usage.cost.input,
      output: sum.cost.output + usage.cost.output,
      cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
      cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
      total: sum.cost.total + usage.cost.total
    }
  }
}

function endOf(last: AssistantMessage | undefined, stopped: 'aborted' | 'limit_reached' | undefined): RunEnd {
  if (stopped) return stopped
  switch (last?.stopReason) {
    case 'stop':
      return 'completed'
    case 'length':
      return 'truncated'
    case 'aborted':
      return 'aborted'
    default:
      return 'failed'
  }
}

const textOf = (message: AssistantMessage) =>
  message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * Runs `task` on the subagent's session until it settles. `signal` stops the run; the result carries
 * the final message (or the reason and last partial output) and the sum of the run's usage.
 */
export async function runSubagent(child: AgentRuntimeSession, task: string, signal: AbortSignal): Promise<RunResult> {
  const { session } = child
  let stopped: 'aborted' | 'limit_reached' | undefined
  const stop = (reason: 'aborted' | 'limit_reached') => {
    stopped ??= reason
    void session.abort()
  }
  // Not read from `session.messages`: Pi swaps it for the compacted context, dropping folded replies.
  const replies: AssistantMessage[] = []
  let requests = 0
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') replies.push(event.message)
    if (event.type === 'turn_end') requests++
    // Checked as the next turn starts: tool results, follow-ups and continuations all lead to another request.
    if (event.type === 'turn_start' && requests >= MAX_SUBAGENT_REQUESTS) stop('limit_reached')
    // An abort before the run starts is a no-op in Pi, and the run clears it; repeat it once the run is live.
    if (event.type === 'agent_start' && stopped) void session.abort()
  })
  const onAbort = () => stop('aborted')
  signal.addEventListener('abort', onAbort, { once: true })
  let error: string | undefined
  try {
    if (signal.aborted) stop('aborted')
    else await session.prompt(task, { expandPromptTemplates: false, source: 'extension' })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    unsubscribe()
    signal.removeEventListener('abort', onAbort)
  }

  const usage = replies.reduce((sum, reply) => addUsage(sum, reply.usage), zeroUsage())
  const last = replies.at(-1)
  const end = error === undefined ? endOf(last, stopped) : (stopped ?? 'failed')
  if (end === 'completed') return { end, report: textOf(last!).trim(), usage }
  const reason = error ?? (end === 'failed' ? last?.errorMessage : undefined)
  const partial = replies
    .map(textOf)
    .filter((part) => part.trim())
    .at(-1)
  return { end, usage, ...(reason ? { reason } : {}), ...(partial ? { partial } : {}) }
}
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): give subagents random ids and hand their whole transcript to the host"
```

### Task 2: Background launch, the registry, state snapshots, the cap and shutdown

Spec: §4.2, §4.3 (state snapshots), §4.4 (`subagents` event, `maxBackground`), §5.1 (background), §6.3, §9 (shutdown), D2, D8

**Files:**
- Create: `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/tests/subagentBackground.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/session.ts`, `packages/agent-runtime-pi/src/transcriptTap.ts`, `packages/agent-runtime-pi/src/index.ts`, `packages/agent-runtime-pi/tests/subagentSupport.ts`

**Interfaces:**
- Consumes (Task 1): `runSubagent`, `openChild`, `forkTranscript`, `RunResult`, `Subagent`, `SubagentDetails`.
- Produces (`subagentRegistry.ts`): `SUBAGENT_STATE_TYPE = 'cherry.subagent-state'`; `DEFAULT_MAX_BACKGROUND = 20`; `type SubagentStatus = 'running' | 'awaiting_approval' | 'finished'`; `interface SubagentRecord { sessionId; parentToolCallId; description; fork; background; modelKey; run: number; status: SubagentStatus; outcome?: SubagentOutcome }`; `interface SubagentState { sessionId; parentToolCallId; description; fork; background; modelKey; run; status: 'running' | 'finished'; outcome?; report?; reason?; partial?; usage?: Usage }`; `interface SubagentView { sessionId; parentToolCallId; description; status: SubagentStatus; outcome? }`; `interface RegistryHost { appendState(state: SubagentState): void; emit(event: AgentRuntimeEvent): void; maxBackground: number }`; `class SubagentRegistry { get(sessionId): SubagentRecord | undefined; runningBackground(): number; reserveBackground(): () => void; views(): SubagentView[]; startBackground(record: SubagentRecord, child: AgentRuntimeSession, task: string): void; close(): Promise<void> }`.
- Produces elsewhere: `SubagentPort.maxBackground?: number`; `SubagentToolOptions.emit: (event: AgentRuntimeEvent) => void`; `AgentRuntimeEvent` gains `{ type: 'subagents'; subagents: SubagentView[] }`; `index.ts` exports `SubagentOutcome`, `SUBAGENT_STATE_TYPE`, `SubagentState`, `SubagentStatus`, `SubagentView`.
- Test helpers (`subagentSupport.ts`): `routedModel(route)` accepts async routes; `RoutedCall.lastText`; `gate(): { open(); reached: Promise<void>; wait<T>(value: T): Promise<T> }`; `waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void>`; `subagentCall(id, { description, prompt, fork?, background? })`; `subagentStates(entries): SubagentState[]`; `subagentViews(events): SubagentView[][]`.

- [ ] **Step 1: Write the failing tests**

Add the async routes, gates and readers to `subagentSupport.ts`, and the background tests, including Review Focus 1 (a failed launch frees its slot) and 3 (a background fork).

Create `packages/agent-runtime-pi/tests/subagentBackground.test.ts`:

````ts
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort } from '../src'
import {
  gate,
  outputText,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  subagentStates,
  subagentViews,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }

describe('background subagents', () => {
  // Breaks when a background launch still blocks until the subagent ends, when the parent's turn
  // ending stops it, or when its runs leave no snapshots or events for the host.
  it('returns its id at once, keeps running after the turn ends, and records its run', async () => {
    const held = gate()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop', 100, 20)])
      return lastText === 'Check A in the background'
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A in the background')
    await held.reached

    const { sessionId } = host.subagents[0]
    expect(host.subagents[0].background).toBe(true)
    const result = toolResultOf(session, 'call_a')
    expect(result.details).toEqual({ sessionId, fork: false, background: true })
    expect(textOf(result)).toBe(
      `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
    )
    expect(parent.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)

    held.open()
    await waitFor(() => subagentStates(parent.entries).length === 2)
    const view = { sessionId, parentToolCallId: 'call_a', description: 'Check A' }
    expect(subagentStates(parent.entries)).toEqual([
      { ...view, fork: false, background: true, modelKey: 'cherry::bridged-model', run: 1, status: 'running' },
      expect.objectContaining({
        ...view,
        run: 1,
        status: 'finished',
        outcome: 'completed',
        report: 'REPORT-A',
        usage: expect.objectContaining({ totalTokens: 122 })
      })
    ])
    expect(subagentViews(parent.events)).toEqual([
      [{ ...view, status: 'running' }],
      [{ ...view, status: 'finished', outcome: 'completed' }]
    ])
  })

  // Breaks when the launching call's signal still reaches the subagent (D2: stopping a turn is not
  // stopping its background subagents).
  it('keeps running when the turn that launched it is aborted', async () => {
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const abortTurn = defineTool({
      name: 'abort_turn',
      label: 'Abort turn',
      description: 'Aborts the turn',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        await held.reached
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'aborted' }], details: undefined }
      }
    })
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Check A, then stop'
        ? [subagentCall('call_a', BG_A), toolCallPart('abort_1', 'abort_turn'), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [abortTurn],
      subagents: recordingSubagentPort().port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session

    await runtime.session.prompt('Check A, then stop')
    expect(store.events.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
    held.open()

    await waitFor(() => subagentStates(store.entries).some((state) => state.status === 'finished'))
    expect(subagentStates(store.entries).at(-1)).toMatchObject({ outcome: 'completed', report: 'REPORT-A' })
  })

  // Breaks when the cap is missing or counts foreground subagents, or when calls of one step all pass
  // the check before any of them has started.
  it('runs at most 20 background subagents at once, while foreground subagents still run', async () => {
    const held = gate()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-BG')) return held.wait([...textParts('r', 'BG'), finish('stop')])
      if (userText.includes('TASK-FG')) return [...textParts('r', 'REPORT-FG'), finish('stop')]
      if (lastText === 'Now one in the foreground')
        return [subagentCall('call_fg', { description: 'FG', prompt: 'TASK-FG' }), finish('tool-calls')]
      if (lastText !== 'Start 21 in the background') return [...textParts('d', 'Done'), finish('stop')]
      return [
        ...Array.from({ length: 21 }, (_, i) =>
          subagentCall(`call_${i}`, { description: `BG ${i}`, prompt: `TASK-BG ${i}`, background: true })
        ),
        finish('tool-calls')
      ]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Start 21 in the background')
    const results = Array.from({ length: 21 }, (_, i) => toolResultOf(session, `call_${i}`))
    const refused = results.filter((result) => result.isError)
    expect(refused).toHaveLength(1)
    expect(textOf(refused[0])).toBe(
      '20 background subagents are already running; wait for one to finish before starting another.'
    )

    await session.prompt('Now one in the foreground')
    expect(textOf(toolResultOf(session, 'call_fg'))).toMatch(/^REPORT-FG/)
    held.open()
  })

  // Review focus 1. Breaks when a launch whose configure fails keeps its background slot: after
  // maxBackground failures no background subagent could start again.
  it('frees the background slot of a launch that fails', async () => {
    const held = gate()
    let failNext = true
    const recording = recordingSubagentPort()
    const port: SubagentPort = {
      maxBackground: 1,
      async configure(subagent) {
        if (failNext) {
          failNext = false
          throw new Error('no workspace for subagents')
        }
        return recording.port.configure(subagent)
      }
    }
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText.startsWith('Check A')
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Done'), finish('stop')]
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: port })

    await session.prompt('Check A in the background')
    expect(textOf(toolResultOf(session, 'call_a'))).toBe('no workspace for subagents')
    await session.prompt('Check A again')
    expect(textOf(toolResultOf(session, 'call_a'))).toMatch(/^Subagent started in the background/)
    held.open()
  })

  // Review focus 3. Breaks when a background fork is built unlike a foreground one: no forked
  // conversation or no placeholder result for its own call.
  it('starts a background fork from the conversation as it is', async () => {
    const held = gate()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Fork A in the background; the codename is ORCHID'
        ? [subagentCall('call_a', { ...BG_A, fork: true }), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })

    await session.prompt('Fork A in the background; the codename is ORCHID')
    await held.reached

    const fork = calls.find((call) => call.userText.includes('TASK-A'))!
    expect(fork.userText).toContain('ORCHID')
    expect(toolResults(fork).map((part) => [part.toolCallId, outputText(part.output)])).toEqual([
      ['call_a', 'This tool call was still running when the subagent started; its result is not available here.']
    ])
    held.open()
  })

  // Breaks when shutdown leaks a running subagent session, or writes a snapshot or event after the
  // parent is gone (a rebuild infers `interrupted` from the last `running` snapshot instead).
  it('stops and disposes its background subagents when the parent is disposed, writing nothing more', async () => {
    const held = gate()
    let shutdowns = 0
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait([...textParts('r', 'REPORT-A'), finish('stop')])
      return lastText === 'Check A in the background'
        ? [subagentCall('call_a', BG_A), finish('tool-calls')]
        : [...textParts('d', 'Launched.'), finish('stop')]
    })
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: store.onEvent
    })
    await runtime.session.prompt('Check A in the background')
    await held.reached
    const eventsBefore = store.events.length

    await runtime.dispose()

    expect(shutdowns).toBe(1)
    expect(calls.find((call) => call.userText.includes('TASK-A'))!.options.abortSignal?.aborted).toBe(true)
    expect(subagentStates(store.entries).map((state) => state.status)).toEqual(['running'])
    expect(store.events).toHaveLength(eventsBefore)
  })
})
````

Apply to `packages/agent-runtime-pi/tests/subagentSupport.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentSupport.ts
+++ b/packages/agent-runtime-pi/tests/subagentSupport.ts
@@ -4,13 +4,24 @@
 import { simulateReadableStream } from 'ai'
 import { MockLanguageModelV3 } from 'ai/test'
 
-import type { AgentRuntimeEvent, Subagent, SubagentPort, SubagentSessionOptions } from '../src'
+import {
+  type AgentRuntimeEvent,
+  type Subagent,
+  SUBAGENT_STATE_TYPE,
+  type SubagentPort,
+  type SubagentSessionOptions,
+  type SubagentState,
+  type SubagentView,
+  type TranscriptEntry
+} from '../src'
 
 export interface RoutedCall {
   /** Role of the last prompt message: `user` on a new request, `tool` after tool results. */
   lastRole: string
   /** Text of every user message in the prompt, joined. */
   userText: string
+  /** Text of the last prompt message when it is a user message (a prompt or a notification). */
+  lastText: string
   options: LanguageModelV3CallOptions
 }
 
@@ -19,22 +30,52 @@
 
 /**
  * A mock that answers each call with the script `route` picks for it, so a parent and its
- * subagents can share one model (and one port) the way they do in production.
+ * subagents can share one model (and one port) the way they do in production. A route may wait
+ * (on a {@link gate}) before it answers; an abort still ends the request.
  */
-export function routedModel(route: (call: RoutedCall) => LanguageModelV3StreamPart[]) {
+export function routedModel(
+  route: (call: RoutedCall) => LanguageModelV3StreamPart[] | Promise<LanguageModelV3StreamPart[]>
+) {
   const calls: RoutedCall[] = []
   const model = new MockLanguageModelV3({
     doStream: async (options) => {
+      const last = options.prompt.at(-1)
       const call: RoutedCall = {
-        lastRole: options.prompt.at(-1)?.role ?? '',
+        lastRole: last?.role ?? '',
         userText: options.prompt.map(userTextOf).join('\n'),
+        lastText: last ? userTextOf(last) : '',
         options
       }
       calls.push(call)
-      return { stream: simulateReadableStream({ chunks: route(call) }) }
+      return { stream: simulateReadableStream({ chunks: await route(call) }) }
     }
   })
   return { model, calls }
+}
+
+/** Holds the requests that `wait()` on it until `open()`; `reached` resolves once one waits. */
+export function gate() {
+  let open!: () => void
+  const opened = new Promise<void>((resolve) => (open = resolve))
+  let arrive!: () => void
+  const reached = new Promise<void>((resolve) => (arrive = resolve))
+  return {
+    open,
+    reached,
+    wait: <T>(value: T): Promise<T> => {
+      arrive()
+      return opened.then(() => value)
+    }
+  }
+}
+
+/** Resolves once `check()` holds, polling; fails after `timeoutMs`. */
+export async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
+  const deadline = Date.now() + timeoutMs
+  while (!check()) {
+    if (Date.now() > deadline) throw new Error('waitFor timed out')
+    await new Promise((resolve) => setTimeout(resolve, 5))
+  }
 }
 
 export const toolCallPart = (toolCallId: string, toolName: string, input: object = {}): LanguageModelV3StreamPart => ({
@@ -44,8 +85,10 @@
   input: JSON.stringify(input)
 })
 
-export const subagentCall = (toolCallId: string, input: { description: string; prompt: string; fork?: boolean }) =>
-  toolCallPart(toolCallId, 'subagent', input)
+export const subagentCall = (
+  toolCallId: string,
+  input: { description: string; prompt: string; fork?: boolean; background?: boolean }
+) => toolCallPart(toolCallId, 'subagent', input)
 
 /** A host port that records each subagent it configures and the events and session that subagent gets. */
 export function recordingSubagentPort(
@@ -104,3 +147,13 @@
     return { content: [{ type: 'text', text: 'noted' }], details: undefined }
   }
 })
+
+/** Every `cherry.subagent-state` snapshot in the parent's transcript, in order. */
+export const subagentStates = (entries: readonly TranscriptEntry[]): SubagentState[] =>
+  entries.flatMap((entry) =>
+    entry.kind === 'state' && entry.type === SUBAGENT_STATE_TYPE ? [entry.data as unknown as SubagentState] : []
+  )
+
+/** The lists the parent's `subagents` events carried, in order. */
+export const subagentViews = (events: readonly AgentRuntimeEvent[]): SubagentView[][] =>
+  events.flatMap((event) => (event.type === 'subagents' ? [event.subagents] : []))
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts`

Expected: FAIL. `subagentBackground.test.ts` fails (on an assertion or by timing out): `subagent` has no `background` parameter yet, so no call returns the started text, a call that runs in the foreground waits on the held subagent, and `SUBAGENT_STATE_TYPE` is undefined, so no `cherry.subagent-state` snapshot is found.

- [ ] **Step 3: Implement**

The registry owns background runs: it reserves a slot before `configure` (parallel calls of one step all pass the check otherwise), writes the `running` snapshot, runs the child on its own controller (never the call's signal) and on the end writes the `finished` snapshot. `close()` aborts every live run and writes nothing, so a rebuild sees the last `running` snapshot (spec §9).

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -50,9 +50,11 @@
   SUBAGENT_TOOL_NAME,
   type Subagent,
   type SubagentDetails,
+  type SubagentOutcome,
   type SubagentPort,
   type SubagentSessionOptions
 } from './subagent'
+export { SUBAGENT_STATE_TYPE, type SubagentState, type SubagentStatus, type SubagentView } from './subagentRegistry'
 export {
   createTodoExtension,
   TODO_TOOL_NAME,
````

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -147,7 +147,8 @@
             createSession: ({ fork, ...overrides }) =>
               createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
             parentTranscript: () => tap.entries(),
-            parentModelKey: key
+            parentModelKey: key,
+            emit: (event) => options.onEvent?.(event)
           })
         ]
       : []),
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -3,6 +3,8 @@
 import { Type } from '@earendil-works/pi-ai'
 import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'
 
+import type { AgentRuntimeSession } from './session'
+import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, SubagentRegistry } from './subagentRegistry'
 import {
   type CreateSubagentSession,
   forkTranscript,
@@ -33,6 +35,8 @@
    * `extensionFactories` must yield the parent's tools: the same tools, in the same order.
    */
   configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
+  /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
+  maxBackground?: number
 }
 
 /** The subagent about to be created. */
@@ -79,6 +83,8 @@
   parentTranscript: () => readonly TranscriptEntry[]
   /** Key of the parent's model, recorded as the model a subagent runs on. */
   parentModelKey: string
+  /** The parent's `onEvent`. */
+  emit: (event: AgentRuntimeEvent) => void
 }
 
 const DESCRIPTION = [
@@ -86,7 +92,8 @@
   '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
   '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
   '- Start independent subagents together in one message; they run at the same time.',
-  '- You see the final report, not the intermediate steps.'
+  '- You see the final report, not the intermediate steps.',
+  '- Run it in the foreground when you need its result to go on. Use background: true only when you have independent work to do meanwhile; you are notified when it finishes.'
 ].join('\n')
 
 const PREAMBLE =
@@ -113,6 +120,9 @@
   return lines.join('\n')
 }
 
+const startedText = (sessionId: string) =>
+  `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
+
 const notStarted = (sessionId: string, fork: boolean): AgentToolResult<SubagentDetails> => ({
   content: [text('The subagent was not started because the turn was aborted.')],
   details: { sessionId, fork, background: false, outcome: 'aborted' },
@@ -126,6 +136,12 @@
     Type.Boolean({
       description: 'Start from this conversation as it is now instead of an empty context. Default false.'
     })
+  ),
+  background: Type.Optional(
+    Type.Boolean({
+      description:
+        'Return at once and let the subagent work in the background; you are notified when it finishes. Default false.'
+    })
   )
 })
 
@@ -134,9 +150,17 @@
   port,
   createSession,
   parentTranscript,
-  parentModelKey
+  parentModelKey,
+  emit
 }: SubagentToolOptions): ExtensionFactory {
   return (pi) => {
+    const registry = new SubagentRegistry({
+      appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
+      emit,
+      maxBackground: port.maxBackground ?? DEFAULT_MAX_BACKGROUND
+    })
+    pi.on('session_shutdown', () => registry.close())
+
     pi.registerTool({
       name: SUBAGENT_TOOL_NAME,
       label: 'Subagent',
@@ -149,18 +173,44 @@
         const prompt = params.prompt.trim()
         if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
         const fork = params.fork ?? false
+        const background = params.background ?? false
         const subagent: Subagent = {
           parentToolCallId: toolCallId,
           sessionId: randomUUID(),
           description,
           fork,
-          background: false
-        }
-        // Built before `configure`, so a failure building the fork transcript never reaches the host.
-        const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
-        const options = await port.configure(subagent)
-        if (signal?.aborted) return notStarted(subagent.sessionId, fork)
-        const child = await openChild({ subagent, options, prefix, parentModelKey, createSession })
+          background
+        }
+        const release = background ? registry.reserveBackground() : () => {}
+        let child: AgentRuntimeSession
+        try {
+          // Built before `configure`, so a failure building the fork transcript never reaches the host.
+          const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
+          const options = await port.configure(subagent)
+          // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
+          if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
+          child = await openChild({ subagent, options, prefix, parentModelKey, createSession })
+        } finally {
+          release()
+        }
+        if (background) {
+          registry.startBackground(
+            {
+              sessionId: subagent.sessionId,
+              parentToolCallId: toolCallId,
+              description,
+              fork,
+              background,
+              modelKey: parentModelKey,
+              run: 1,
+              status: 'running'
+            },
+            child,
+            taskText(prompt)
+          )
+          const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
+          return { content: [text(startedText(subagent.sessionId))], details }
+        }
         try {
           const run = new AbortController()
           const onAbort = () => run.abort()
````

Create `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````ts
import type { Usage } from '@earendil-works/pi-ai'

import type { AgentRuntimeSession } from './session'
import type { SubagentOutcome } from './subagent'
import { type RunResult, runSubagent } from './subagentRun'
import type { AgentRuntimeEvent } from './transcriptTap'

/** State entry of the parent: one snapshot per change of a subagent's run. */
export const SUBAGENT_STATE_TYPE = 'cherry.subagent-state'

/** Background subagents one parent may run at once (Claude Code's default). */
export const DEFAULT_MAX_BACKGROUND = 20

export type SubagentStatus = 'running' | 'awaiting_approval' | 'finished'

/** One subagent of the parent session, as the parent's extension tracks it. */
export interface SubagentRecord {
  sessionId: string
  parentToolCallId: string
  description: string
  fork: boolean
  /** Whether the latest run is in the background (a continuation always is). */
  background: boolean
  modelKey: string
  /** The latest run, from 1. */
  run: number
  status: SubagentStatus
  outcome?: SubagentOutcome
}

/** Data of a `cherry.subagent-state` entry. */
export interface SubagentState {
  sessionId: string
  parentToolCallId: string
  description: string
  fork: boolean
  background: boolean
  modelKey: string
  run: number
  status: 'running' | 'finished'
  outcome?: SubagentOutcome
  report?: string
  reason?: string
  partial?: string
  usage?: Usage
}

/** A background subagent as the host shows it; carried by the parent's `subagents` event. */
export interface SubagentView {
  sessionId: string
  parentToolCallId: string
  description: string
  status: SubagentStatus
  outcome?: SubagentOutcome
}

/** What the registry needs from the parent session. */
export interface RegistryHost {
  appendState(state: SubagentState): void
  emit(event: AgentRuntimeEvent): void
  maxBackground: number
}

interface LiveRun {
  child: AgentRuntimeSession
  controller: AbortController
  done: Promise<void>
}

const snapshot = (record: SubagentRecord, result?: RunResult): SubagentState => ({
  sessionId: record.sessionId,
  parentToolCallId: record.parentToolCallId,
  description: record.description,
  fork: record.fork,
  background: record.background,
  modelKey: record.modelKey,
  run: record.run,
  status: record.status === 'finished' ? 'finished' : 'running',
  ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
  ...(result === undefined
    ? {}
    : {
        ...(result.report === undefined ? {} : { report: result.report }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.partial === undefined ? {} : { partial: result.partial }),
        usage: result.usage
      })
})

/** The parent's subagents: their state, live runs and the background cap. */
export class SubagentRegistry {
  private readonly records = new Map<string, SubagentRecord>()
  private readonly live = new Map<string, LiveRun>()
  /** Background launches past the cap check that have not started yet. */
  private launching = 0
  private closing = false

  constructor(private readonly host: RegistryHost) {}

  get(sessionId: string): SubagentRecord | undefined {
    return this.records.get(sessionId)
  }

  /** Background subagents running or waiting for an approval. */
  runningBackground(): number {
    let count = 0
    for (const record of this.records.values()) if (record.background && record.status !== 'finished') count++
    return count
  }

  /** Holds a background slot until the launch starts or fails; throws at the cap. */
  reserveBackground(): () => void {
    const running = this.runningBackground() + this.launching
    if (running >= this.host.maxBackground)
      throw new Error(
        `${running} background subagents are already running; wait for one to finish before starting another.`
      )
    this.launching++
    let held = true
    return () => {
      if (held) this.launching--
      held = false
    }
  }

  views(): SubagentView[] {
    return [...this.records.values()]
      .filter((record) => record.background)
      .map((record) => ({
        sessionId: record.sessionId,
        parentToolCallId: record.parentToolCallId,
        description: record.description,
        status: record.status,
        ...(record.outcome === undefined ? {} : { outcome: record.outcome })
      }))
  }

  /** Runs `task` on `child` in the background; the parent's turn does not wait for it or stop it. */
  startBackground(record: SubagentRecord, child: AgentRuntimeSession, task: string): void {
    record.background = true
    record.status = 'running'
    delete record.outcome
    this.records.set(record.sessionId, record)
    this.host.appendState(snapshot(record))
    this.changed()
    const controller = new AbortController()
    const done = runSubagent(child, task, controller.signal).then((result) => this.finish(record, child, result))
    this.live.set(record.sessionId, { child, controller, done })
  }

  /** Session shutdown: stops every live run and disposes its session, writing nothing. */
  async close(): Promise<void> {
    this.closing = true
    const runs = [...this.live.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }

  private async finish(record: SubagentRecord, child: AgentRuntimeSession, result: RunResult): Promise<void> {
    this.live.delete(record.sessionId)
    // A failing shutdown of the subagent's session must not keep its result from the parent.
    await child.dispose().catch(() => undefined)
    // Rebuilt from the transcript, a run whose last snapshot is `running` is interrupted.
    if (this.closing) return
    record.status = 'finished'
    record.outcome = result.end
    this.host.appendState(snapshot(record, result))
    this.changed()
  }

  private changed(): void {
    this.host.emit({ type: 'subagents', subagents: this.views() })
  }
}
````

Apply to `packages/agent-runtime-pi/src/transcriptTap.ts`:

````diff
--- a/packages/agent-runtime-pi/src/transcriptTap.ts
+++ b/packages/agent-runtime-pi/src/transcriptTap.ts
@@ -11,6 +11,7 @@
 import { AI_SDK_API } from './aiSdkProvider'
 import { toModelMessage, toUserContent } from './modelMessages'
 import type { TranscriptModel } from './rebuild'
+import type { SubagentView } from './subagentRegistry'
 import {
   STATE_TYPE_PREFIX,
   TOOL_LOADOUT_STATE,
@@ -29,6 +30,8 @@
   | { type: 'compaction-end'; reason: CompactionReason; entryId?: string; error?: string }
   /** An agent run settled; every entry up to `headEntryId` has been emitted. */
   | { type: 'turn-complete'; headEntryId: string | undefined; aborted: boolean }
+  /** The parent's background subagents after a change; the host maps it to its background tasks. */
+  | { type: 'subagents'; subagents: SubagentView[] }
 
 type Listener = (event: AgentRuntimeEvent) => void
 
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/transcriptTap.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/transcriptTap.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/transcriptTap.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/transcriptTap.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): run subagents in the background"
```

### Task 3: Delivery: notifications, settle merge, idle runs, the prompt/compact hold, abort suppression, long results

Spec: §4.3 (notification), §4.4 (`prompt`, `compact`, `SubagentNotificationDetails`), §7.1–§7.6, §13.1, D1

**Files:**
- Create: `packages/agent-runtime-pi/src/subagentDelivery.ts`, `packages/agent-runtime-pi/tests/subagentDelivery.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/offload.ts`, `packages/agent-runtime-pi/src/session.ts`, `packages/agent-runtime-pi/src/index.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `SubagentRegistry`, `RegistryHost`, `RunResult`, `MAX_SUBAGENT_REQUESTS`, `SubagentOutcome`.
- Produces (`subagentDelivery.ts`): `SUBAGENT_NOTIFICATION_TYPE = 'cherry.subagent-notification'`; `NOTIFICATION_THRESHOLD_CHARS = 20_000`; `interface SubagentNotificationDetails { subagents: Array<{ sessionId; run; outcome; stoppedBy?; usage: Usage }> }`; `interface PendingDelivery { sessionId; run; description; outcome; stoppedBy?; report?; reason?; partial?; usage; wake: boolean }`; `interface NotificationMessage { customType; content: string; display: false; details }`; `interface DeliveryHost { startTurn(message): void; isIdle(): boolean; stillRunning(): number }`; `shortenResult(result: RunResult, offload: ToolOutputOffload | undefined, origin: { toolCallId; toolName }): Promise<RunResult>`; `renderNotification(items: readonly PendingDelivery[], stillRunning: number): NotificationMessage`; `class SubagentDelivery { enqueue(item); beforeSettle(event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined; settled(aborted: boolean); beforeAgentStart(): { message } | undefined; hold(): () => void; close() }`.
- Produces elsewhere: `offloadText(offload: ToolOutputOffload, text: string, origin: { toolCallId; toolName }): Promise<string | undefined>` (`offload.ts`); `RegistryHost` gains `shorten(record, result): Promise<RunResult>` and `finished(record, result): void`; `type SubagentStopper = 'model' | 'user' | 'budget'`; `subagentExtension` becomes `createSubagentExtension(options): { extension: ExtensionFactory; controls: SubagentControls }` with `SubagentControls { hold(): () => void }` and `SubagentToolOptions.offload`; `AgentRuntimeSession.prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>` and `compact(customInstructions?: string): Promise<void>`; `index.ts` exports `NOTIFICATION_THRESHOLD_CHARS`, `SUBAGENT_NOTIFICATION_TYPE`, `SubagentNotificationDetails`, `SubagentStopper`.

- [ ] **Step 1: Write the failing tests**

One file covers the spec §15 delivery rows (idle wake, settle merge, user first, one notification for several, compaction, prompt preparation, abort suppression, long results) and Review Focus 4 (a result waiting when a command starts a turn).

Create `packages/agent-runtime-pi/tests/subagentDelivery.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { SUBAGENT_NOTIFICATION_TYPE, type ToolOutputStore, type TranscriptEntry } from '../src'
import {
  gate,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const BG_B = { description: 'Check B', prompt: 'TASK-B', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

/** The parent's requests: a subagent's carry its task. */
const parentCalls = (calls: readonly RoutedCall[]) => calls.filter((call) => !call.userText.includes('TASK-'))
const notifications = (entries: readonly TranscriptEntry[]) =>
  entries.filter((entry) => entry.kind === 'message' && entry.custom?.type === SUBAGENT_NOTIFICATION_TYPE)
const finishedCount = (entries: readonly TranscriptEntry[]) =>
  subagentStates(entries).filter((state) => state.status === 'finished').length

/** A tool that runs `body` while the parent's turn waits on it. */
const waitingTool = (body: () => Promise<void>) =>
  defineTool({
    name: 'wait_here',
    label: 'Wait',
    description: 'Waits',
    parameters: Type.Object({}),
    async execute() {
      await body()
      return { content: [{ type: 'text', text: 'waited' }], details: undefined }
    }
  })

describe('background subagent delivery', () => {
  // Breaks when an idle parent is not woken, or the result reaches the transcript as a user message
  // (the host would render it as the user's bubble) or without its structured details.
  it('wakes the idle parent with a notification message once the subagent finishes', async () => {
    const held = gate()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Launched.')
    })
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A in the background')
    held.open()
    await waitFor(() => parent.events.filter((event) => event.type === 'turn-complete').length === 2)

    const { sessionId } = host.subagents[0]
    expect(calls.at(-1)!.lastRole).toBe('user')
    expect(calls.at(-1)!.lastText).toBe(`${NOTE}\n\n- "Check A" (id: ${sessionId}) completed:\n  REPORT-A`)
    expect(notifications(parent.entries)).toEqual([
      expect.objectContaining({
        message: { role: 'user', content: calls.at(-1)!.lastText },
        custom: {
          type: SUBAGENT_NOTIFICATION_TYPE,
          display: false,
          details: {
            subagents: [
              { sessionId, run: 1, outcome: 'completed', usage: expect.objectContaining({ totalTokens: 17 }) }
            ]
          }
        }
      })
    ])
  })

  // Breaks when the notification is steered into the running turn (it would reach a mid-turn
  // request) or opens a run of its own instead of continuing the one that settles.
  it('merges a result that arrives during a turn into that turn as it settles', async () => {
    const held = gate()
    const parent = hostStore()
    const waitHere = waitingTool(async () => {
      held.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A and keep working')
        return [subagentCall('call_a', BG_A), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      if (lastRole === 'tool') return reply('Kept working.')
      return reply('Read the report.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A and keep working')

    expect(parentCalls(calls).map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastRole))).toEqual(
      ['user', 'tool', 'notification']
    )
    expect(parent.events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
  })

  // Breaks when the notification is delivered ahead of a message the user queued during the turn.
  it("answers the user's queued message before the result", async () => {
    const held = gate()
    const parent = hostStore()
    const runtime: { prompt?: (text: string, options?: { streamingBehavior: 'followUp' }) => Promise<void> } = {}
    const waitHere = waitingTool(async () => {
      held.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
      await runtime.prompt!('USER-FOLLOW-UP', { streamingBehavior: 'followUp' })
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A and keep working')
        return [subagentCall('call_a', BG_A), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      return reply(lastRole === 'tool' ? 'Kept working.' : 'Answered.')
    })
    const created = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent
    })
    runtime.prompt = created.prompt

    await created.prompt('Check A and keep working')

    expect(
      parentCalls(calls)
        .slice(2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['USER-FOLLOW-UP', 'notification'])
  })

  // Breaks when every result opens its own round instead of one notification for all.
  it('sends the results that arrive during one turn as one notification, in the order they finished', async () => {
    const heldA = gate()
    const heldB = gate()
    const parent = hostStore()
    const waitHere = waitingTool(async () => {
      heldA.open()
      await waitFor(() => finishedCount(parent.entries) === 1)
      heldB.open()
      await waitFor(() => finishedCount(parent.entries) === 2)
    })
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply('REPORT-A'))
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A and B')
        return [
          subagentCall('call_b', BG_B),
          subagentCall('call_a', BG_A),
          toolCallPart('wait_1', 'wait_here'),
          finish('tool-calls')
        ]
      return reply(lastRole === 'tool' ? 'Kept working.' : 'Read both.')
    })
    const host = recordingSubagentPort()
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [waitHere],
      subagents: host.port,
      onEvent: parent.onEvent
    })

    await session.prompt('Check A and B')

    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId
    expect(calls.filter((call) => call.lastText.startsWith(NOTE)).map((call) => call.lastText)).toEqual([
      `${NOTE}\n\n- "Check A" (id: ${id('Check A')}) completed:\n  REPORT-A\n- "Check B" (id: ${id('Check B')}) completed:\n  REPORT-B`
    ])
    expect(notifications(parent.entries)).toHaveLength(1)
  })

  // Breaks when a notification starts a run while the host compacts, or nothing delivers it once
  // the compaction returns.
  it('waits for a manual compaction to end before starting the notification run', async () => {
    const held = gate()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Noted.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      onEvent: parent.onEvent,
      compaction: {
        reserveTokens: 16_384,
        keepRecentTokens: 1,
        summarize: async () => {
          held.open()
          await waitFor(() => finishedCount(parent.entries) === 1)
          return 'SUMMARY'
        }
      }
    })
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Anything else?')

    await runtime.compact()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const order = parent.events.flatMap((event) =>
      event.type === 'compaction-end'
        ? ['compaction-end']
        : event.type === 'transcript-append' && notifications(event.entries).length > 0
          ? ['notification']
          : []
    )
    expect(order).toEqual(['compaction-end', 'notification'])
  })

  // Breaks when a result arriving while the host's prompt prepares starts a run of its own: Pi then
  // rejects the prompt ("Agent is already processing") and the user's message is lost.
  it("delivers a result that arrives while the host's prompt prepares after that prompt's turn", async () => {
    const held = gate()
    const parent = hostStore()
    let holdNextPrompt = false
    const slowStart: ExtensionFactory = (pi) => {
      pi.on('before_agent_start', async () => {
        if (!holdNextPrompt) return undefined
        holdNextPrompt = false
        held.open()
        await waitFor(() => finishedCount(parent.entries) === 1)
        return undefined
      })
    }
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply(lastText.startsWith(NOTE) ? 'Read the report.' : 'Answered.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      extensionFactories: [slowStart],
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A in the background')

    holdNextPrompt = true
    await runtime.prompt('Second question')

    expect(
      parentCalls(calls)
        .slice(-2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['Second question', 'notification'])
  })

  // Breaks when stopping a turn is followed by an automatic run, when the result is lost, or when
  // automatic runs never come back after the user speaks again.
  it('starts nothing after the user stops a turn; the result rides with their next message', async () => {
    const heldA = gate()
    const heldB = gate()
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'stop_turn',
      label: 'Stop turn',
      description: 'The user presses stop',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply('REPORT-A'))
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Check B in the background') return [subagentCall('call_b', BG_B), finish('tool-calls')]
      if (lastText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('Answered.')
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: recordingSubagentPort().port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Do something long')

    heldA.open()
    await waitFor(() => finishedCount(store.entries) === 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.some((call) => call.lastText.startsWith(NOTE))).toBe(false)

    await runtime.prompt('What did A find?')
    const prompt = calls.at(-1)!.options.prompt
    const texts = prompt
      .slice(-2)
      .map((message) =>
        message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''
      )
    expect(texts[0]).toBe('What did A find?')
    expect(texts[1]).toMatch(/^Background subagent update[\s\S]*"Check A"[\s\S]*REPORT-A/)

    await runtime.prompt('Check B in the background')
    heldB.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE) && call.lastText.includes('REPORT-B')))
  })

  // Review focus 4. Breaks when a waiting result only rides with a prompt (or Pi's nextTurn queue): a
  // command that starts its own turn (`/goal resume`) never carries it, so that turn's settle must.
  it('delivers a waiting result in a turn a command starts', async () => {
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'stop_turn',
      label: 'Stop turn',
      description: 'The user presses stop',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const roundCommand: ExtensionFactory = (pi) => {
      pi.registerCommand('round', {
        description: 'Starts a turn of its own',
        handler: async () => {
          pi.sendMessage({ customType: 'test.round', content: 'ROUND', display: false }, { triggerTurn: true })
        }
      })
    }
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const store = hostStore()
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: recordingSubagentPort().port,
      extensionFactories: [roundCommand],
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Do something long')
    held.open()
    await waitFor(() => finishedCount(store.entries) === 1)

    await runtime.prompt('/round')
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    expect(
      parentCalls(calls)
        .slice(-2)
        .map((call) => (call.lastText.startsWith(NOTE) ? 'notification' : call.lastText))
    ).toEqual(['ROUND', 'notification'])
  })

  // Breaks when an oversized report is put into the context whole although the host offloads.
  it('offloads a long result through the host store and sends its marker', async () => {
    const saved: Parameters<ToolOutputStore['save']>[0][] = []
    const store: ToolOutputStore = {
      async save(file) {
        saved.push(file)
        return `/offload/${file.name}`
      }
    }
    const held = gate()
    const long = 'R'.repeat(30_000)
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply(long))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('Answered.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port,
      offload: { store, thresholdChars: 5_000 }
    })
    await session.prompt('Check A in the background')
    held.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const text = calls.find((call) => call.lastText.startsWith(NOTE))!.lastText
    expect(saved).toEqual([expect.objectContaining({ content: long, toolCallId: 'call_a', toolName: 'subagent' })])
    expect(text).toContain('<persisted-output>')
    expect(text).toContain(`Full output saved to: /offload/${saved[0].name}`)
    expect(text.length).toBeLessThan(5_000)
  })

  // Breaks when an oversized report is put into the context whole without an offload store, or a
  // report within the limit is cut.
  it('keeps the head and tail of a result over 20,000 characters when nothing offloads', async () => {
    const heldA = gate()
    const heldB = gate()
    const head = 'H'.repeat(10_000)
    const tail = 'T'.repeat(10_001)
    const fits = 'F'.repeat(20_000)
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return heldA.wait(reply(head + tail))
      if (userText.includes('TASK-B')) return heldB.wait(reply(fits))
      if (lastText === 'Check A and B')
        return [subagentCall('call_a', BG_A), subagentCall('call_b', BG_B), finish('tool-calls')]
      return reply('Answered.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Check A and B')
    heldA.open()
    await waitFor(() => calls.filter((call) => call.lastText.startsWith(NOTE)).length === 1)
    heldB.open()
    await waitFor(() => calls.filter((call) => call.lastText.startsWith(NOTE)).length === 2)

    const [a, b] = calls.filter((call) => call.lastText.startsWith(NOTE)).map((call) => call.lastText)
    expect(a).toContain(`  ${'H'.repeat(8_000)}\n  [… 4001 characters left out …]\n  ${'T'.repeat(8_000)}`)
    expect(a).not.toContain('H'.repeat(8_001))
    expect(b).toContain(`  ${fits}`)
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/offload.test.ts packages/agent-runtime-pi/tests/subagent.test.ts`

Expected: FAIL. Every delivery test fails: no notification ever reaches the parent (`waitFor timed out`), `runtime.prompt` and `runtime.compact` are not functions, and `SUBAGENT_NOTIFICATION_TYPE` is undefined.

- [ ] **Step 3: Implement**

Results ride with the next prompt through `before_agent_start` instead of `deliverAs: 'nextTurn'` (Spec amendment 2). A run whose `agent_before_settle` outcome is `aborted` (the host's own signal) starts the suppression too (Spec amendment 6). The registry marks a run finished in the same tick it ends and records it (dispose, shorten, snapshot, notify) afterwards, so later tasks can tell "just ended" from "running".

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -52,8 +52,14 @@
   type SubagentDetails,
   type SubagentOutcome,
   type SubagentPort,
-  type SubagentSessionOptions
+  type SubagentSessionOptions,
+  type SubagentStopper
 } from './subagent'
+export {
+  NOTIFICATION_THRESHOLD_CHARS,
+  SUBAGENT_NOTIFICATION_TYPE,
+  type SubagentNotificationDetails
+} from './subagentDelivery'
 export { SUBAGENT_STATE_TYPE, type SubagentState, type SubagentStatus, type SubagentView } from './subagentRegistry'
 export {
   createTodoExtension,
````

Apply to `packages/agent-runtime-pi/src/offload.ts`:

````diff
--- a/packages/agent-runtime-pi/src/offload.ts
+++ b/packages/agent-runtime-pi/src/offload.ts
@@ -59,29 +59,34 @@
 }
 
 /**
+ * The marker that replaces `text` once it passes the threshold, its full text saved through the
+ * store; `undefined` while it fits.
+ */
+export async function offloadText(
+  { store, thresholdChars }: ToolOutputOffload,
+  text: string,
+  origin: { toolCallId: string; toolName: string }
+): Promise<string | undefined> {
+  if (text.length <= Math.max(thresholdChars, MIN_OFFLOAD_CHARS)) return undefined
+  const name = `tool-output-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.txt`
+  return offloadMarker(text, await saveNote(store, { name, content: text, ...origin }))
+}
+
+/**
  * Saves oversized tool output through the host store and gives the model a marker instead, so one
  * result cannot overflow the context. The transcript keeps the marker: it is what the model saw.
  */
-export function toolOutputOffloadExtension({ store, thresholdChars }: ToolOutputOffload): ExtensionFactory {
+export function toolOutputOffloadExtension(offload: ToolOutputOffload): ExtensionFactory {
   return (pi) => {
     pi.on('tool_result', async (event) => {
       // Errors stay readable; nested calls reach the model only through their caller; `read`
       // results are exempt so reading an offloaded output back cannot offload it again.
       if (event.isError || event.parentToolCallId !== undefined || event.toolName === READ_TOOL) return undefined
       const text = event.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
-      if (text.length <= Math.max(thresholdChars, MIN_OFFLOAD_CHARS)) return undefined
-      const name = `tool-output-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.txt`
-      const note = await saveNote(store, {
-        name,
-        content: text,
-        toolCallId: event.toolCallId,
-        toolName: event.toolName
-      })
+      const marker = await offloadText(offload, text, { toolCallId: event.toolCallId, toolName: event.toolName })
+      if (marker === undefined) return undefined
       return {
-        content: [
-          { type: 'text', text: offloadMarker(text, note) },
-          ...event.content.filter((part) => part.type === 'image')
-        ],
+        content: [{ type: 'text', text: marker }, ...event.content.filter((part) => part.type === 'image')],
         ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent })
       }
     })
````

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -17,7 +17,7 @@
 import type { ModelCallPort, ModelCallSideChannel } from './ports'
 import { rebuildSessionEntries } from './rebuild'
 import { recallExtension } from './recall'
-import { subagentExtension, type SubagentPort } from './subagent'
+import { createSubagentExtension, type SubagentPort } from './subagent'
 import type { TranscriptEntry } from './transcript'
 import { type AgentRuntimeEvent, TranscriptTap } from './transcriptTap'
 
@@ -89,6 +89,13 @@
   session: AgentSession
   /** Aborts the running turn, lets extensions shut down, then disposes the session. */
   dispose(): Promise<void>
+  /**
+   * `session.prompt`, for every user turn the host starts: while it prepares, Pi reports the session
+   * idle, and a background result must not start a run then.
+   */
+  prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>
+  /** `session.compact`, for every manual compaction the host starts, for the same reason. */
+  compact(customInstructions?: string): Promise<void>
 }
 
 /**
@@ -134,24 +141,24 @@
   )
 
   const { compaction } = options
+  const subagents =
+    options.subagents &&
+    createSubagentExtension({
+      port: options.subagents,
+      // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
+      createSession: ({ fork, ...overrides }) =>
+        createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
+      parentTranscript: () => tap.entries(),
+      parentModelKey: key,
+      emit: (event) => options.onEvent?.(event),
+      offload: options.offload
+    })
   const extensionFactories = [
     ...(compaction?.summarize
       ? [compactionSummaryExtension(compaction.summarize, (message) => (tap.summaryFailure = message))]
       : []),
     ...(options.recall ? [recallExtension(() => tap.entries())] : []),
-    ...(options.subagents
-      ? [
-          subagentExtension({
-            port: options.subagents,
-            // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
-            createSession: ({ fork, ...overrides }) =>
-              createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
-            parentTranscript: () => tap.entries(),
-            parentModelKey: key,
-            emit: (event) => options.onEvent?.(event)
-          })
-        ]
-      : []),
+    ...(subagents ? [subagents.extension] : []),
     ...(options.extensionFactories ?? []),
     // Last, so it sees what other `tool_result` handlers made of the output.
     ...(options.offload ? [toolOutputOffloadExtension(options.offload)] : [])
@@ -205,8 +212,18 @@
   tap.setBaseTools(baseTools)
   if (rebuilt.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...rebuilt.activatedTools])
 
+  const held = async (run: () => Promise<unknown>) => {
+    const release = subagents?.controls.hold() ?? (() => {})
+    try {
+      await run()
+    } finally {
+      release()
+    }
+  }
   return {
     session,
+    prompt: (text, promptOptions) => held(() => session.prompt(text, promptOptions)),
+    compact: (customInstructions) => held(() => session.compact(customInstructions)),
     async dispose() {
       try {
         await session.abort()
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -1,9 +1,17 @@
 import { randomUUID } from 'node:crypto'
 
 import { Type } from '@earendil-works/pi-ai'
-import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'
-
+import type {
+  AgentSession,
+  AgentToolResult,
+  ExtensionContext,
+  ExtensionFactory,
+  SessionEntry
+} from '@earendil-works/pi-coding-agent'
+
+import type { ToolOutputOffload } from './offload'
 import type { AgentRuntimeSession } from './session'
+import { shortenResult, SubagentDelivery } from './subagentDelivery'
 import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, SubagentRegistry } from './subagentRegistry'
 import {
   type CreateSubagentSession,
@@ -66,6 +74,9 @@
 /** How a subagent's run ended. */
 export type SubagentOutcome = RunEnd | 'stopped' | 'interrupted'
 
+/** Who stopped a run that ended `stopped`. */
+export type SubagentStopper = 'model' | 'user' | 'budget'
+
 /**
  * `details` of every result the tool returns once the subagent's session is built, and of a call
  * aborted before then. Calls that throw carry none, `onSessionCreated` throwing included.
@@ -85,6 +96,14 @@
   parentModelKey: string
   /** The parent's `onEvent`. */
   emit: (event: AgentRuntimeEvent) => void
+  /** The parent's offload, also used for long results in notifications. */
+  offload: ToolOutputOffload | undefined
+}
+
+/** What the parent's `AgentRuntimeSession` reaches through to its subagents. */
+export interface SubagentControls {
+  /** Held by a host prompt or compaction until it returns; no notification starts a run meanwhile. */
+  hold(): () => void
 }
 
 const DESCRIPTION = [
@@ -145,21 +164,64 @@
   )
 })
 
-/** The `subagent` tool: each call runs a subagent session in-process and returns its final report. */
-export function subagentExtension({
+/**
+ * The `subagent` tool and the delivery of background results. Each call runs a subagent session
+ * in-process; a foreground call returns its final report, a background one returns at once.
+ */
+export function createSubagentExtension({
   port,
   createSession,
   parentTranscript,
   parentModelKey,
-  emit
-}: SubagentToolOptions): ExtensionFactory {
-  return (pi) => {
+  emit,
+  offload
+}: SubagentToolOptions): { extension: ExtensionFactory; controls: SubagentControls } {
+  let delivery: SubagentDelivery | undefined
+  const controls: SubagentControls = { hold: () => delivery?.hold() ?? (() => {}) }
+  const extension: ExtensionFactory = (pi) => {
+    let ctx: ExtensionContext | undefined
+    let inSubagent = false
     const registry = new SubagentRegistry({
       appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
       emit,
-      maxBackground: port.maxBackground ?? DEFAULT_MAX_BACKGROUND
-    })
-    pi.on('session_shutdown', () => registry.close())
+      maxBackground: port.maxBackground ?? DEFAULT_MAX_BACKGROUND,
+      shorten: (record, result) =>
+        shortenResult(result, offload, { toolCallId: record.parentToolCallId, toolName: SUBAGENT_TOOL_NAME }),
+      finished: (record, result) =>
+        delivery?.enqueue({
+          sessionId: record.sessionId,
+          run: record.run,
+          description: record.description,
+          outcome: record.outcome!,
+          ...(result.report === undefined ? {} : { report: result.report }),
+          ...(result.reason === undefined ? {} : { reason: result.reason }),
+          ...(result.partial === undefined ? {} : { partial: result.partial }),
+          usage: result.usage,
+          wake: true
+        })
+    })
+    const parentDelivery = new SubagentDelivery({
+      startTurn: (message) => pi.sendMessage(message, { triggerTurn: true }),
+      isIdle: () => ctx?.isIdle() ?? false,
+      stillRunning: () => registry.runningBackground()
+    })
+
+    pi.on('session_start', (_event, context) => {
+      // A fork keeps this extension so its tools match the parent's; it delivers nothing.
+      inSubagent = isSubagentSession(context.sessionManager.getBranch())
+      if (inSubagent) return
+      ctx = context
+      delivery = parentDelivery
+    })
+    pi.on('agent_before_settle', (event) => (inSubagent ? undefined : parentDelivery.beforeSettle(event)))
+    pi.on('agent_settled', (event) => {
+      if (!inSubagent) parentDelivery.settled(event.aborted)
+    })
+    pi.on('before_agent_start', () => (inSubagent ? undefined : parentDelivery.beforeAgentStart()))
+    pi.on('session_shutdown', () => {
+      parentDelivery.close()
+      return registry.close()
+    })
 
     pi.registerTool({
       name: SUBAGENT_TOOL_NAME,
@@ -237,4 +299,5 @@
       }
     })
   }
-}
+  return { extension, controls }
+}
````

Create `packages/agent-runtime-pi/src/subagentDelivery.ts`:

````ts
import type { Usage } from '@earendil-works/pi-ai'
import type { AgentBeforeSettleEvent, AgentBeforeSettleEventResult } from '@earendil-works/pi-coding-agent'

import { type ToolOutputOffload, offloadText } from './offload'
import type { SubagentOutcome, SubagentStopper } from './subagent'
import { MAX_SUBAGENT_REQUESTS, type RunResult } from './subagentRun'

/** Custom message of the parent carrying finished background runs; the model gets it as a user message. */
export const SUBAGENT_NOTIFICATION_TYPE = 'cherry.subagent-notification'

/** Results longer than this many characters are shortened when the host has no offload store. */
export const NOTIFICATION_THRESHOLD_CHARS = 20_000

/** `details` of a notification: for the host's rendering and the goal's accounting, never sent to the model. */
export interface SubagentNotificationDetails {
  subagents: Array<{
    sessionId: string
    run: number
    outcome: SubagentOutcome
    stoppedBy?: SubagentStopper
    usage: Usage
  }>
}

/** One finished run waiting to reach the parent. */
export interface PendingDelivery {
  sessionId: string
  run: number
  description: string
  outcome: SubagentOutcome
  stoppedBy?: SubagentStopper
  report?: string
  reason?: string
  partial?: string
  usage: Usage
  /** False for a run the parent only needs to hear of: it rides with the next message, never starts one. */
  wake: boolean
}

export interface NotificationMessage {
  customType: typeof SUBAGENT_NOTIFICATION_TYPE
  content: string
  display: false
  details: SubagentNotificationDetails
}

/** What delivery needs from the parent session. */
export interface DeliveryHost {
  /** `pi.sendMessage(message, { triggerTurn: true })`. */
  startTurn(message: NotificationMessage): void
  /** The parent runs nothing and compacts nothing. */
  isIdle(): boolean
  /** Background subagents of the parent still running or awaiting approval. */
  stillRunning(): number
}

const HEADER = 'Background subagent update (automatic message, not from the user):'
const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'
// Without a store the model cannot read the rest back, so it keeps more than the offload excerpts.
const KEPT_HEAD_CHARS = 8_000
const KEPT_TAIL_CHARS = 8_000

const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')

function keepEnds(text: string): string {
  if (text.length <= NOTIFICATION_THRESHOLD_CHARS) return text
  const omitted = text.length - KEPT_HEAD_CHARS - KEPT_TAIL_CHARS
  return `${text.slice(0, KEPT_HEAD_CHARS)}\n[… ${omitted} characters left out …]\n${text.slice(-KEPT_TAIL_CHARS)}`
}

/**
 * Shortens a finished run's report and partial output for the notification: through the host's
 * offload store when there is one, otherwise by keeping the head and tail.
 */
export async function shortenResult(
  result: RunResult,
  offload: ToolOutputOffload | undefined,
  origin: { toolCallId: string; toolName: string }
): Promise<RunResult> {
  const shorten = async (text: string | undefined) => {
    if (text === undefined) return undefined
    if (!offload) return keepEnds(text)
    return (await offloadText(offload, text, origin)) ?? text
  }
  const [report, partial] = await Promise.all([shorten(result.report), shorten(result.partial)])
  return {
    ...result,
    ...(report === undefined ? {} : { report }),
    ...(partial === undefined ? {} : { partial })
  }
}

function itemText(item: PendingDelivery): string {
  const head = `- "${item.description}" (id: ${item.sessionId})`
  const partial = item.partial ? `\n  Partial output before it stopped:\n${indent(item.partial)}` : ''
  switch (item.outcome) {
    case 'completed':
      return `${head} completed:\n${indent(item.report || NO_FINAL_MESSAGE)}`
    case 'failed':
      return `${head} failed${item.reason ? `: ${item.reason}` : '.'}${partial}`
    case 'truncated':
      return `${head} hit its output limit before finishing.${partial}`
    case 'limit_reached':
      return `${head} was stopped after ${MAX_SUBAGENT_REQUESTS} model requests.${partial}`
    case 'aborted':
      return `${head} was aborted.${partial}`
    case 'interrupted':
      return `${head} was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`
    case 'stopped':
      return item.stoppedBy === 'user'
        ? `${head} was stopped by the user.`
        : `${head} was stopped because the goal's budget is used up.${partial}`
  }
}

/** One message for every pending item, oldest first. */
export function renderNotification(items: readonly PendingDelivery[], stillRunning: number): NotificationMessage {
  const footer =
    stillRunning === 0
      ? []
      : ['', `${stillRunning} other background ${stillRunning === 1 ? 'subagent is' : 'subagents are'} still running.`]
  return {
    customType: SUBAGENT_NOTIFICATION_TYPE,
    content: [HEADER, '', ...items.map(itemText), ...footer].join('\n'),
    display: false,
    details: {
      subagents: items.map((item) => ({
        sessionId: item.sessionId,
        run: item.run,
        outcome: item.outcome,
        ...(item.stoppedBy === undefined ? {} : { stoppedBy: item.stoppedBy }),
        usage: item.usage
      }))
    }
  }
}

/**
 * When finished background runs reach the parent: merged into a run as it settles, or as the start
 * of a new run once the parent is idle, never in the middle of a run.
 */
export class SubagentDelivery {
  private queue: PendingDelivery[] = []
  /** Host prompts and compactions in flight: Pi's `prompt()` reports idle while it prepares. */
  private holds = 0
  /** After the user stops a turn, nothing starts until they speak again. */
  private suppressed = false
  private closed = false

  constructor(private readonly host: DeliveryHost) {}

  enqueue(item: PendingDelivery): void {
    this.queue.push(item)
    this.deliverIfIdle()
  }

  /** `agent_before_settle`: the run goes on with the notification instead of settling. */
  beforeSettle(event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined {
    // A request the host aborted through its own signal settles here, not as an aborted run.
    if (event.outcome === 'aborted') this.suppressed = true
    if (event.outcome !== 'completed') return undefined
    // Users first: their queued message is answered before the notification is merged.
    if (event.context.pendingMessages.some((message) => message.role === 'user')) return undefined
    if (!this.queue.some((item) => item.wake)) return undefined
    return { entries: [...event.entries, { type: 'custom_message', ...this.take() }], continue: true }
  }

  settled(aborted: boolean): void {
    if (aborted) this.suppressed = true
    else this.deliverIfIdle()
  }

  /** `before_agent_start`, a prompt about to run: everything still queued rides with it. */
  beforeAgentStart(): { message: NotificationMessage } | undefined {
    this.suppressed = false
    return this.queue.length === 0 ? undefined : { message: this.take() }
  }

  /** Held by the host's prompt or compaction until it returns. */
  hold(): () => void {
    this.holds++
    let held = true
    return () => {
      if (!held) return
      held = false
      this.holds--
      this.deliverIfIdle()
    }
  }

  close(): void {
    this.closed = true
  }

  private deliverIfIdle(): void {
    if (this.closed || this.holds > 0 || this.suppressed || !this.host.isIdle()) return
    if (!this.queue.some((item) => item.wake)) return
    this.host.startTurn(this.take())
  }

  private take(): NotificationMessage {
    const items = this.queue
    this.queue = []
    return renderNotification(items, this.host.stillRunning())
  }
}
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -59,11 +59,15 @@
   appendState(state: SubagentState): void
   emit(event: AgentRuntimeEvent): void
   maxBackground: number
+  /** Shortens a finished run's texts for the snapshot and the notification. */
+  shorten(record: SubagentRecord, result: RunResult): Promise<RunResult>
+  /** A background run ended and its snapshot is written. */
+  finished(record: SubagentRecord, result: RunResult): void
 }
 
 interface LiveRun {
-  child: AgentRuntimeSession
   controller: AbortController
+  /** Settles once the run's session is disposed and its end is recorded. */
   done: Promise<void>
 }
 
@@ -137,6 +141,10 @@
 
   /** Runs `task` on `child` in the background; the parent's turn does not wait for it or stop it. */
   startBackground(record: SubagentRecord, child: AgentRuntimeSession, task: string): void {
+    if (this.closing) {
+      void child.dispose()
+      return
+    }
     record.background = true
     record.status = 'running'
     delete record.outcome
@@ -144,8 +152,13 @@
     this.host.appendState(snapshot(record))
     this.changed()
     const controller = new AbortController()
-    const done = runSubagent(child, task, controller.signal).then((result) => this.finish(record, child, result))
-    this.live.set(record.sessionId, { child, controller, done })
+    const done = runSubagent(child, task, controller.signal).then((result) => {
+      // Finished at once, so a message sent from now on continues the subagent instead of joining this run.
+      record.status = 'finished'
+      record.outcome = result.end
+      return this.record(record, child, result)
+    })
+    this.live.set(record.sessionId, { controller, done })
   }
 
   /** Session shutdown: stops every live run and disposes its session, writing nothing. */
@@ -156,16 +169,16 @@
     await Promise.all(runs.map((run) => run.done))
   }
 
-  private async finish(record: SubagentRecord, child: AgentRuntimeSession, result: RunResult): Promise<void> {
-    this.live.delete(record.sessionId)
+  private async record(record: SubagentRecord, child: AgentRuntimeSession, result: RunResult): Promise<void> {
     // A failing shutdown of the subagent's session must not keep its result from the parent.
     await child.dispose().catch(() => undefined)
+    const shortened = this.closing ? result : await this.host.shorten(record, result)
+    this.live.delete(record.sessionId)
     // Rebuilt from the transcript, a run whose last snapshot is `running` is interrupted.
     if (this.closing) return
-    record.status = 'finished'
-    record.outcome = result.end
-    this.host.appendState(snapshot(record, result))
+    this.host.appendState(snapshot(record, shortened))
     this.changed()
+    this.host.finished(record, shortened)
   }
 
   private changed(): void {
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/offload.test.ts packages/agent-runtime-pi/tests/subagent.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/offload.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/offload.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/offload.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts packages/agent-runtime-pi/tests/offload.test.ts packages/agent-runtime-pi/tests/subagent.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/offload.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): deliver background subagent results to the parent"
```

### Task 4: The inbox and `message_subagent` for a running subagent

Spec: §5.2 (running row, unknown id, no-`load` row), §5.4, §6.1 (inbox), §6.4, §8.5

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentMessage.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRun.ts`, `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/tests/subagentFork.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3): `runSubagent`, `openChild`, `SubagentRegistry.startBackground`, `SubagentDelivery`.
- Produces (`subagentRun.ts`): `SUBAGENT_MESSAGE_TYPE = 'cherry.subagent-message'`; `type RunStart = { prompt: string } | { message: string }`; `class SubagentInbox { readonly extension: ExtensionFactory; push(text: string): boolean; close(): void; hasPending(): boolean; take(): string[] }`; `openChild` input gains `inbox: SubagentInbox`; `runSubagent(child, start: RunStart, signal: AbortSignal, inbox: SubagentInbox): Promise<RunResult>`.
- Produces (`subagentRegistry.ts`): `recent(): SubagentRecord[]`; `message(sessionId, text): boolean`; `runForeground(record, child, start: RunStart, inbox, signal: AbortSignal | undefined): Promise<RunResult>`; `startBackground(record, child, start: RunStart, inbox): void`.
- Produces (`subagent.ts`): `MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'`; the `message_subagent({ id, message })` tool; every tool in a subagent's session throws `Subagents cannot start or manage subagents.`

- [ ] **Step 1: Write the failing tests**

The running-subagent rows of spec §5.2 and the fork refusal for `message_subagent`.

Apply to `packages/agent-runtime-pi/tests/subagentFork.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentFork.test.ts
+++ b/packages/agent-runtime-pi/tests/subagentFork.test.ts
@@ -126,14 +126,19 @@
     const forkCall = calls.find((call) => call.userText.includes('TASK-A'))!
     const names = (call: typeof forkCall) => call.options.tools?.map((tool) => tool.name)
     expect(names(forkCall)).toEqual(names(parentCall))
-    expect(names(forkCall)).toEqual(expect.arrayContaining(['get_weather', 'subagent']))
-  })
-
-  it('rejects a subagent call made inside a fork', async () => {
+    expect(names(forkCall)).toEqual(expect.arrayContaining(['get_weather', 'subagent', 'message_subagent']))
+  })
+
+  // Breaks when a fork can start or address subagents (it would manage its parent's subagents).
+  it('rejects subagent and message_subagent calls made inside a fork', async () => {
     const { model, calls } = routedModel(({ userText, lastRole }) => {
       if (userText.includes('TASK-A'))
         return lastRole === 'user'
-          ? [subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }), finish('tool-calls')]
+          ? [
+              subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }),
+              toolCallPart('call_message', 'message_subagent', { id: 'any', message: 'hello' }),
+              finish('tool-calls')
+            ]
           : [...textParts('r', 'REPORT-A'), finish('stop')]
       return lastRole === 'user'
         ? [subagentCall('call_a', forkA), finish('tool-calls')]
@@ -145,9 +150,11 @@
     await session.prompt('Check module A')
 
     expect(host.subagents.map((subagent) => subagent.parentToolCallId)).toEqual(['call_a'])
-    const nested = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).at(-1)!
-    expect(nested.toolCallId).toBe('call_nested')
-    expect(outputText(nested.output)).toMatch(/cannot start subagents/)
+    const refused = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).slice(-2)
+    expect(refused.map((part) => [part.toolCallId, outputText(part.output)])).toEqual([
+      ['call_nested', 'Subagents cannot start or manage subagents.'],
+      ['call_message', 'Subagents cannot start or manage subagents.']
+    ])
   })
 
   // Breaks when the fork prefix is not handed to the host: the stored transcript would start at the
````

Create `packages/agent-runtime-pi/tests/subagentMessage.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

describe('message_subagent to a running subagent', () => {
  // Breaks when the message is lost, interrupts the subagent's running tool, or reaches it before
  // the results of its current tool batch.
  it('reaches the subagent after its current tool batch', async () => {
    const toolGate = gate()
    const slow = defineTool({
      name: 'slow',
      label: 'Slow',
      description: 'Takes a while',
      parameters: Type.Object({}),
      execute: () => toolGate.wait({ content: [{ type: 'text', text: 'slow done' }], details: undefined })
    })
    const host = recordingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, lastRole }) => {
      if (userText.includes('TASK-A'))
        return lastRole === 'user' && lastText.includes('TASK-A')
          ? [toolCallPart('slow_1', 'slow'), finish('tool-calls')]
          : reply('REPORT-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Tell A to check C as well')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'ALSO-CHECK-C' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [slow],
      subagents: host.port
    })
    await session.prompt('Check A in the background')
    await toolGate.reached

    await session.prompt('Tell A to check C as well')
    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Message queued for subagent ${sessionId}; it reads it after its current step.`
    )
    toolGate.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    const childCalls = calls.filter((call) => call.userText.includes('TASK-A'))
    expect(childCalls).toHaveLength(2)
    const last = childCalls[1].options.prompt.slice(-2)
    expect(last.map((message) => message.role)).toEqual(['tool', 'user'])
    expect(childCalls[1].lastText).toBe('ALSO-CHECK-C')
  })

  // Breaks when a message that arrives while the subagent settles is dropped, or the subagent is
  // reported finished before it has read it.
  it('keeps the subagent going when a message arrives while it settles', async () => {
    const settleGate = gate()
    const host = recordingSubagentPort(() => ({
      extensionFactories: [
        ((pi) => {
          let held = false
          pi.on('agent_before_settle', async () => {
            if (held) return undefined
            held = true
            await settleGate.wait(undefined)
            return undefined
          })
        }) satisfies ExtensionFactory
      ]
    }))
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'ALSO-CHECK-C' ? 'REPORT-A+C' : 'REPORT-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Tell A to check C as well')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'ALSO-CHECK-C' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await settleGate.reached

    await session.prompt('Tell A to check C as well')
    settleGate.open()
    await waitFor(() => calls.some((call) => call.lastText.startsWith(NOTE)))

    expect(calls.filter((call) => call.userText.includes('TASK-A')).map((call) => call.lastText.slice(-12))).toEqual([
      expect.stringContaining('TASK-A'),
      'ALSO-CHECK-C'
    ])
    const finished = subagentStates(parent.entries).filter((state) => state.status === 'finished')
    expect(finished).toEqual([expect.objectContaining({ report: 'REPORT-A+C' })])
  })

  // Breaks when an unknown id is accepted, or the error leaves the model without the ids it can use.
  it('rejects an id this conversation never started and lists the ones it did', async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Message someone else')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: 'not-a-subagent', message: 'hi' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A in the background')
    await session.prompt('Message someone else')

    const result = toolResultOf(session, 'call_msg')
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      `No subagent with id not-a-subagent in this conversation. Subagents you can address:\n${host.subagents[0].sessionId} — Check A — running`
    )
    held.open()
  })

  // Breaks when a finished subagent is said to be messaged although nothing can continue it.
  it('refuses a finished subagent when the host cannot load its transcript', async () => {
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (lastText === 'Ask A again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'again' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Ask A again')

    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${host.subagents[0].sessionId} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
    )
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts`

Expected: FAIL. `subagentMessage.test.ts` fails: Pi answers every `message_subagent` call with `Tool message_subagent not found`, so the subagent never reads `ALSO-CHECK-C`; the fork test fails because the nested `subagent` call still says `Subagents cannot start subagents.`

- [ ] **Step 3: Implement**

The inbox steers a message into a running child; from the child's own `agent_before_settle` on it holds new messages, and once the run returns `runSubagent` starts the next run on the same session with them; the inbox closes in the same tick as its last check, so a message that comes later continues the subagent instead (Spec amendment 1, probe d). Foreground runs go through the registry from now on, so a foreground subagent is addressable once it ends.

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -12,7 +12,7 @@
 import type { ToolOutputOffload } from './offload'
 import type { AgentRuntimeSession } from './session'
 import { shortenResult, SubagentDelivery } from './subagentDelivery'
-import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, SubagentRegistry } from './subagentRegistry'
+import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, type SubagentRecord, SubagentRegistry } from './subagentRegistry'
 import {
   type CreateSubagentSession,
   forkTranscript,
@@ -20,16 +20,17 @@
   openChild,
   type RunEnd,
   type RunResult,
-  runSubagent,
-  SUBAGENT_ORIGIN_STATE
+  SUBAGENT_ORIGIN_STATE,
+  SubagentInbox
 } from './subagentRun'
 import type { TranscriptEntry } from './transcript'
 import type { AgentRuntimeEvent } from './transcriptTap'
 
-export { SUBAGENT_ORIGIN_STATE } from './subagentRun'
+export { SUBAGENT_MESSAGE_TYPE, SUBAGENT_ORIGIN_STATE } from './subagentRun'
 
 /** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
 export const SUBAGENT_TOOL_NAME = 'subagent'
+export const MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'
 
 /** True inside a subagent's session. */
 export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
@@ -138,6 +139,28 @@
   if (result.partial) lines.push(`Partial output before it stopped:\n${result.partial}`)
   return lines.join('\n')
 }
+
+const IN_SUBAGENT = 'Subagents cannot start or manage subagents.'
+
+/** A subagent's state in the words lists of subagents use. */
+function statusText(record: SubagentRecord): string {
+  if (record.status === 'running') return 'running'
+  if (record.status === 'awaiting_approval') return 'waiting for a tool approval'
+  return record.outcome!
+}
+
+function unknownId(id: string, registry: SubagentRegistry): string {
+  const listed = registry
+    .recent()
+    .map((record) => `${record.sessionId} — ${record.description} — ${statusText(record)}`)
+  const head = `No subagent with id ${id} in this conversation.`
+  return listed.length === 0 ? head : [`${head} Subagents you can address:`, ...listed].join('\n')
+}
+
+const messageParameters = Type.Object({
+  id: Type.String({ description: 'The id a subagent result or notification gave.' }),
+  message: Type.String({ description: 'What to tell the subagent.' })
+})
 
 const startedText = (sessionId: string) =>
   `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
@@ -230,7 +253,7 @@
       parameters,
       exposure: 'model-only',
       async execute(toolCallId, params, signal, _onUpdate, ctx) {
-        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error('Subagents cannot start subagents.')
+        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
         const description = params.description.trim()
         const prompt = params.prompt.trim()
         if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
@@ -244,6 +267,7 @@
           background
         }
         const release = background ? registry.reserveBackground() : () => {}
+        const inbox = new SubagentInbox()
         let child: AgentRuntimeSession
         try {
           // Built before `configure`, so a failure building the fork transcript never reaches the host.
@@ -251,36 +275,28 @@
           const options = await port.configure(subagent)
           // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
           if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
-          child = await openChild({ subagent, options, prefix, parentModelKey, createSession })
+          child = await openChild({ subagent, options, prefix, parentModelKey, inbox, createSession })
         } finally {
           release()
         }
+        const record: SubagentRecord = {
+          sessionId: subagent.sessionId,
+          parentToolCallId: toolCallId,
+          description,
+          fork,
+          background,
+          modelKey: parentModelKey,
+          run: 1,
+          status: 'running'
+        }
+        const start = { prompt: taskText(prompt) }
         if (background) {
-          registry.startBackground(
-            {
-              sessionId: subagent.sessionId,
-              parentToolCallId: toolCallId,
-              description,
-              fork,
-              background,
-              modelKey: parentModelKey,
-              run: 1,
-              status: 'running'
-            },
-            child,
-            taskText(prompt)
-          )
+          registry.startBackground(record, child, start, inbox)
           const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
           return { content: [text(startedText(subagent.sessionId))], details }
         }
         try {
-          const run = new AbortController()
-          const onAbort = () => run.abort()
-          if (signal?.aborted) run.abort()
-          else signal?.addEventListener('abort', onAbort, { once: true })
-          const result = await runSubagent(child, taskText(prompt), run.signal).finally(() =>
-            signal?.removeEventListener('abort', onAbort)
-          )
+          const result = await registry.runForeground(record, child, start, inbox, signal)
           const details: SubagentDetails = {
             sessionId: subagent.sessionId,
             fork,
@@ -298,6 +314,31 @@
         }
       }
     })
+
+    pi.registerTool({
+      name: MESSAGE_SUBAGENT_TOOL_NAME,
+      label: 'Message subagent',
+      description:
+        'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step.',
+      parameters: messageParameters,
+      exposure: 'model-only',
+      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
+        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
+        const id = params.id.trim()
+        const message = params.message.trim()
+        if (!message) throw new Error('message_subagent needs a non-empty message.')
+        const record = registry.get(id)
+        if (!record) throw new Error(unknownId(id, registry))
+        if (record.status === 'finished' || !registry.message(id, message))
+          throw new Error(
+            `Subagent ${id} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
+          )
+        return {
+          content: [text(`Message queued for subagent ${id}; it reads it after its current step.`)],
+          details: undefined
+        }
+      }
+    })
   }
   return { extension, controls }
 }
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -2,7 +2,7 @@
 
 import type { AgentRuntimeSession } from './session'
 import type { SubagentOutcome } from './subagent'
-import { type RunResult, runSubagent } from './subagentRun'
+import { type RunResult, type RunStart, runSubagent, type SubagentInbox } from './subagentRun'
 import type { AgentRuntimeEvent } from './transcriptTap'
 
 /** State entry of the parent: one snapshot per change of a subagent's run. */
@@ -67,9 +67,13 @@
 
 interface LiveRun {
   controller: AbortController
+  inbox: SubagentInbox
   /** Settles once the run's session is disposed and its end is recorded. */
   done: Promise<void>
 }
+
+/** Ids listed in status messages and errors (spec §5.4). */
+const LISTED = 20
 
 const snapshot = (record: SubagentRecord, result?: RunResult): SubagentState => ({
   sessionId: record.sessionId,
@@ -105,6 +109,16 @@
     return this.records.get(sessionId)
   }
 
+  /** The most recently active subagents first, at most 20. */
+  recent(): SubagentRecord[] {
+    return [...this.records.values()].reverse().slice(0, LISTED)
+  }
+
+  /** Queues `text` for a running subagent; false when its run has just ended. */
+  message(sessionId: string, text: string): boolean {
+    return this.live.get(sessionId)?.inbox.push(text) ?? false
+  }
+
   /** Background subagents running or waiting for an approval. */
   runningBackground(): number {
     let count = 0
@@ -139,8 +153,37 @@
       }))
   }
 
-  /** Runs `task` on `child` in the background; the parent's turn does not wait for it or stop it. */
-  startBackground(record: SubagentRecord, child: AgentRuntimeSession, task: string): void {
+  /**
+   * Runs a foreground subagent within the parent's call: `signal` (the call's) stops it. Its result
+   * is the call's, so nothing is written to the transcript.
+   */
+  async runForeground(
+    record: SubagentRecord,
+    child: AgentRuntimeSession,
+    start: RunStart,
+    inbox: SubagentInbox,
+    signal: AbortSignal | undefined
+  ): Promise<RunResult> {
+    this.track(record)
+    const controller = new AbortController()
+    const onAbort = () => controller.abort()
+    if (signal?.aborted) controller.abort()
+    else signal?.addEventListener('abort', onAbort, { once: true })
+    const run = runSubagent(child, start, controller.signal, inbox)
+    this.live.set(record.sessionId, { controller, inbox, done: run.then(() => undefined) })
+    try {
+      const result = await run
+      record.status = 'finished'
+      record.outcome = result.end
+      return result
+    } finally {
+      signal?.removeEventListener('abort', onAbort)
+      this.live.delete(record.sessionId)
+    }
+  }
+
+  /** Runs `child` in the background; the parent's turn does not wait for it or stop it. */
+  startBackground(record: SubagentRecord, child: AgentRuntimeSession, start: RunStart, inbox: SubagentInbox): void {
     if (this.closing) {
       void child.dispose()
       return
@@ -148,17 +191,17 @@
     record.background = true
     record.status = 'running'
     delete record.outcome
-    this.records.set(record.sessionId, record)
+    this.track(record)
     this.host.appendState(snapshot(record))
     this.changed()
     const controller = new AbortController()
-    const done = runSubagent(child, task, controller.signal).then((result) => {
+    const done = runSubagent(child, start, controller.signal, inbox).then((result) => {
       // Finished at once, so a message sent from now on continues the subagent instead of joining this run.
       record.status = 'finished'
       record.outcome = result.end
       return this.record(record, child, result)
     })
-    this.live.set(record.sessionId, { controller, done })
+    this.live.set(record.sessionId, { controller, inbox, done })
   }
 
   /** Session shutdown: stops every live run and disposes its session, writing nothing. */
@@ -176,11 +219,18 @@
     this.live.delete(record.sessionId)
     // Rebuilt from the transcript, a run whose last snapshot is `running` is interrupted.
     if (this.closing) return
+    this.track(record)
     this.host.appendState(snapshot(record, shortened))
     this.changed()
     this.host.finished(record, shortened)
   }
 
+  /** Adds `record` or moves it to the most recently active place. */
+  private track(record: SubagentRecord): void {
+    this.records.delete(record.sessionId)
+    this.records.set(record.sessionId, record)
+  }
+
   private changed(): void {
     this.host.emit({ type: 'subagents', subagents: this.views() })
   }
````

Apply to `packages/agent-runtime-pi/src/subagentRun.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRun.ts
+++ b/packages/agent-runtime-pi/src/subagentRun.ts
@@ -1,4 +1,5 @@
 import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
+import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
 import type { ToolCallPart } from 'ai'
 
 import type { AgentRuntimeSession } from './session'
@@ -11,6 +12,9 @@
 
 /** State entry naming the call that created a session; it marks a subagent's session. */
 export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'
+
+/** Custom message of a subagent's session: a message the parent sent it with `message_subagent`. */
+export const SUBAGENT_MESSAGE_TYPE = 'cherry.subagent-message'
 
 /** How one run of a subagent session ended, as the session itself saw it. */
 export type RunEnd = 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'
@@ -47,6 +51,61 @@
 }
 
 export type CreateSubagentSession = (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>
+
+/** How a run starts: with the task prompt (a new subagent) or with a message from the parent. */
+export type RunStart = { prompt: string } | { message: string }
+
+const messageOf = (text: string) => ({ customType: SUBAGENT_MESSAGE_TYPE, content: text, display: false })
+
+/**
+ * Messages for a running subagent. While its run goes on they are steered in, so it reads them
+ * after its current tool batch; once the run starts to settle they wait for the next run.
+ */
+export class SubagentInbox {
+  private pending: string[] = []
+  private send: ((text: string) => void) | undefined
+  private running: () => boolean = () => false
+  private holding = false
+  private closed = false
+
+  /** The subagent's own extension; it goes first among the session's extensions. */
+  readonly extension: ExtensionFactory = (pi) => {
+    this.send = (text) => pi.sendMessage(messageOf(text), { triggerTurn: true })
+    pi.on('session_start', (_event, ctx) => {
+      this.running = () => !ctx.isIdle()
+    })
+    pi.on('turn_start', () => {
+      this.holding = false
+      for (const text of this.take()) this.send!(text)
+    })
+    // A steer sent once Pi has decided to settle would stay unread in its queue.
+    pi.on('agent_before_settle', () => {
+      this.holding = true
+    })
+  }
+
+  /** False once the run has ended: the message must start a new run instead. */
+  push(text: string): boolean {
+    if (this.closed) return false
+    if (this.send && this.running() && !this.holding) this.send(text)
+    else this.pending.push(text)
+    return true
+  }
+
+  close(): void {
+    this.closed = true
+  }
+
+  hasPending(): boolean {
+    return this.pending.length > 0
+  }
+
+  take(): string[] {
+    const taken = this.pending
+    this.pending = []
+    return taken
+  }
+}
 
 const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'
 
@@ -105,6 +164,7 @@
   options: SubagentSessionOptions
   prefix: TranscriptEntry[]
   parentModelKey: string
+  inbox: SubagentInbox
   createSession: CreateSubagentSession
 }): Promise<AgentRuntimeSession> {
   const { subagent, options, prefix } = input
@@ -122,7 +182,7 @@
     sessionId: subagent.sessionId,
     transcript,
     fork: subagent.fork,
-    extensionFactories: options.extensionFactories ?? [],
+    extensionFactories: [input.inbox.extension, ...(options.extensionFactories ?? [])],
     onEvent: options.onEvent
   })
   try {
@@ -180,11 +240,25 @@
 const textOf = (message: AssistantMessage) =>
   message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
 
+/** Starts a run with the parent's messages and waits for it to settle. */
+async function runMessages(child: AgentRuntimeSession, texts: string[]): Promise<void> {
+  const [first, ...rest] = texts
+  const run = child.session.sendCustomMessage(messageOf(first), { triggerTurn: true })
+  // The run is live once the first message started it, so these are steered into it.
+  for (const text of rest) void child.session.sendCustomMessage(messageOf(text), { triggerTurn: true })
+  await run
+}
+
 /**
- * Runs `task` on the subagent's session until it settles. `signal` stops the run; the result carries
- * the final message (or the reason and last partial output) and the sum of the run's usage.
+ * Runs the subagent's session until it settles with its inbox empty. `signal` stops the run; the
+ * result carries the final message (or the reason and last partial output) and the run's usage.
  */
-export async function runSubagent(child: AgentRuntimeSession, task: string, signal: AbortSignal): Promise<RunResult> {
+export async function runSubagent(
+  child: AgentRuntimeSession,
+  start: RunStart,
+  signal: AbortSignal,
+  inbox: SubagentInbox
+): Promise<RunResult> {
   const { session } = child
   let stopped: 'aborted' | 'limit_reached' | undefined
   const stop = (reason: 'aborted' | 'limit_reached') => {
@@ -207,10 +281,16 @@
   let error: string | undefined
   try {
     if (signal.aborted) stop('aborted')
-    else await session.prompt(task, { expandPromptTemplates: false, source: 'extension' })
+    else if ('prompt' in start)
+      await session.prompt(start.prompt, { expandPromptTemplates: false, source: 'extension' })
+    else await runMessages(child, [start.message])
+    // Messages that came while the run settled start the next run on the same session.
+    while (!stopped && inbox.hasPending()) await runMessages(child, inbox.take())
   } catch (thrown) {
     error = thrown instanceof Error ? thrown.message : String(thrown)
   } finally {
+    // In the same tick as the last check, so no message slips in between.
+    inbox.close()
     unsubscribe()
     signal.removeEventListener('abort', onAbort)
   }
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): send messages to running subagents"
```

### Task 5: `stop_subagent`, the user's stop and quiet results

Spec: §4.4 (`stopSubagent`), §5.3, §7.1, §7.5, §9 (model and user rows), product default "用户停掉的子代理"

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentStop.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/session.ts`, `packages/agent-runtime-pi/tests/subagentFork.test.ts`

**Interfaces:**
- Consumes (Tasks 2–4): `SubagentRegistry`, `SubagentDelivery.enqueue`, `PendingDelivery.wake`.
- Produces: `SubagentRecord.stoppedBy?: SubagentStopper`; `SubagentState.stoppedBy?`; `SubagentRegistry.stop(sessionId, by: SubagentStopper): Promise<RunResult> | undefined` (resolves once the end is recorded); `RegistryHost.finished` is not called for a run the model stopped; `STOP_SUBAGENT_TOOL_NAME = 'stop_subagent'`; `SubagentControls.stopSubagent(sessionId): boolean`; `AgentRuntimeSession.stopSubagent(sessionId: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Spec §15 stop rows; the fork refusal now also covers `stop_subagent`.

Apply to `packages/agent-runtime-pi/tests/subagentFork.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentFork.test.ts
+++ b/packages/agent-runtime-pi/tests/subagentFork.test.ts
@@ -130,13 +130,14 @@
   })
 
   // Breaks when a fork can start or address subagents (it would manage its parent's subagents).
-  it('rejects subagent and message_subagent calls made inside a fork', async () => {
+  it('rejects subagent, message_subagent and stop_subagent calls made inside a fork', async () => {
     const { model, calls } = routedModel(({ userText, lastRole }) => {
       if (userText.includes('TASK-A'))
         return lastRole === 'user'
           ? [
               subagentCall('call_nested', { description: 'Nested', prompt: 'TASK-NESTED' }),
               toolCallPart('call_message', 'message_subagent', { id: 'any', message: 'hello' }),
+              toolCallPart('call_stop', 'stop_subagent', { id: 'any' }),
               finish('tool-calls')
             ]
           : [...textParts('r', 'REPORT-A'), finish('stop')]
@@ -150,10 +151,11 @@
     await session.prompt('Check module A')
 
     expect(host.subagents.map((subagent) => subagent.parentToolCallId)).toEqual(['call_a'])
-    const refused = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).slice(-2)
+    const refused = toolResults(calls.filter((call) => call.userText.includes('TASK-A'))[1]).slice(-3)
     expect(refused.map((part) => [part.toolCallId, outputText(part.output)])).toEqual([
       ['call_nested', 'Subagents cannot start or manage subagents.'],
-      ['call_message', 'Subagents cannot start or manage subagents.']
+      ['call_message', 'Subagents cannot start or manage subagents.'],
+      ['call_stop', 'Subagents cannot start or manage subagents.']
     ])
   })
 
````

Create `packages/agent-runtime-pi/tests/subagentStop.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const BG_B = { description: 'Check B', prompt: 'TASK-B', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** A subagent tool that waits until its run is stopped; `reached` resolves once it waits. */
function untilStopped() {
  const started = gate()
  const tool = defineTool({
    name: 'work',
    label: 'Work',
    description: 'Works until stopped',
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      void started.wait(undefined)
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return { content: [{ type: 'text', text: 'stopped working' }], details: undefined }
    }
  })
  return { tool, reached: started.reached }
}

describe('stopping subagents', () => {
  // Breaks when stop_subagent leaves the subagent running, loses its partial output, or is followed
  // by a notification that wakes the parent for a result it already has.
  it('stop_subagent stops a running subagent, returns its partial output and sends no notification', async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [...textParts('p', 'PARTIAL-A'), toolCallPart('work_1', 'work'), finish('tool-calls')]
          : reply('LATE-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: host.subagents[0].sessionId }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await work.reached

    await session.prompt('Stop A')
    await settle()

    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_stop'))).toBe(
      `Stopped subagent ${sessionId}. Partial output before it stopped:\nPARTIAL-A`
    )
    expect(subagentStates(parent.entries).at(-1)).toMatchObject({
      status: 'finished',
      outcome: 'stopped',
      stoppedBy: 'model'
    })
    expect(notified(calls)).toEqual([])
  })

  // Breaks when stopping a finished subagent is an error the model has to recover from, or claims a
  // stop that did not happen.
  it('stop_subagent tells the model a finished subagent is not running', async () => {
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: host.subagents[0].sessionId }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Stop A')

    const result = toolResultOf(session, 'call_stop')
    expect(result.isError).toBe(false)
    expect(textOf(result)).toBe(`Subagent ${host.subagents[0].sessionId} is not running (completed).`)
  })

  // Breaks when the user's stop wakes the idle parent, the parent never hears of it, or the stop
  // button reports a stop that did not happen.
  it("the user's stop wakes nothing; the parent hears of it with the user's next message", async () => {
    const work = untilStopped()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE-A')
      if (lastText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A in the background')
    await work.reached
    const { sessionId } = host.subagents[0]

    expect(runtime.stopSubagent(sessionId)).toBe(true)
    await waitFor(() => subagentStates(parent.entries).some((state) => state.stoppedBy === 'user'))
    await settle()
    expect(notified(calls)).toEqual([])
    expect(runtime.stopSubagent(sessionId)).toBe(false)
    expect(runtime.stopSubagent('not-a-subagent')).toBe(false)

    await runtime.prompt('Any news?')
    const tail = calls.at(-1)!.options.prompt.slice(-2)
    expect(tail.map((message) => (message.role === 'user' ? message.content : message.role))).toEqual([
      [{ type: 'text', text: 'Any news?' }],
      [{ type: 'text', text: `${NOTE}\n\n- "Check A" (id: ${sessionId}) was stopped by the user.` }]
    ])
  })

  // Breaks when a quiet result is held back from a notification that goes out anyway.
  it("the user's stop rides with the next notification", async () => {
    const work = untilStopped()
    const heldB = gate()
    const host = recordingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE-A')
      if (userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B'))
      if (lastText === 'Check A and B')
        return [subagentCall('call_a', BG_A), subagentCall('call_b', BG_B), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [work.tool],
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await runtime.prompt('Check A and B')
    await work.reached
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId

    runtime.stopSubagent(id('Check A'))
    await waitFor(() => subagentStates(parent.entries).some((state) => state.stoppedBy === 'user'))
    heldB.open()
    await waitFor(() => notified(calls).length === 1)

    expect(notified(calls)[0].lastText).toBe(
      `${NOTE}\n\n- "Check A" (id: ${id('Check A')}) was stopped by the user.\n- "Check B" (id: ${id('Check B')}) completed:\n  REPORT-B`
    )
  })

  // Breaks when the host's background-task stop button can stop a foreground subagent mid-call.
  it("the user's stop does not reach a foreground subagent", async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const runtime: { stopSubagent?: (id: string) => boolean } = {}
    let stopped: boolean | undefined
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) {
        stopped = runtime.stopSubagent!(host.subagents[0].sessionId)
        return held.wait(reply('REPORT-A'))
      }
      if (lastText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      return reply('OK.')
    })
    const created = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    runtime.stopSubagent = created.stopSubagent
    const run = created.prompt('Check A')
    await held.reached
    held.open()
    await run

    expect(stopped).toBe(false)
    expect(textOf(toolResultOf(created.session, 'call_a'))).toMatch(/^REPORT-A/)
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts`

Expected: FAIL. `subagentStop.test.ts` fails: `stop_subagent` is not found and `runtime.stopSubagent` is not a function; the fork test's third call (`stop_subagent`) gets `Tool stop_subagent not found`.

- [ ] **Step 3: Implement**

A stopped run ends `stopped` with `stoppedBy`; the model's stop sends no notification, the user's goes in as a quiet item (`wake: false`) that only rides with the next message. The controls now reach the registry and delivery of the main session only (`main`), never a fork's copy.

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -96,6 +96,8 @@
   prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>
   /** `session.compact`, for every manual compaction the host starts, for the same reason. */
   compact(customInstructions?: string): Promise<void>
+  /** The user stops a background subagent (the host's stop button); false when it is not running. */
+  stopSubagent(sessionId: string): boolean
 }
 
 /**
@@ -224,6 +226,7 @@
     session,
     prompt: (text, promptOptions) => held(() => session.prompt(text, promptOptions)),
     compact: (customInstructions) => held(() => session.compact(customInstructions)),
+    stopSubagent: (sessionId) => subagents?.controls.stopSubagent(sessionId) ?? false,
     async dispose() {
       try {
         await session.abort()
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -31,6 +31,7 @@
 /** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
 export const SUBAGENT_TOOL_NAME = 'subagent'
 export const MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'
+export const STOP_SUBAGENT_TOOL_NAME = 'stop_subagent'
 
 /** True inside a subagent's session. */
 export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
@@ -105,6 +106,8 @@
 export interface SubagentControls {
   /** Held by a host prompt or compaction until it returns; no notification starts a run meanwhile. */
   hold(): () => void
+  /** The user stops a background subagent; false when it is not running. */
+  stopSubagent(sessionId: string): boolean
 }
 
 const DESCRIPTION = [
@@ -142,11 +145,17 @@
 
 const IN_SUBAGENT = 'Subagents cannot start or manage subagents.'
 
+const STOPPED_BY: Record<SubagentStopper, string> = {
+  model: 'stopped by you',
+  user: 'stopped by the user',
+  budget: "stopped because the goal's budget is used up"
+}
+
 /** A subagent's state in the words lists of subagents use. */
 function statusText(record: SubagentRecord): string {
   if (record.status === 'running') return 'running'
   if (record.status === 'awaiting_approval') return 'waiting for a tool approval'
-  return record.outcome!
+  return record.stoppedBy ? STOPPED_BY[record.stoppedBy] : record.outcome!
 }
 
 function unknownId(id: string, registry: SubagentRegistry): string {
@@ -199,8 +208,13 @@
   emit,
   offload
 }: SubagentToolOptions): { extension: ExtensionFactory; controls: SubagentControls } {
-  let delivery: SubagentDelivery | undefined
-  const controls: SubagentControls = { hold: () => delivery?.hold() ?? (() => {}) }
+  // Set once the main session starts; a fork's copy of this extension stays unreachable.
+  let main: { registry: SubagentRegistry; delivery: SubagentDelivery } | undefined
+  const controls: SubagentControls = {
+    hold: () => main?.delivery.hold() ?? (() => {}),
+    stopSubagent: (sessionId) =>
+      main?.registry.get(sessionId)?.background === true && main.registry.stop(sessionId, 'user') !== undefined
+  }
   const extension: ExtensionFactory = (pi) => {
     let ctx: ExtensionContext | undefined
     let inSubagent = false
@@ -211,19 +225,21 @@
       shorten: (record, result) =>
         shortenResult(result, offload, { toolCallId: record.parentToolCallId, toolName: SUBAGENT_TOOL_NAME }),
       finished: (record, result) =>
-        delivery?.enqueue({
+        delivery.enqueue({
           sessionId: record.sessionId,
           run: record.run,
           description: record.description,
           outcome: record.outcome!,
+          ...(record.stoppedBy === undefined ? {} : { stoppedBy: record.stoppedBy }),
           ...(result.report === undefined ? {} : { report: result.report }),
           ...(result.reason === undefined ? {} : { reason: result.reason }),
           ...(result.partial === undefined ? {} : { partial: result.partial }),
           usage: result.usage,
-          wake: true
+          // The user only needs the parent to know; that is no reason to start a turn.
+          wake: record.stoppedBy !== 'user'
         })
     })
-    const parentDelivery = new SubagentDelivery({
+    const delivery = new SubagentDelivery({
       startTurn: (message) => pi.sendMessage(message, { triggerTurn: true }),
       isIdle: () => ctx?.isIdle() ?? false,
       stillRunning: () => registry.runningBackground()
@@ -234,15 +250,15 @@
       inSubagent = isSubagentSession(context.sessionManager.getBranch())
       if (inSubagent) return
       ctx = context
-      delivery = parentDelivery
-    })
-    pi.on('agent_before_settle', (event) => (inSubagent ? undefined : parentDelivery.beforeSettle(event)))
+      main = { registry, delivery }
+    })
+    pi.on('agent_before_settle', (event) => (inSubagent ? undefined : delivery.beforeSettle(event)))
     pi.on('agent_settled', (event) => {
-      if (!inSubagent) parentDelivery.settled(event.aborted)
-    })
-    pi.on('before_agent_start', () => (inSubagent ? undefined : parentDelivery.beforeAgentStart()))
+      if (!inSubagent) delivery.settled(event.aborted)
+    })
+    pi.on('before_agent_start', () => (inSubagent ? undefined : delivery.beforeAgentStart()))
     pi.on('session_shutdown', () => {
-      parentDelivery.close()
+      delivery.close()
       return registry.close()
     })
 
@@ -339,6 +355,36 @@
         }
       }
     })
+
+    pi.registerTool({
+      name: STOP_SUBAGENT_TOOL_NAME,
+      label: 'Stop subagent',
+      description:
+        'Stop a running subagent by its id and get its partial output. You get no notification for it afterwards; message_subagent can continue it later.',
+      parameters: Type.Object({ id: Type.String({ description: 'The id a subagent result or notification gave.' }) }),
+      exposure: 'model-only',
+      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
+        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
+        const id = params.id.trim()
+        const record = registry.get(id)
+        if (!record) throw new Error(unknownId(id, registry))
+        const stopped = registry.stop(id, 'model')
+        if (!stopped)
+          return { content: [text(`Subagent ${id} is not running (${statusText(record)}).`)], details: undefined }
+        const result = await stopped
+        const partial = result.partial ?? result.report
+        return {
+          content: [
+            text(
+              partial
+                ? `Stopped subagent ${id}. Partial output before it stopped:\n${partial}`
+                : `Stopped subagent ${id}.`
+            )
+          ],
+          details: undefined
+        }
+      }
+    })
   }
   return { extension, controls }
 }
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -1,7 +1,7 @@
 import type { Usage } from '@earendil-works/pi-ai'
 
 import type { AgentRuntimeSession } from './session'
-import type { SubagentOutcome } from './subagent'
+import type { SubagentOutcome, SubagentStopper } from './subagent'
 import { type RunResult, type RunStart, runSubagent, type SubagentInbox } from './subagentRun'
 import type { AgentRuntimeEvent } from './transcriptTap'
 
@@ -26,6 +26,8 @@
   run: number
   status: SubagentStatus
   outcome?: SubagentOutcome
+  /** Set when the latest run was stopped. */
+  stoppedBy?: SubagentStopper
 }
 
 /** Data of a `cherry.subagent-state` entry. */
@@ -39,6 +41,7 @@
   run: number
   status: 'running' | 'finished'
   outcome?: SubagentOutcome
+  stoppedBy?: SubagentStopper
   report?: string
   reason?: string
   partial?: string
@@ -61,15 +64,15 @@
   maxBackground: number
   /** Shortens a finished run's texts for the snapshot and the notification. */
   shorten(record: SubagentRecord, result: RunResult): Promise<RunResult>
-  /** A background run ended and its snapshot is written. */
+  /** A background run ended and its snapshot is written; not called for runs the model stopped. */
   finished(record: SubagentRecord, result: RunResult): void
 }
 
 interface LiveRun {
   controller: AbortController
   inbox: SubagentInbox
-  /** Settles once the run's session is disposed and its end is recorded. */
-  done: Promise<void>
+  /** Settles with the run's result once its session is disposed and its end is recorded. */
+  done: Promise<RunResult>
 }
 
 /** Ids listed in status messages and errors (spec §5.4). */
@@ -85,6 +88,7 @@
   run: record.run,
   status: record.status === 'finished' ? 'finished' : 'running',
   ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
+  ...(record.stoppedBy === undefined ? {} : { stoppedBy: record.stoppedBy }),
   ...(result === undefined
     ? {}
     : {
@@ -112,6 +116,16 @@
   /** The most recently active subagents first, at most 20. */
   recent(): SubagentRecord[] {
     return [...this.records.values()].reverse().slice(0, LISTED)
+  }
+
+  /** Stops a running subagent; resolves with its run's result once its end is recorded. */
+  stop(sessionId: string, by: SubagentStopper): Promise<RunResult> | undefined {
+    const run = this.live.get(sessionId)
+    const record = this.records.get(sessionId)
+    if (!run || !record || record.status === 'finished') return undefined
+    record.stoppedBy = by
+    run.controller.abort()
+    return run.done
   }
 
   /** Queues `text` for a running subagent; false when its run has just ended. */
@@ -170,11 +184,10 @@
     if (signal?.aborted) controller.abort()
     else signal?.addEventListener('abort', onAbort, { once: true })
     const run = runSubagent(child, start, controller.signal, inbox)
-    this.live.set(record.sessionId, { controller, inbox, done: run.then(() => undefined) })
+    this.live.set(record.sessionId, { controller, inbox, done: run })
     try {
       const result = await run
-      record.status = 'finished'
-      record.outcome = result.end
+      this.end(record, result)
       return result
     } finally {
       signal?.removeEventListener('abort', onAbort)
@@ -191,15 +204,16 @@
     record.background = true
     record.status = 'running'
     delete record.outcome
+    delete record.stoppedBy
     this.track(record)
     this.host.appendState(snapshot(record))
     this.changed()
     const controller = new AbortController()
-    const done = runSubagent(child, start, controller.signal, inbox).then((result) => {
+    const done = runSubagent(child, start, controller.signal, inbox).then(async (result) => {
       // Finished at once, so a message sent from now on continues the subagent instead of joining this run.
-      record.status = 'finished'
-      record.outcome = result.end
-      return this.record(record, child, result)
+      this.end(record, result)
+      await this.record(record, child, result)
+      return result
     })
     this.live.set(record.sessionId, { controller, inbox, done })
   }
@@ -222,7 +236,13 @@
     this.track(record)
     this.host.appendState(snapshot(record, shortened))
     this.changed()
-    this.host.finished(record, shortened)
+    // The model that stopped it has its partial output from stop_subagent already.
+    if (record.stoppedBy !== 'model') this.host.finished(record, shortened)
+  }
+
+  private end(record: SubagentRecord, result: RunResult): void {
+    record.status = 'finished'
+    record.outcome = record.stoppedBy ? 'stopped' : result.end
   }
 
   /** Adds `record` or moves it to the most recently active place. */
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentFork.test.ts packages/agent-runtime-pi/tests/subagentStop.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): stop subagents from the model and from the user"
```

### Task 6: Continuing a finished subagent from its stored transcript

Spec: §4.4 (`load`, `continuedBy`, `modelKey`), §5.2 (finished rows), §8.1–§8.3, §8.5, D4

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentContinue.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRun.ts`, `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/tests/subagentSupport.ts`

**Interfaces:**
- Consumes (Tasks 1–5): `openChild`, `SubagentInbox`, `SubagentRegistry.startBackground`/`reserveBackground`/`message`, `SubagentRecord.stoppedBy`.
- Produces: `SubagentPort.load?(sessionId: string): Promise<readonly TranscriptEntry[] | undefined>`; `Subagent.continuedBy?: string`, `Subagent.modelKey?: string`; `readOrigin(entries): SubagentOrigin | undefined`; `answerInterrupted(entries): TranscriptMessageEntry[]`; `openChild(input: { subagent; options; transcript: TranscriptEntry[]; handOff: TranscriptEntry[]; inbox; createSession })` (replaces `prefix`/`parentModelKey`; callers build the origin entry); `SubagentRegistry.recorded(sessionId): Promise<void>`, `startingRun(sessionId): Promise<unknown> | undefined`, `startRun<T>(sessionId, start: () => Promise<T>): Promise<T>`.
- Test helpers: `storingSubagentPort(extra?)` → `{ port, transcripts: Map<string, TranscriptEntry[]>, subagents, events, sessions }` (stores each child's emitted entries per `sessionId` and implements `load`); `RoutedCall.humanText`.

- [ ] **Step 1: Write the failing tests**

Spec §15 continuation rows plus Review Focus 1 (a failed `load` frees its slot), 2 (two messages in one step) and 5 (dispose during a continuation).

Create `packages/agent-runtime-pi/tests/subagentContinue.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { TranscriptEntry } from '../src'
import {
  gate,
  outputText,
  type RoutedCall,
  routedModel,
  storingSubagentPort,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, MODEL, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))
const message = (toolCallId: string, id: string, text: string) => [
  toolCallPart(toolCallId, 'message_subagent', { id, message: text }),
  finish('tool-calls')
]

describe('continuing a finished subagent', () => {
  // Breaks when a continuation starts from an empty context instead of the stored transcript, runs
  // in the foreground, sends no notification, or gives the host other settings than the first run.
  it('continues it in the background from its stored transcript and notifies the parent', async () => {
    const host = storingSubagentPort()
    const parent = hostStore()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'ALSO-CHECK-C' ? 'REPORT-C' : 'REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask A to check C') return message('call_msg', host.subagents[0].sessionId, 'ALSO-CHECK-C')
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A')
    await session.prompt('Ask A to check C')
    await waitFor(() => notified(calls).length === 1)

    const { sessionId } = host.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${sessionId} resumed in the background with your message; you will be notified when it finishes.`
    )
    const resumed = calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!
    expect(resumed.lastText).toBe('ALSO-CHECK-C')
    expect(resumed.options.prompt.some((entry) => JSON.stringify(entry).includes('REPORT-A'))).toBe(true)
    expect(host.subagents[1]).toEqual({
      parentToolCallId: 'call_a',
      continuedBy: 'call_msg',
      sessionId,
      description: 'Check A',
      fork: false,
      background: true,
      modelKey: MODEL.key
    })
    expect(subagentStates(parent.entries).map((state) => [state.run, state.status])).toEqual([
      [2, 'running'],
      [2, 'finished']
    ])
    expect(notified(calls)[0].lastText).toBe(`${NOTE}\n\n- "Check A" (id: ${sessionId}) completed:\n  REPORT-C`)
    const stored = host.transcripts.get(sessionId)!
    expect(stored.filter((entry) => entry.kind === 'state' && entry.type === 'cherry.subagent-origin')).toHaveLength(1)
    expect(new Set(stored.map((entry) => entry.id)).size).toBe(stored.length)
  })

  // Breaks when stop_subagent ends a subagent for good, or a subagent the user stopped can be revived.
  it('continues a subagent the model stopped but refuses one the user stopped', async () => {
    const work = gate()
    const workTool = defineTool({
      name: 'work',
      label: 'Work',
      description: 'Works until stopped',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void work.wait(undefined)
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped working' }], details: undefined }
      }
    })
    const host = storingSubagentPort()
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-')) {
        if (lastText === 'GO-ON') return reply('RESUMED')
        return lastText.includes('TASK-') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('LATE')
      }
      // B's stop by the user rides with this prompt as a notification after it.
      if (humanText === 'Go on with A and B')
        return [
          toolCallPart('msg_a', 'message_subagent', { id: id('Check A'), message: 'GO-ON' }),
          toolCallPart('msg_b', 'message_subagent', { id: id('Check B'), message: 'GO-ON' }),
          finish('tool-calls')
        ]
      if (lastText === 'Start A and B')
        return [
          subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A', background: true }),
          subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B', background: true }),
          finish('tool-calls')
        ]
      if (lastText === 'Stop A')
        return [toolCallPart('call_stop', 'stop_subagent', { id: id('Check A') }), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [workTool],
      subagents: host.port
    })
    await runtime.prompt('Start A and B')
    await work.reached
    await waitFor(
      () => calls.filter((call) => call.lastRole === 'user' && call.userText.includes('TASK-')).length === 2
    )
    await runtime.prompt('Stop A')
    expect(runtime.stopSubagent(id('Check B'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    await runtime.prompt('Go on with A and B')

    expect(textOf(toolResultOf(runtime.session, 'msg_a'))).toMatch(/^Subagent .* resumed in the background/)
    const refused = toolResultOf(runtime.session, 'msg_b')
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(
      `Subagent ${id('Check B')} was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.`
    )
    await waitFor(() => notified(calls).some((call) => call.lastText.includes('RESUMED')))
  })

  // Breaks when a call the interrupted run left open is left for Pi to answer as a plain failure,
  // when the answer is not stored by the host, or when the subagent gets no warning to check first.
  it('answers the calls an interrupted run left open and tells the subagent to check before going on', async () => {
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'work',
      label: 'Work',
      description: 'Works until the turn stops',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A') ? [toolCallPart('work_1', 'work'), finish('tool-calls')] : reply('REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Go on with A') return message('call_msg', host.subagents[0].sessionId, 'GO-ON')
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port
    })
    parent.session = runtime.session
    await runtime.prompt('Check A')
    expect(toolResultOf(runtime.session, 'call_a').details).toMatchObject({ outcome: 'aborted' })
    // What the host holds when the app closed while `work` ran: the reply with the call, no result.
    const { sessionId } = host.subagents[0]
    const stored = host.transcripts.get(sessionId)!
    const cut = stored.findIndex((entry) => entry.kind === 'message' && entry.message.role === 'assistant')
    stored.splice(cut + 1)

    await runtime.prompt('Go on with A')
    await waitFor(() => notified(calls).length === 1)

    const resumed = calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!
    const [answer] = toolResults(resumed)
    expect(answer.toolCallId).toBe('work_1')
    expect(answer.output.type).toBe('error-text')
    expect(outputText(answer.output)).toBe(
      'This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.'
    )
    expect(resumed.lastText).toBe(
      'Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.\n\nGO-ON'
    )
    expect(
      stored.filter((entry: TranscriptEntry) => entry.kind === 'message' && entry.message.role === 'tool')
    ).toHaveLength(1)
  })

  // Breaks when one conversation can address another conversation's subagent by its id.
  it("refuses another conversation's subagent", async () => {
    const host = storingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask their A') return message('call_msg', host.subagents[0].sessionId, 'hello')
      return reply('OK.')
    })
    const first = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    const second = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await first.prompt('Check A')
    await second.prompt('Ask their A')

    expect(textOf(toolResultOf(second.session, 'call_msg'))).toBe(
      `No subagent with id ${host.subagents[0].sessionId} in this conversation.`
    )
  })

  // Breaks when a missing transcript lets a continuation start from nothing, or the failed
  // continuation keeps its background slot (review focus: the cap would fill with failures).
  it('fails when the host cannot load the transcript, and frees the slot', async () => {
    const host = storingSubagentPort()
    const { model } = routedModel(({ userText, lastText }) => {
      if (userText.includes('TASK-')) return reply('REPORT')
      if (lastText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (lastText === 'Ask A again') return message('call_msg', host.subagents[0].sessionId, 'again')
      if (lastText === 'Check B in the background')
        return [
          subagentCall('call_b', { description: 'Check B', prompt: 'TASK-B', background: true }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: { ...host.port, maxBackground: 1 }
    })
    await session.prompt('Check A')
    host.transcripts.delete(host.subagents[0].sessionId)
    await session.prompt('Ask A again')

    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `Subagent ${host.subagents[0].sessionId} cannot be continued: its transcript is not available.`
    )
    await session.prompt('Check B in the background')
    expect(textOf(toolResultOf(session, 'call_b'))).toMatch(/^Subagent started in the background/)
  })

  // Review focus 2. Breaks when two messages of one step to a finished subagent start two runs of
  // one session instead of one continuation that reads both.
  it('sends two messages of one step to a single continuation', async () => {
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A')) return reply(userText.includes('MSG-2') ? 'REPORT-BOTH' : 'REPORT-A')
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (humanText === 'Tell A two things') {
        const id = host.subagents[0].sessionId
        return [
          toolCallPart('msg_1', 'message_subagent', { id, message: 'MSG-1' }),
          toolCallPart('msg_2', 'message_subagent', { id, message: 'MSG-2' }),
          finish('tool-calls')
        ]
      }
      return reply(lastText.startsWith(NOTE) ? 'Read it.' : 'OK.')
    })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Check A')
    await session.prompt('Tell A two things')
    await waitFor(() => notified(calls).length === 1)

    expect(host.subagents).toHaveLength(2)
    expect([textOf(toolResultOf(session, 'msg_1')), textOf(toolResultOf(session, 'msg_2'))]).toEqual([
      expect.stringMatching(/resumed in the background/),
      expect.stringMatching(/^Message queued for subagent/)
    ])
    expect(notified(calls)[0].lastText).toContain('REPORT-BOTH')
  })

  // Review focus 5. Breaks when a continuation still loading as the parent is disposed leaves its
  // subagent session running.
  it('leaves no subagent running when the parent is disposed during a continuation', async () => {
    let shutdowns = 0
    const loading = gate()
    const host = storingSubagentPort(() => ({
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', () => void shutdowns++)
        }
      ]
    }))
    const load = host.port.load!
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      if (humanText === 'Go on with A') return message('call_msg', host.subagents[0].sessionId, 'GO-ON')
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: { ...host.port, load: (id) => loading.wait(undefined).then(() => load(id)) }
    })
    await runtime.prompt('Check A')
    const turn = runtime.prompt('Go on with A')
    await loading.reached

    const disposed = runtime.dispose()
    loading.open()
    await disposed
    await turn.catch(() => undefined)

    expect(host.subagents).toHaveLength(2)
    expect(shutdowns).toBe(2)
  })
})
````

Apply to `packages/agent-runtime-pi/tests/subagentSupport.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/subagentSupport.ts
+++ b/packages/agent-runtime-pi/tests/subagentSupport.ts
@@ -22,7 +22,20 @@
   userText: string
   /** Text of the last prompt message when it is a user message (a prompt or a notification). */
   lastText: string
+  /**
+   * Text of the person's message that starts this request, also when a notification rides after it;
+   * '' for a request after tool results or one a notification starts.
+   */
+  humanText: string
   options: LanguageModelV3CallOptions
+}
+
+const NOTIFICATION_HEAD = 'Background subagent update'
+
+function humanTextOf(prompt: LanguageModelV3Message[]): string {
+  const trailing: string[] = []
+  for (let i = prompt.length - 1; i >= 0 && prompt[i].role === 'user'; i--) trailing.unshift(userTextOf(prompt[i]))
+  return trailing.find((text) => !text.startsWith(NOTIFICATION_HEAD)) ?? ''
 }
 
 const userTextOf = (message: LanguageModelV3Message) =>
@@ -44,6 +57,7 @@
         lastRole: last?.role ?? '',
         userText: options.prompt.map(userTextOf).join('\n'),
         lastText: last ? userTextOf(last) : '',
+        humanText: humanTextOf(options.prompt),
         options
       }
       calls.push(call)
@@ -116,6 +130,33 @@
   return { port, subagents, events, sessions }
 }
 
+/**
+ * A host port that also stores every subagent's transcript, as the host persists it (JSON copies,
+ * appended per `sessionId` across runs), and loads it back to continue the subagent.
+ */
+export function storingSubagentPort(
+  extra: (subagent: Subagent) => SubagentSessionOptions | Promise<SubagentSessionOptions> = () => ({})
+) {
+  const recording = recordingSubagentPort(extra)
+  const transcripts = new Map<string, TranscriptEntry[]>()
+  const port: SubagentPort = {
+    async configure(subagent) {
+      const options = await recording.port.configure(subagent)
+      const stored = transcripts.get(subagent.sessionId) ?? []
+      transcripts.set(subagent.sessionId, stored)
+      return {
+        ...options,
+        onEvent: (event) => {
+          if (event.type === 'transcript-append') stored.push(...JSON.parse(JSON.stringify(event.entries)))
+          options.onEvent?.(event)
+        }
+      }
+    },
+    load: async (sessionId) => transcripts.get(sessionId)
+  }
+  return { ...recording, port, transcripts }
+}
+
 /** Tool results in a call's prompt, in order. */
 export function toolResults(call: RoutedCall) {
   return call.options.prompt
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts`

Expected: FAIL. `subagentContinue.test.ts` fails: every message to a finished subagent is refused with `… has finished and this app cannot continue finished subagents …`, because nothing uses `load` yet.

- [ ] **Step 3: Implement**

A continuation reconfigures the same subagent (`continuedBy`, origin `modelKey`), hands the host the answers to calls the last run left open (Spec amendment 4), and starts in the background with the message, after the recovery hint when the last run was `interrupted` or `aborted`. A per-subagent start lock sends a second message of the same step to the new run.

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -14,10 +14,13 @@
 import { shortenResult, SubagentDelivery } from './subagentDelivery'
 import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, type SubagentRecord, SubagentRegistry } from './subagentRegistry'
 import {
+  answerInterrupted,
   type CreateSubagentSession,
   forkTranscript,
   MAX_SUBAGENT_REQUESTS,
   openChild,
+  originEntry,
+  readOrigin,
   type RunEnd,
   type RunResult,
   SUBAGENT_ORIGIN_STATE,
@@ -41,24 +44,34 @@
 /** Host side of `subagent`: gives each subagent its extensions and listeners. */
 export interface SubagentPort {
   /**
-   * Called once per subagent, before its session is built. A throw fails the call. For a fork,
+   * Called before a subagent's session is built: once when it starts and again for each
+   * continuation, which must get the same extensions. A throw fails the call. For a fork,
    * `extensionFactories` must yield the parent's tools: the same tools, in the same order.
    */
   configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
+  /**
+   * The stored transcript of a finished subagent (everything its `onEvent` received), to continue
+   * it. Without it, finished subagents cannot be continued.
+   */
+  load?(sessionId: string): Promise<readonly TranscriptEntry[] | undefined>
   /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
   maxBackground?: number
 }
 
-/** The subagent about to be created. */
+/** The subagent about to be created or continued. */
 export interface Subagent {
-  /** The `subagent` call that creates it. */
+  /** The `subagent` call that created it. */
   parentToolCallId: string
+  /** When it is continued: the `message_subagent` call that starts this run. */
+  continuedBy?: string
   /** Its Pi session id, its requests' `sessionId` and the id the model sees: a random UUID. */
   sessionId: string
   description: string
   fork: boolean
-  /** Whether this run is in the background. */
+  /** Whether this run is in the background; a continuation always is. */
   background: boolean
+  /** When it is continued: the model its first run used, from its origin entry. */
+  modelKey?: string
 }
 
 /** The session options the host gives each subagent; everything else comes from the parent. */
@@ -144,6 +157,8 @@
 }
 
 const IN_SUBAGENT = 'Subagents cannot start or manage subagents.'
+const RECOVERY_HINT =
+  'Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.'
 
 const STOPPED_BY: Record<SubagentStopper, string> = {
   model: 'stopped by you',
@@ -291,7 +306,9 @@
           const options = await port.configure(subagent)
           // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
           if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
-          child = await openChild({ subagent, options, prefix, parentModelKey, inbox, createSession })
+          const origin = originEntry({ parentToolCallId: toolCallId, fork, description, modelKey: parentModelKey })
+          const start = [...prefix, origin]
+          child = await openChild({ subagent, options, transcript: start, handOff: start, inbox, createSession })
         } finally {
           release()
         }
@@ -331,6 +348,54 @@
       }
     })
 
+    /** A finished subagent's next run, in the background, from the transcript the host stored. */
+    const continueSubagent = async (record: SubagentRecord, message: string, toolCallId: string) => {
+      const id = record.sessionId
+      const release = registry.reserveBackground()
+      const inbox = new SubagentInbox()
+      let child: AgentRuntimeSession
+      try {
+        const stored = await port.load!(id)
+        const origin = stored && readOrigin(stored)
+        if (!stored || !origin) throw new Error(`Subagent ${id} cannot be continued: its transcript is not available.`)
+        const subagent: Subagent = {
+          parentToolCallId: origin.parentToolCallId,
+          continuedBy: toolCallId,
+          sessionId: id,
+          description: origin.description,
+          fork: origin.fork,
+          background: true,
+          modelKey: origin.modelKey
+        }
+        const options = await port.configure(subagent)
+        const answers = answerInterrupted(stored)
+        child = await openChild({
+          subagent,
+          options,
+          transcript: [...stored, ...answers],
+          handOff: answers,
+          inbox,
+          createSession
+        })
+      } finally {
+        release()
+      }
+      const interrupted = record.outcome === 'interrupted' || record.outcome === 'aborted'
+      record.run++
+      registry.startBackground(
+        record,
+        child,
+        { message: interrupted ? `${RECOVERY_HINT}\n\n${message}` : message },
+        inbox
+      )
+      return {
+        content: [
+          text(`Subagent ${id} resumed in the background with your message; you will be notified when it finishes.`)
+        ],
+        details: undefined
+      }
+    }
+
     pi.registerTool({
       name: MESSAGE_SUBAGENT_TOOL_NAME,
       label: 'Message subagent',
@@ -338,21 +403,34 @@
         'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step.',
       parameters: messageParameters,
       exposure: 'model-only',
-      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
+      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
         if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
         const id = params.id.trim()
         const message = params.message.trim()
         if (!message) throw new Error('message_subagent needs a non-empty message.')
         const record = registry.get(id)
         if (!record) throw new Error(unknownId(id, registry))
-        if (record.status === 'finished' || !registry.message(id, message))
-          throw new Error(
-            `Subagent ${id} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
-          )
-        return {
-          content: [text(`Message queued for subagent ${id}; it reads it after its current step.`)],
-          details: undefined
-        }
+        // Another message may be continuing it right now; this one then goes to that run.
+        for (let starting = registry.startingRun(id); starting; starting = registry.startingRun(id))
+          await starting.catch(() => undefined)
+        if (record.status !== 'finished' && registry.message(id, message))
+          return {
+            content: [text(`Message queued for subagent ${id}; it reads it after its current step.`)],
+            details: undefined
+          }
+        return registry.startRun(id, async () => {
+          // A run that has just ended is recorded before the next one starts.
+          await registry.recorded(id)
+          if (record.stoppedBy === 'user')
+            throw new Error(
+              `Subagent ${id} was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.`
+            )
+          if (!port.load)
+            throw new Error(
+              `Subagent ${id} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
+            )
+          return continueSubagent(record, message, toolCallId)
+        })
       }
     })
 
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -105,6 +105,8 @@
   private readonly live = new Map<string, LiveRun>()
   /** Background launches past the cap check that have not started yet. */
   private launching = 0
+  /** Continuations being set up, by subagent. */
+  private readonly starting = new Map<string, Promise<unknown>>()
   private closing = false
 
   constructor(private readonly host: RegistryHost) {}
@@ -126,6 +128,23 @@
     record.stoppedBy = by
     run.controller.abort()
     return run.done
+  }
+
+  /** Resolves once the latest run of the subagent is over and recorded. */
+  async recorded(sessionId: string): Promise<void> {
+    await this.live.get(sessionId)?.done
+  }
+
+  /** The continuation of the subagent being set up, if any. */
+  startingRun(sessionId: string): Promise<unknown> | undefined {
+    return this.starting.get(sessionId)
+  }
+
+  /** Sets up the subagent's next run; until it is set up, other messages to it wait. */
+  startRun<T>(sessionId: string, start: () => Promise<T>): Promise<T> {
+    const started = start().finally(() => this.starting.delete(sessionId))
+    this.starting.set(sessionId, started)
+    return started
   }
 
   /** Queues `text` for a running subagent; false when its run has just ended. */
````

Apply to `packages/agent-runtime-pi/src/subagentRun.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRun.ts
+++ b/packages/agent-runtime-pi/src/subagentRun.ts
@@ -1,3 +1,5 @@
+import { randomUUID } from 'node:crypto'
+
 import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
 import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
 import type { ToolCallPart } from 'ai'
@@ -147,6 +149,53 @@
   return [...entries.slice(0, index + 1), ...placeholders]
 }
 
+const INTERRUPTED =
+  'This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.'
+
+/** The origin entry of a stored subagent transcript. */
+export function readOrigin(entries: readonly TranscriptEntry[]): SubagentOrigin | undefined {
+  const entry = entries.find((candidate) => candidate.kind === 'state' && candidate.type === SUBAGENT_ORIGIN_STATE)
+  return entry?.kind === 'state' ? (entry.data as unknown as SubagentOrigin) : undefined
+}
+
+/**
+ * Results for the calls of the transcript's last reply that never got one (the app closed while
+ * they ran). Pi would answer them itself, as if the call had failed for no reason.
+ */
+export function answerInterrupted(entries: readonly TranscriptEntry[]): TranscriptMessageEntry[] {
+  const index = entries.findLastIndex((entry) => entry.kind === 'message' && entry.message.role === 'assistant')
+  const reply = entries[index]
+  // Pi leaves failed and aborted replies out of requests, and their calls with them.
+  if (index < 0 || reply.kind !== 'message' || reply.stopReason === 'error' || reply.stopReason === 'aborted') return []
+  const answered = new Set(
+    entries
+      .slice(index + 1)
+      .flatMap((entry) =>
+        entry.kind === 'message' && entry.message.role === 'tool'
+          ? entry.message.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : []))
+          : []
+      )
+  )
+  return toolCallsOf(reply)
+    .filter((call) => !answered.has(call.toolCallId))
+    .map((call) => ({
+      id: randomUUID(),
+      timestamp: Date.now(),
+      kind: 'message',
+      message: {
+        role: 'tool',
+        content: [
+          {
+            type: 'tool-result',
+            toolCallId: call.toolCallId,
+            toolName: call.toolName,
+            output: { type: 'error-text', value: INTERRUPTED }
+          }
+        ]
+      }
+    }))
+}
+
 export const originEntry = (origin: SubagentOrigin): TranscriptStateEntry => ({
   id: `subagent-origin-${origin.parentToolCallId}`,
   timestamp: Date.now(),
@@ -156,28 +205,22 @@
 })
 
 /**
- * Configures and builds the session of a new subagent. Its start entries (the fork prefix and the
- * origin entry) go to the host's `onEvent` first, so the host stores the whole transcript.
+ * Builds a subagent's session. The entries the host has not stored yet (a new subagent's fork
+ * prefix and origin entry, a continuation's answers to interrupted calls) go to its `onEvent` first,
+ * so the host's copy is the whole transcript.
  */
 export async function openChild(input: {
   subagent: Subagent
   options: SubagentSessionOptions
-  prefix: TranscriptEntry[]
-  parentModelKey: string
+  /** The whole transcript the session starts from. */
+  transcript: TranscriptEntry[]
+  /** Its entries the host has not stored yet. */
+  handOff: TranscriptEntry[]
   inbox: SubagentInbox
   createSession: CreateSubagentSession
 }): Promise<AgentRuntimeSession> {
-  const { subagent, options, prefix } = input
-  const transcript = [
-    ...prefix,
-    originEntry({
-      parentToolCallId: subagent.parentToolCallId,
-      fork: subagent.fork,
-      description: subagent.description,
-      modelKey: input.parentModelKey
-    })
-  ]
-  options.onEvent?.({ type: 'transcript-append', entries: plainJson(transcript) })
+  const { subagent, options, transcript } = input
+  if (input.handOff.length > 0) options.onEvent?.({ type: 'transcript-append', entries: plainJson(input.handOff) })
   const child = await input.createSession({
     sessionId: subagent.sessionId,
     transcript,
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentMessage.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentContinue.test.ts packages/agent-runtime-pi/tests/subagentSupport.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): continue finished subagents from their stored transcript"
```

### Task 7: Rebuild recovery and the status after a compaction

Spec: §4.3 (restore rules), §7.7, §9 (destroy row), §12

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentRebuild.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRun.ts`, `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/subagentDelivery.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/index.ts`

**Interfaces:**
- Consumes (Tasks 2–6): `SubagentState`, `SubagentNotificationDetails`, `PendingDelivery`, `SubagentRegistry`, `SubagentDelivery`.
- Produces: `SUBAGENT_TOOL_NAME` now lives in `subagentRun.ts` (re-exported by `subagent.ts`); `zeroUsage(): Usage` exported; `restoreSubagents(entries: readonly SessionEntry[], parentModelKey: string): { records: SubagentRecord[]; undelivered: PendingDelivery[] }`; `SubagentRegistry.restore(records)`, `unfinished(): SubagentRecord[]`; `SUBAGENT_STATUS_TYPE = 'cherry.subagent-status'`; `renderStatus(running, pending)`; `SubagentDelivery.restore(items)`, `pending(): readonly PendingDelivery[]`; `index.ts` exports `SUBAGENT_STATUS_TYPE`.

- [ ] **Step 1: Write the failing tests**

Spec §15 rebuild and compaction rows.

Create `packages/agent-runtime-pi/tests/subagentRebuild.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { SUBAGENT_STATUS_TYPE } from '../src'
import {
  gate,
  type RoutedCall,
  routedModel,
  storingSubagentPort,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, plain, streamTextPort, tempDir, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const lastTwoTexts = (call: RoutedCall) =>
  call.options.prompt
    .slice(-2)
    .map((message) =>
      message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''
    )

describe('subagents after a rebuild', () => {
  // Breaks when a rebuilt parent still counts a dead run as running, starts a turn on its own, says
  // nothing of it, or says it again after every rebuild.
  it('reports a run the shutdown cut off as interrupted with the next user message, once', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A in the background')
    await held.reached
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await settle()
    expect(notified(calls)).toEqual([])
    await rebuilt.prompt('Where were we?')

    const { sessionId } = host.subagents[0]
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([
      'Where were we?',
      `${NOTE}\n\n- "Check A" (id: ${sessionId}) was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`
    ])

    const again = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain([...first.entries, ...second.entries])
    })
    await again.prompt('And now?')
    expect(lastTwoTexts(calls.at(-1)!)[1]).toBe('And now?')
  })

  // Breaks when an interrupted subagent cannot be continued after a rebuild, or continues without
  // the warning to check what its last run already did.
  it('continues an interrupted subagent after a rebuild with the recovery hint', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.startsWith('Your previous run') ? reply('REPORT-A') : held.wait(reply('LATE'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Go on with A')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'GO-ON' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A in the background')
    await held.reached
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await rebuilt.prompt('Go on with A')
    await waitFor(() => notified(calls).some((call) => call.lastText.includes('REPORT-A')))

    expect(textOf(toolResultOf(rebuilt.session, 'call_msg'))).toMatch(/resumed in the background/)
    expect(calls.filter((call) => call.userText.includes('TASK-A')).at(-1)!.lastText).toMatch(
      /^Your previous run was interrupted\.[\s\S]*\n\nGO-ON$/
    )
    expect(subagentStates(second.entries).map((state) => [state.run, state.status])).toEqual([
      [2, 'running'],
      [2, 'finished']
    ])
  })

  // Breaks when a result that never reached the parent is lost with the session, or delivered twice.
  it('delivers a result that never reached the parent with the next user message, once', async () => {
    const cwd = tempDir('cwd')
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'stop_turn',
      label: 'Stop turn',
      description: 'The user presses stop',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Do something long') return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      onEvent: first.onEvent
    })
    parent.session = before.session
    await before.prompt('Check A in the background')
    // The user stopped a turn, so the result waits for their next message, which never comes.
    await before.prompt('Do something long')
    held.open()
    await waitFor(() => subagentStates(first.entries).some((state) => state.status === 'finished'))
    await before.dispose()

    const second = hostStore()
    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      transcript: plain(first.entries),
      onEvent: second.onEvent
    })
    await rebuilt.prompt('Where were we?')
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([
      'Where were we?',
      `${NOTE}\n\n- "Check A" (id: ${host.subagents[0].sessionId}) completed:\n  REPORT-A`
    ])

    const again = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      tools: [stopTurn],
      subagents: host.port,
      transcript: plain([...first.entries, ...second.entries])
    })
    await again.prompt('And now?')
    expect(lastTwoTexts(calls.at(-1)!)[1]).toBe('And now?')
  })

  // Breaks when a foreground subagent of an earlier session cannot be addressed after a rebuild:
  // its tool result is the only record of it.
  it('continues a foreground subagent of the session before the rebuild', async () => {
    const cwd = tempDir('cwd')
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'AGAIN' ? 'REPORT-2' : 'REPORT-1')
      if (humanText === 'Check A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (humanText === 'Ask A again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'AGAIN' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const first = hostStore()
    const before = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: first.onEvent
    })
    await before.prompt('Check A')
    await before.dispose()

    const rebuilt = await createTestSession({
      cwd,
      port: streamTextPort(model).port,
      subagents: host.port,
      transcript: plain(first.entries)
    })
    await rebuilt.prompt('Ask A again')

    await waitFor(() => notified(calls).some((call) => call.lastText.includes('REPORT-2')))
  })
})

describe('subagent status after a compaction', () => {
  // Breaks when the compacted context no longer tells the model its subagent is running, so it
  // starts it again.
  it('lists the running background subagents after a compaction', async () => {
    const held = gate()
    const parent = hostStore()
    const host = storingSubagentPort()
    const { model, calls } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      subagents: host.port,
      onEvent: parent.onEvent,
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1, summarize: async () => 'SUMMARY' }
    })
    await runtime.prompt('Check A in the background')
    await runtime.prompt('Anything else?')

    await runtime.compact()
    await runtime.prompt('What is running?')

    const status = `Background subagent status (automatic message, not from the user):\n- "Check A" (id: ${host.subagents[0].sessionId}): running\nRunning subagents report back on their own when they finish: do not start them again, and do not wait for or poll them.`
    const kinds = parent.entries.map((entry) =>
      entry.kind === 'message' ? (entry.custom?.type ?? entry.message.role) : entry.kind
    )
    expect(kinds.slice(kinds.indexOf('compaction'), kinds.indexOf('compaction') + 2)).toEqual([
      'compaction',
      SUBAGENT_STATUS_TYPE
    ])
    expect(lastTwoTexts(calls.at(-1)!)).toEqual([status, 'What is running?'])
    held.open()
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts`

Expected: FAIL. `subagentRebuild.test.ts` fails: a rebuilt parent knows none of its subagents (the interrupted one is `No subagent with id …`), nothing rides with the user's next message, and no `cherry.subagent-status` entry follows the compaction.

- [ ] **Step 3: Implement**

Interrupted runs and undelivered results ride in one notification with the next prompt (Spec amendment 3); a run the model stopped never does. The status message after a compaction lists running subagents first, then undelivered results.

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -58,6 +58,7 @@
 export {
   NOTIFICATION_THRESHOLD_CHARS,
   SUBAGENT_NOTIFICATION_TYPE,
+  SUBAGENT_STATUS_TYPE,
   type SubagentNotificationDetails
 } from './subagentDelivery'
 export { SUBAGENT_STATE_TYPE, type SubagentState, type SubagentStatus, type SubagentView } from './subagentRegistry'
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -11,8 +11,14 @@
 
 import type { ToolOutputOffload } from './offload'
 import type { AgentRuntimeSession } from './session'
-import { shortenResult, SubagentDelivery } from './subagentDelivery'
-import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, type SubagentRecord, SubagentRegistry } from './subagentRegistry'
+import { renderStatus, shortenResult, SubagentDelivery } from './subagentDelivery'
+import {
+  DEFAULT_MAX_BACKGROUND,
+  restoreSubagents,
+  SUBAGENT_STATE_TYPE,
+  type SubagentRecord,
+  SubagentRegistry
+} from './subagentRegistry'
 import {
   answerInterrupted,
   type CreateSubagentSession,
@@ -24,15 +30,14 @@
   type RunEnd,
   type RunResult,
   SUBAGENT_ORIGIN_STATE,
+  SUBAGENT_TOOL_NAME,
   SubagentInbox
 } from './subagentRun'
 import type { TranscriptEntry } from './transcript'
 import type { AgentRuntimeEvent } from './transcriptTap'
 
-export { SUBAGENT_MESSAGE_TYPE, SUBAGENT_ORIGIN_STATE } from './subagentRun'
-
-/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
-export const SUBAGENT_TOOL_NAME = 'subagent'
+export { SUBAGENT_MESSAGE_TYPE, SUBAGENT_ORIGIN_STATE, SUBAGENT_TOOL_NAME } from './subagentRun'
+
 export const MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'
 export const STOP_SUBAGENT_TOOL_NAME = 'stop_subagent'
 
@@ -262,10 +267,20 @@
 
     pi.on('session_start', (_event, context) => {
       // A fork keeps this extension so its tools match the parent's; it delivers nothing.
-      inSubagent = isSubagentSession(context.sessionManager.getBranch())
+      const branch = context.sessionManager.getBranch()
+      inSubagent = isSubagentSession(branch)
       if (inSubagent) return
       ctx = context
       main = { registry, delivery }
+      const { records, undelivered } = restoreSubagents(branch, parentModelKey)
+      registry.restore(records)
+      delivery.restore(undelivered)
+    })
+    // After a compaction the model no longer sees its subagent calls; this keeps it from starting them again.
+    pi.on('session_compact', () => {
+      if (inSubagent) return
+      const status = renderStatus(registry.unfinished(), delivery.pending())
+      if (status) pi.sendMessage(status, { triggerTurn: false })
     })
     pi.on('agent_before_settle', (event) => (inSubagent ? undefined : delivery.beforeSettle(event)))
     pi.on('agent_settled', (event) => {
````

Apply to `packages/agent-runtime-pi/src/subagentDelivery.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentDelivery.ts
+++ b/packages/agent-runtime-pi/src/subagentDelivery.ts
@@ -7,6 +7,9 @@
 
 /** Custom message of the parent carrying finished background runs; the model gets it as a user message. */
 export const SUBAGENT_NOTIFICATION_TYPE = 'cherry.subagent-notification'
+
+/** Custom message of the parent listing its unfinished subagents after a compaction. */
+export const SUBAGENT_STATUS_TYPE = 'cherry.subagent-status'
 
 /** Results longer than this many characters are shortened when the host has no offload store. */
 export const NOTIFICATION_THRESHOLD_CHARS = 20_000
@@ -117,6 +120,37 @@
   }
 }
 
+const STATUS_HEADER = 'Background subagent status (automatic message, not from the user):'
+const STATUS_FOOTER =
+  'Running subagents report back on their own when they finish: do not start them again, and do not wait for or poll them.'
+/** Ids listed in status messages (spec §5.4). */
+const LISTED = 20
+
+/**
+ * The status message a compaction leaves: the background subagents still running and the results
+ * not delivered yet, so the model does not start them again. `undefined` when there are none.
+ */
+export function renderStatus(
+  running: ReadonlyArray<{ sessionId: string; description: string; status: string }>,
+  pending: readonly PendingDelivery[]
+) {
+  const lines = [
+    ...running.map(
+      (record) =>
+        `- "${record.description}" (id: ${record.sessionId}): ${record.status === 'awaiting_approval' ? 'waiting for a tool approval' : 'running'}`
+    ),
+    ...pending.map(
+      (item) => `- "${item.description}" (id: ${item.sessionId}): finished; its result comes with the next update`
+    )
+  ].slice(0, LISTED)
+  if (lines.length === 0) return undefined
+  return {
+    customType: SUBAGENT_STATUS_TYPE,
+    content: [STATUS_HEADER, ...lines, STATUS_FOOTER].join('\n'),
+    display: false
+  }
+}
+
 /** One message for every pending item, oldest first. */
 export function renderNotification(items: readonly PendingDelivery[], stillRunning: number): NotificationMessage {
   const footer =
@@ -158,6 +192,16 @@
     this.deliverIfIdle()
   }
 
+  /** Session start: runs that ended without reaching the parent wait for the next message. */
+  restore(items: readonly PendingDelivery[]): void {
+    this.queue.push(...items)
+  }
+
+  /** Not delivered yet, oldest first. */
+  pending(): readonly PendingDelivery[] {
+    return this.queue
+  }
+
   /** `agent_before_settle`: the run goes on with the notification instead of settling. */
   beforeSettle(event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined {
     // A request the host aborted through its own signal settles here, not as an aborted run.
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -1,8 +1,17 @@
 import type { Usage } from '@earendil-works/pi-ai'
+import type { SessionEntry } from '@earendil-works/pi-coding-agent'
 
 import type { AgentRuntimeSession } from './session'
-import type { SubagentOutcome, SubagentStopper } from './subagent'
-import { type RunResult, type RunStart, runSubagent, type SubagentInbox } from './subagentRun'
+import type { SubagentDetails, SubagentOutcome, SubagentStopper } from './subagent'
+import { type PendingDelivery, SUBAGENT_NOTIFICATION_TYPE, type SubagentNotificationDetails } from './subagentDelivery'
+import {
+  type RunResult,
+  type RunStart,
+  runSubagent,
+  SUBAGENT_TOOL_NAME,
+  type SubagentInbox,
+  zeroUsage
+} from './subagentRun'
 import type { AgentRuntimeEvent } from './transcriptTap'
 
 /** State entry of the parent: one snapshot per change of a subagent's run. */
@@ -99,6 +108,95 @@
       })
 })
 
+const fromState = (state: SubagentState): SubagentRecord => ({
+  sessionId: state.sessionId,
+  parentToolCallId: state.parentToolCallId,
+  description: state.description,
+  fork: state.fork,
+  background: state.background,
+  modelKey: state.modelKey,
+  run: state.run,
+  status: state.status,
+  ...(state.outcome === undefined ? {} : { outcome: state.outcome }),
+  ...(state.stoppedBy === undefined ? {} : { stoppedBy: state.stoppedBy })
+})
+
+/**
+ * The parent's subagents as its branch records them (spec §4.3), least recently active first, and
+ * the run ends that never reached the parent. A run whose last snapshot is `running` was cut off
+ * with the session that held it: it is `interrupted`.
+ */
+export function restoreSubagents(
+  entries: readonly SessionEntry[],
+  parentModelKey: string
+): { records: SubagentRecord[]; undelivered: PendingDelivery[] } {
+  const calls = new Map<string, string>()
+  const records = new Map<string, SubagentRecord>()
+  const last = new Map<string, SubagentState>()
+  const delivered = new Set<string>()
+  const touch = <T>(map: Map<string, T>, key: string, value: T) => {
+    map.delete(key)
+    map.set(key, value)
+  }
+  for (const entry of entries) {
+    if (entry.type === 'message' && entry.message.role === 'assistant')
+      for (const block of entry.message.content)
+        if (block.type === 'toolCall' && block.name === SUBAGENT_TOOL_NAME)
+          calls.set(block.id, String(block.arguments.description ?? '').trim())
+    if (
+      entry.type === 'message' &&
+      entry.message.role === 'toolResult' &&
+      entry.message.toolName === SUBAGENT_TOOL_NAME
+    ) {
+      const details = entry.message.details as SubagentDetails | undefined
+      // A background launch wrote its snapshot before its result.
+      if (!details?.sessionId || records.has(details.sessionId)) continue
+      touch(records, details.sessionId, {
+        sessionId: details.sessionId,
+        parentToolCallId: entry.message.toolCallId,
+        description: calls.get(entry.message.toolCallId) ?? '',
+        fork: details.fork,
+        background: details.background,
+        modelKey: parentModelKey,
+        run: 1,
+        status: 'finished',
+        ...('outcome' in details ? { outcome: details.outcome } : {})
+      })
+    }
+    if (entry.type === 'custom' && entry.customType === SUBAGENT_STATE_TYPE) {
+      const state = entry.data as SubagentState
+      touch(last, state.sessionId, state)
+      touch(records, state.sessionId, fromState(state))
+    }
+    if (entry.type === 'custom_message' && entry.customType === SUBAGENT_NOTIFICATION_TYPE)
+      for (const item of (entry.details as SubagentNotificationDetails).subagents)
+        delivered.add(`${item.sessionId}:${item.run}`)
+  }
+  const undelivered: PendingDelivery[] = []
+  for (const state of last.values()) {
+    const record = records.get(state.sessionId)!
+    if (state.status === 'running') {
+      record.status = 'finished'
+      record.outcome = 'interrupted'
+    }
+    if (delivered.has(`${state.sessionId}:${state.run}`) || state.stoppedBy === 'model') continue
+    undelivered.push({
+      sessionId: state.sessionId,
+      run: state.run,
+      description: state.description,
+      outcome: record.outcome!,
+      ...(state.stoppedBy === undefined ? {} : { stoppedBy: state.stoppedBy }),
+      ...(state.report === undefined ? {} : { report: state.report }),
+      ...(state.reason === undefined ? {} : { reason: state.reason }),
+      ...(state.partial === undefined ? {} : { partial: state.partial }),
+      usage: state.usage ?? zeroUsage(),
+      // After a rebuild the user speaks first; the results ride with their message.
+      wake: false
+    })
+  }
+  return { records: [...records.values()], undelivered }
+}
+
 /** The parent's subagents: their state, live runs and the background cap. */
 export class SubagentRegistry {
   private readonly records = new Map<string, SubagentRecord>()
@@ -115,9 +213,19 @@
     return this.records.get(sessionId)
   }
 
+  /** Session start: the subagents the rebuilt branch records, least recently active first. */
+  restore(records: readonly SubagentRecord[]): void {
+    for (const record of records) this.track(record)
+  }
+
   /** The most recently active subagents first, at most 20. */
   recent(): SubagentRecord[] {
     return [...this.records.values()].reverse().slice(0, LISTED)
+  }
+
+  /** Background subagents running or awaiting an approval, the most recently active first. */
+  unfinished(): SubagentRecord[] {
+    return [...this.records.values()].reverse().filter((record) => record.background && record.status !== 'finished')
   }
 
   /** Stops a running subagent; resolves with its run's result once its end is recorded. */
````

Apply to `packages/agent-runtime-pi/src/subagentRun.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRun.ts
+++ b/packages/agent-runtime-pi/src/subagentRun.ts
@@ -8,6 +8,9 @@
 import type { Subagent, SubagentSessionOptions } from './subagent'
 import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
 import type { AgentRuntimeEvent } from './transcriptTap'
+
+/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
+export const SUBAGENT_TOOL_NAME = 'subagent'
 
 /** Model requests one run may make before it is stopped (Claude Code's limit for a fork). */
 export const MAX_SUBAGENT_REQUESTS = 200
@@ -237,7 +240,7 @@
   return child
 }
 
-const zeroUsage = (): Usage => ({
+export const zeroUsage = (): Usage => ({
   input: 0,
   output: 0,
   cacheRead: 0,
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/tests/subagentDelivery.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentRebuild.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentDelivery.ts packages/agent-runtime-pi/src/subagentRegistry.ts packages/agent-runtime-pi/src/subagentRun.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): restore subagents after rebuilds and report them after compactions"
```

### Task 8: Approvals: `ToolApprovalEvent`, `SubagentPort.onApproval`, `awaiting_approval`

Spec: §4.4 (rename, `onApproval`), §10, §13.6

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentApproval.test.ts`
- Modify: `packages/agent-runtime-pi/src/ports.ts`, `packages/agent-runtime-pi/src/goalExtension.ts`, `packages/agent-runtime-pi/src/index.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/tests/goalSupport.ts`

**Interfaces:**
- Consumes (Tasks 2–7): `SubagentRegistry` live runs, `SubagentStatus`.
- Produces: `interface ToolApprovalEvent { kind: 'pending' | 'granted' | 'denied' | 'unavailable'; toolCallId: string }` in `ports.ts` (replaces `GoalApprovalEvent`, which `index.ts` no longer exports); `SubagentPort.onApproval?(listener: (event: ToolApprovalEvent) => void): () => void`; `SubagentRegistry.approval(event: ToolApprovalEvent): void`.

- [ ] **Step 1: Write the failing tests**

Spec §15 approval row, and the subscription rule (one per parent, none in a fork, released at shutdown).

Apply to `packages/agent-runtime-pi/tests/goalSupport.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/goalSupport.ts
+++ b/packages/agent-runtime-pi/tests/goalSupport.ts
@@ -9,12 +9,12 @@
   GOAL_NOTICE_TYPE,
   GOAL_ROUND_TYPE,
   GOAL_STATE_TYPE,
-  type GoalApprovalEvent,
   type GoalCleared,
   type GoalNotice,
   type GoalPort,
   type GoalSnapshot,
   type RoundDetails,
+  type ToolApprovalEvent,
   type TranscriptEntry
 } from '../src'
 import {
@@ -200,8 +200,8 @@
  * A port with a single approval listener, and a tool that reports `kind` for its own call, as the
  * host's approval layer would. `listening()` tells whether a listener is subscribed.
  */
-export function approvals(kind: GoalApprovalEvent['kind'], overrides: Parameters<typeof goalPort>[0] = {}) {
-  let listener: ((event: GoalApprovalEvent) => void) | undefined
+export function approvals(kind: ToolApprovalEvent['kind'], overrides: Parameters<typeof goalPort>[0] = {}) {
+  let listener: ((event: ToolApprovalEvent) => void) | undefined
   const port = goalPort({
     ...overrides,
     onApproval: (next) => {
````

Create `packages/agent-runtime-pi/tests/subagentApproval.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort, ToolApprovalEvent } from '../src'
import {
  gate,
  recordingSubagentPort,
  routedModel,
  subagentCall,
  subagentViews,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const BG_A = { description: 'Check A', prompt: 'TASK-A', background: true }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

/** The host's approval registry: one place every approval event goes through. */
function approvalHub() {
  const listeners = new Set<(event: ToolApprovalEvent) => void>()
  return {
    onApproval: (listener: (event: ToolApprovalEvent) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    emit: (event: ToolApprovalEvent) => {
      for (const listener of listeners) listener(event)
    },
    listening: () => listeners.size
  }
}

const risky = defineTool({
  name: 'risky',
  label: 'Risky',
  description: 'Needs approval',
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: 'text', text: 'done' }], details: undefined }
  }
})

describe('subagent approvals', () => {
  // Breaks when the parent and the host cannot see that a background subagent waits for the user
  // (Claude Code #99887: an unattended parent then waits all night), or it stays shown as waiting.
  it('shows a background subagent as awaiting approval while its call waits, then running again', async () => {
    const hub = approvalHub()
    const approved = gate()
    const approvalLayer: ExtensionFactory = (pi) => {
      pi.on('tool_call', async (event) => {
        hub.emit({ kind: 'pending', toolCallId: event.toolCallId })
        await approved.wait(undefined)
        hub.emit({ kind: 'granted', toolCallId: event.toolCallId })
        return undefined
      })
    }
    const recording = recordingSubagentPort(() => ({ extensionFactories: [approvalLayer] }))
    const port: SubagentPort = { ...recording.port, onApproval: hub.onApproval }
    const parent = hostStore()
    const { model } = routedModel(({ userText, lastText, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [toolCallPart('risky_1', 'risky'), finish('tool-calls')]
          : reply('REPORT-A')
      if (humanText === 'Check A in the background') return [subagentCall('call_a', BG_A), finish('tool-calls')]
      if (humanText === 'Message B')
        return [toolCallPart('call_msg', 'message_subagent', { id: 'B', message: 'hi' }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      tools: [risky],
      subagents: port,
      onEvent: parent.onEvent
    })
    await session.prompt('Check A in the background')
    await approved.reached

    await session.prompt('Message B')
    const { sessionId } = recording.subagents[0]
    expect(textOf(toolResultOf(session, 'call_msg'))).toBe(
      `No subagent with id B in this conversation. Subagents you can address:\n${sessionId} — Check A — waiting for a tool approval`
    )
    approved.open()
    await waitFor(() => subagentViews(parent.events).some((views) => views[0]?.status === 'finished'))

    expect(subagentViews(parent.events).map((views) => views[0].status)).toEqual([
      'running',
      'awaiting_approval',
      'running',
      'finished'
    ])
  })

  // Breaks when a fork takes the approval subscription meant for its parent, or the parent keeps it
  // after shutdown (the host would hold every listener).
  it('subscribes once per parent session and releases at shutdown', async () => {
    const hub = approvalHub()
    const recording = recordingSubagentPort()
    const port: SubagentPort = { ...recording.port, onApproval: hub.onApproval }
    let duringFork = 0
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-A')) {
        duringFork = hub.listening()
        return reply('REPORT-A')
      }
      if (humanText === 'Fork A')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A', fork: true }), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: port })
    await runtime.prompt('Fork A')
    expect(duringFork).toBe(1)

    await runtime.dispose()
    expect(hub.listening()).toBe(0)
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts packages/agent-runtime-pi/tests/goal.test.ts`

Expected: FAIL. `subagentApproval.test.ts` fails: the views never show `awaiting_approval`, the error list says `running`, and the hub has no listener (`onApproval` is never subscribed).

- [ ] **Step 3: Implement**

The registry follows each live child's `tool_execution_start`/`tool_execution_end` and matches approval events by call id; the subscription is made at the main session's `session_start` and released at `session_shutdown`.

Apply to `packages/agent-runtime-pi/src/goalExtension.ts`:

````diff
--- a/packages/agent-runtime-pi/src/goalExtension.ts
+++ b/packages/agent-runtime-pi/src/goalExtension.ts
@@ -38,12 +38,8 @@
   toolCallKey
 } from './goalState'
 import { type ConversationModelMessage, toModelMessages } from './modelMessages'
+import type { ToolApprovalEvent } from './ports'
 import { isSubagentSession } from './subagent'
-
-export interface GoalApprovalEvent {
-  kind: 'pending' | 'granted' | 'denied' | 'unavailable'
-  toolCallId: string
-}
 
 /** Host-side completion check; without it the extension falls back to runtime checks (spec §9). */
 export interface GoalVerifier {
@@ -70,7 +66,7 @@
   }
   modelSupportsTools(): boolean
   /** Wired by the host integration (its ToolApprovalRegistry): approval events of this session's tool calls. */
-  onApproval?(listener: (event: GoalApprovalEvent) => void): () => void
+  onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
   /** L6: background subagents of this session still running; foreground subagents finish inside their call. */
   hasRunningSubagents?(): boolean
   verify?: GoalVerifier
````

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -11,13 +11,7 @@
   createAskUserExtension
 } from './askUserExtension'
 export type { AgentRuntimeCompaction, CompactionSummarizer, CompactionSummaryRequest } from './compaction'
-export {
-  createGoalExtension,
-  GOAL_TOOL_NAMES,
-  type GoalApprovalEvent,
-  type GoalPort,
-  type GoalVerifier
-} from './goalExtension'
+export { createGoalExtension, GOAL_TOOL_NAMES, type GoalPort, type GoalVerifier } from './goalExtension'
 export {
   GOAL_NOTICE_TYPE,
   GOAL_ROUND_TYPE,
@@ -37,6 +31,7 @@
   ModelCallRequest,
   ModelCallResult,
   ModelCallSideChannel,
+  ToolApprovalEvent,
   UnmappedStreamPart
 } from './ports'
 export {
````

Apply to `packages/agent-runtime-pi/src/ports.ts`:

````diff
--- a/packages/agent-runtime-pi/src/ports.ts
+++ b/packages/agent-runtime-pi/src/ports.ts
@@ -51,3 +51,12 @@
   /** The original error object (e.g. `APICallError` with `statusCode`/`responseBody`); Pi keeps only its message. Not called on abort. */
   onError?(error: unknown, call: ModelCallInfo): void
 }
+
+/**
+ * An approval event of one tool call, from the host's approval layer: `pending` while it waits for
+ * the user, then how it ended. `unavailable`: nobody can approve (a channel or scheduled run).
+ */
+export interface ToolApprovalEvent {
+  kind: 'pending' | 'granted' | 'denied' | 'unavailable'
+  toolCallId: string
+}
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -10,6 +10,7 @@
 } from '@earendil-works/pi-coding-agent'
 
 import type { ToolOutputOffload } from './offload'
+import type { ToolApprovalEvent } from './ports'
 import type { AgentRuntimeSession } from './session'
 import { renderStatus, shortenResult, SubagentDelivery } from './subagentDelivery'
 import {
@@ -59,6 +60,11 @@
    * it. Without it, finished subagents cannot be continued.
    */
   load?(sessionId: string): Promise<readonly TranscriptEntry[] | undefined>
+  /**
+   * Approval events of the subagents' tool calls (the parent's own may come too: they are told
+   * apart by call id). While one is pending, its subagent shows as `awaiting_approval`.
+   */
+  onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
   /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
   maxBackground?: number
 }
@@ -238,6 +244,7 @@
   const extension: ExtensionFactory = (pi) => {
     let ctx: ExtensionContext | undefined
     let inSubagent = false
+    let unsubscribeApproval: (() => void) | undefined
     const registry = new SubagentRegistry({
       appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
       emit,
@@ -275,6 +282,7 @@
       const { records, undelivered } = restoreSubagents(branch, parentModelKey)
       registry.restore(records)
       delivery.restore(undelivered)
+      unsubscribeApproval = port.onApproval?.((event) => registry.approval(event))
     })
     // After a compaction the model no longer sees its subagent calls; this keeps it from starting them again.
     pi.on('session_compact', () => {
@@ -288,6 +296,8 @@
     })
     pi.on('before_agent_start', () => (inSubagent ? undefined : delivery.beforeAgentStart()))
     pi.on('session_shutdown', () => {
+      unsubscribeApproval?.()
+      unsubscribeApproval = undefined
       delivery.close()
       return registry.close()
     })
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -1,6 +1,7 @@
 import type { Usage } from '@earendil-works/pi-ai'
 import type { SessionEntry } from '@earendil-works/pi-coding-agent'
 
+import type { ToolApprovalEvent } from './ports'
 import type { AgentRuntimeSession } from './session'
 import type { SubagentDetails, SubagentOutcome, SubagentStopper } from './subagent'
 import { type PendingDelivery, SUBAGENT_NOTIFICATION_TYPE, type SubagentNotificationDetails } from './subagentDelivery'
@@ -82,6 +83,8 @@
   inbox: SubagentInbox
   /** Settles with the run's result once its session is disposed and its end is recorded. */
   done: Promise<RunResult>
+  /** Tool calls executing in its session, which approval events name. */
+  calls: Set<string>
 }
 
 /** Ids listed in status messages and errors (spec §5.4). */
@@ -238,6 +241,12 @@
     return run.done
   }
 
+  /** A pending approval marks its subagent `awaiting_approval`; any other event, or the call ending, undoes it. */
+  approval(event: ToolApprovalEvent): void {
+    for (const [sessionId, run] of this.live)
+      if (run.calls.has(event.toolCallId)) this.setWaiting(sessionId, event.kind === 'pending')
+  }
+
   /** Resolves once the latest run of the subagent is over and recorded. */
   async recorded(sessionId: string): Promise<void> {
     await this.live.get(sessionId)?.done
@@ -310,13 +319,15 @@
     const onAbort = () => controller.abort()
     if (signal?.aborted) controller.abort()
     else signal?.addEventListener('abort', onAbort, { once: true })
+    const calls = this.watchCalls(record.sessionId, child)
     const run = runSubagent(child, start, controller.signal, inbox)
-    this.live.set(record.sessionId, { controller, inbox, done: run })
+    this.live.set(record.sessionId, { controller, inbox, done: run, calls: calls.ids })
     try {
       const result = await run
       this.end(record, result)
       return result
     } finally {
+      calls.stop()
       signal?.removeEventListener('abort', onAbort)
       this.live.delete(record.sessionId)
     }
@@ -336,13 +347,15 @@
     this.host.appendState(snapshot(record))
     this.changed()
     const controller = new AbortController()
+    const calls = this.watchCalls(record.sessionId, child)
     const done = runSubagent(child, start, controller.signal, inbox).then(async (result) => {
+      calls.stop()
       // Finished at once, so a message sent from now on continues the subagent instead of joining this run.
       this.end(record, result)
       await this.record(record, child, result)
       return result
     })
-    this.live.set(record.sessionId, { controller, inbox, done })
+    this.live.set(record.sessionId, { controller, inbox, done, calls: calls.ids })
   }
 
   /** Session shutdown: stops every live run and disposes its session, writing nothing. */
@@ -367,6 +380,27 @@
     if (record.stoppedBy !== 'model') this.host.finished(record, shortened)
   }
 
+  /** Follows the tool calls executing in a subagent's session, for its approval events. */
+  private watchCalls(sessionId: string, child: AgentRuntimeSession): { ids: Set<string>; stop: () => void } {
+    const ids = new Set<string>()
+    const stop = child.session.subscribe((event) => {
+      if (event.type === 'tool_execution_start') ids.add(event.toolCallId)
+      if (event.type !== 'tool_execution_end') return
+      ids.delete(event.toolCallId)
+      this.setWaiting(sessionId, false)
+    })
+    return { ids, stop }
+  }
+
+  private setWaiting(sessionId: string, waiting: boolean): void {
+    const record = this.records.get(sessionId)
+    if (!record || record.status === 'finished') return
+    const status = waiting ? 'awaiting_approval' : 'running'
+    if (record.status === status) return
+    record.status = status
+    if (record.background) this.changed()
+  }
+
   private end(record: SubagentRecord, result: RunResult): void {
     record.status = 'finished'
     record.outcome = record.stoppedBy ? 'stopped' : result.end
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts packages/agent-runtime-pi/tests/goal.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/ports.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/ports.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec eslint packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/ports.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts packages/agent-runtime-pi/tests/goal.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/goalSupport.ts packages/agent-runtime-pi/tests/subagentApproval.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/ports.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): show subagents that wait for a tool approval"
```

### Task 9: Moving a foreground subagent to the background

Spec: §4.4 (`backgroundSubagent`), §5.1 (moved text), §6.6, D9

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentMove.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRegistry.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/session.ts`

**Interfaces:**
- Consumes (Tasks 1–8): `SubagentRegistry.runForeground`, `record()` (the background end path), snapshots.
- Produces: `runForeground(...)` now resolves `RunResult | undefined` (`undefined`: moved); `SubagentRegistry.moveToBackground(sessionId): boolean`; `SubagentControls.backgroundSubagent(sessionId): boolean`; `AgentRuntimeSession.backgroundSubagent(sessionId: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Spec §15 move rows.

Create `packages/agent-runtime-pi/tests/subagentMove.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  gate,
  noteTool,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  toolResults,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, hostStore, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const TASK_A = { description: 'Check A', prompt: 'TASK-A' }
const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]
const notified = (calls: readonly RoutedCall[]) => calls.filter((call) => call.lastText.startsWith(NOTE))

describe('moving a foreground subagent to the background', () => {
  // Breaks when moving re-runs the subagent from its prompt, leaves the parent's call waiting, lets
  // the parent's turn still stop it, or ends without a notification.
  it('returns the call at once and lets the same run go on, ending in a notification', async () => {
    const held = gate()
    const parent: { session?: AgentSession } = {}
    const stopTurn = defineTool({
      name: 'stop_turn',
      label: 'Stop turn',
      description: 'The user presses stop',
      parameters: Type.Object({}),
      async execute(_id, _params, signal) {
        void parent.session!.abort()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
      }
    })
    const host = recordingSubagentPort()
    const store = hostStore()
    const { model, calls } = routedModel(({ userText, lastText, lastRole, humanText }) => {
      if (userText.includes('TASK-A'))
        return lastText.includes('TASK-A')
          ? [toolCallPart('note_1', 'note'), finish('tool-calls')]
          : held.wait(reply('REPORT-A'))
      if (humanText === 'Check A') return [subagentCall('call_a', TASK_A), finish('tool-calls')]
      // The same turn goes on after the moved call returns, and the user stops it.
      if (lastRole === 'tool' && toolResults(calls.at(-1)!).at(-1)?.toolCallId === 'call_a')
        return [toolCallPart('stop_1', 'stop_turn'), finish('tool-calls')]
      return reply('OK.')
    })
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      tools: [noteTool, stopTurn],
      subagents: host.port,
      onEvent: store.onEvent
    })
    parent.session = runtime.session
    const turn = runtime.prompt('Check A')
    await held.reached
    const { sessionId } = host.subagents[0]

    expect(runtime.backgroundSubagent(sessionId)).toBe(true)
    await turn
    expect(store.events.at(-1)).toMatchObject({ type: 'turn-complete', aborted: true })
    const result = toolResultOf(runtime.session, 'call_a')
    expect(textOf(result)).toBe(
      `The user moved this subagent to the background (id: ${sessionId}); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`
    )
    expect(result.details).toEqual({ sessionId, fork: false, background: true })

    held.open()
    await waitFor(() => subagentStates(store.entries).some((state) => state.status === 'finished'))
    expect(
      subagentStates(store.entries).map((state) => [state.run, state.status, state.background, state.outcome])
    ).toEqual([
      [1, 'running', true, undefined],
      [1, 'finished', true, 'completed']
    ])
    expect(calls.filter((call) => call.lastText.includes('TASK-A'))).toHaveLength(1)
    // The parent's turn was stopped, so the result rides with the user's next message.
    await runtime.prompt('And A?')
    expect(notified(calls).at(-1)!.lastText).toContain('REPORT-A')
  })

  // Breaks when a subagent that is not a running foreground one is taken over a second time.
  it('refuses a background, finished or unknown subagent', async () => {
    const held = gate()
    const host = recordingSubagentPort()
    const { model } = routedModel(({ userText, humanText }) => {
      if (userText.includes('TASK-BG')) return held.wait(reply('BG'))
      if (userText.includes('TASK-A')) return reply('REPORT-A')
      if (humanText === 'Start both')
        return [
          subagentCall('call_bg', { description: 'BG', prompt: 'TASK-BG', background: true }),
          subagentCall('call_a', TASK_A),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const runtime = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await runtime.prompt('Start both')
    const id = (description: string) =>
      host.subagents.find((subagent) => subagent.description === description)!.sessionId

    expect(runtime.backgroundSubagent(id('BG'))).toBe(false)
    expect(runtime.backgroundSubagent(id('Check A'))).toBe(false)
    expect(runtime.backgroundSubagent('not-a-subagent')).toBe(false)
    held.open()
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts`

Expected: FAIL. `subagentMove.test.ts` fails: `runtime.backgroundSubagent is not a function`.

- [ ] **Step 3: Implement**

The registry now owns disposing a foreground child too, so a moved run keeps its session; the move detaches the call's signal, writes a `running` snapshot with the same `run` and returns the call.

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -98,6 +98,11 @@
   compact(customInstructions?: string): Promise<void>
   /** The user stops a background subagent (the host's stop button); false when it is not running. */
   stopSubagent(sessionId: string): boolean
+  /**
+   * The user moves a running foreground subagent to the background: its call returns at once and
+   * the same run goes on, ending in a notification. False for any other subagent.
+   */
+  backgroundSubagent(sessionId: string): boolean
 }
 
 /**
@@ -227,6 +232,7 @@
     prompt: (text, promptOptions) => held(() => session.prompt(text, promptOptions)),
     compact: (customInstructions) => held(() => session.compact(customInstructions)),
     stopSubagent: (sessionId) => subagents?.controls.stopSubagent(sessionId) ?? false,
+    backgroundSubagent: (sessionId) => subagents?.controls.backgroundSubagent(sessionId) ?? false,
     async dispose() {
       try {
         await session.abort()
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -132,6 +132,8 @@
   hold(): () => void
   /** The user stops a background subagent; false when it is not running. */
   stopSubagent(sessionId: string): boolean
+  /** The user moves a running foreground subagent to the background; false for any other. */
+  backgroundSubagent(sessionId: string): boolean
 }
 
 const DESCRIPTION = [
@@ -196,6 +198,9 @@
   id: Type.String({ description: 'The id a subagent result or notification gave.' }),
   message: Type.String({ description: 'What to tell the subagent.' })
 })
+
+const movedText = (sessionId: string) =>
+  `The user moved this subagent to the background (id: ${sessionId}); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`
 
 const startedText = (sessionId: string) =>
   `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`
@@ -239,7 +244,8 @@
   const controls: SubagentControls = {
     hold: () => main?.delivery.hold() ?? (() => {}),
     stopSubagent: (sessionId) =>
-      main?.registry.get(sessionId)?.background === true && main.registry.stop(sessionId, 'user') !== undefined
+      main?.registry.get(sessionId)?.background === true && main.registry.stop(sessionId, 'user') !== undefined,
+    backgroundSubagent: (sessionId) => main?.registry.moveToBackground(sessionId) ?? false
   }
   const extension: ExtensionFactory = (pi) => {
     let ctx: ExtensionContext | undefined
@@ -353,22 +359,17 @@
           const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
           return { content: [text(startedText(subagent.sessionId))], details }
         }
-        try {
-          const result = await registry.runForeground(record, child, start, inbox, signal)
-          const details: SubagentDetails = {
-            sessionId: subagent.sessionId,
-            fork,
-            background: false,
-            outcome: result.end
-          }
-          return {
-            content: [text(`${runText(result)}\n\n${idTrailer(subagent.sessionId)}`)],
-            details,
-            usage: result.usage,
-            ...(result.end === 'completed' ? {} : { isError: true })
-          }
-        } finally {
-          await child.dispose()
+        const result = await registry.runForeground(record, child, start, inbox, signal)
+        if (!result) {
+          const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
+          return { content: [text(movedText(subagent.sessionId))], details }
+        }
+        const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: false, outcome: result.end }
+        return {
+          content: [text(`${runText(result)}\n\n${idTrailer(subagent.sessionId)}`)],
+          details,
+          usage: result.usage,
+          ...(result.end === 'completed' ? {} : { isError: true })
         }
       }
     })
````

Apply to `packages/agent-runtime-pi/src/subagentRegistry.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRegistry.ts
+++ b/packages/agent-runtime-pi/src/subagentRegistry.ts
@@ -85,6 +85,8 @@
   done: Promise<RunResult>
   /** Tool calls executing in its session, which approval events name. */
   calls: Set<string>
+  /** A foreground run only: hands it to the background, where it goes on. */
+  toBackground?: () => void
 }
 
 /** Ids listed in status messages and errors (spec §5.4). */
@@ -304,33 +306,57 @@
   }
 
   /**
-   * Runs a foreground subagent within the parent's call: `signal` (the call's) stops it. Its result
-   * is the call's, so nothing is written to the transcript.
+   * Runs a foreground subagent within the parent's call: `signal` (the call's) stops it, and its
+   * result is the call's. Resolves `undefined` when the user moves it to the background first:
+   * the same run then goes on there, and its end is notified.
    */
-  async runForeground(
+  runForeground(
     record: SubagentRecord,
     child: AgentRuntimeSession,
     start: RunStart,
     inbox: SubagentInbox,
     signal: AbortSignal | undefined
-  ): Promise<RunResult> {
+  ): Promise<RunResult | undefined> {
     this.track(record)
     const controller = new AbortController()
     const onAbort = () => controller.abort()
     if (signal?.aborted) controller.abort()
     else signal?.addEventListener('abort', onAbort, { once: true })
     const calls = this.watchCalls(record.sessionId, child)
-    const run = runSubagent(child, start, controller.signal, inbox)
-    this.live.set(record.sessionId, { controller, inbox, done: run, calls: calls.ids })
-    try {
-      const result = await run
-      this.end(record, result)
-      return result
-    } finally {
+    let moved = false
+    let returnNow!: () => void
+    const movedAway = new Promise<undefined>((resolve) => (returnNow = () => resolve(undefined)))
+    const done = runSubagent(child, start, controller.signal, inbox).then(async (result) => {
       calls.stop()
       signal?.removeEventListener('abort', onAbort)
-      this.live.delete(record.sessionId)
-    }
+      this.end(record, result)
+      if (moved) await this.record(record, child, result)
+      else {
+        await child.dispose().catch(() => undefined)
+        this.live.delete(record.sessionId)
+      }
+      return result
+    })
+    const toBackground = () => {
+      moved = true
+      // From now on the parent's turn, aborted or not, does not reach it.
+      signal?.removeEventListener('abort', onAbort)
+      record.background = true
+      this.host.appendState(snapshot(record))
+      this.changed()
+      returnNow()
+    }
+    this.live.set(record.sessionId, { controller, inbox, done, calls: calls.ids, toBackground })
+    return Promise.race([done, movedAway])
+  }
+
+  /** The user moves a running foreground subagent to the background; false for any other. */
+  moveToBackground(sessionId: string): boolean {
+    const record = this.records.get(sessionId)
+    const run = this.live.get(sessionId)
+    if (!record || record.background || record.status === 'finished' || !run?.toBackground) return false
+    run.toBackground()
+    return true
   }
 
   /** Runs `child` in the background; the parent's turn does not wait for it or stop it. */
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/tests/subagentStops.test.ts packages/agent-runtime-pi/tests/subagentBackground.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentMove.test.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRegistry.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): move a running foreground subagent to the background"
```

### Task 10: Subagent models

Spec: §4.4 (`findModels`, `SubagentModelCandidate`, `SubagentSessionOptions.model`), §5.1 (`model`), §6.7, §13.9, D10

**Files:**
- Create: `packages/agent-runtime-pi/tests/subagentModel.test.ts`
- Modify: `packages/agent-runtime-pi/src/subagentRun.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/src/session.ts`, `packages/agent-runtime-pi/src/index.ts`

**Interfaces:**
- Consumes (Tasks 1–9): `openChild`, `originEntry`, the continuation path.
- Produces: `SubagentPort.findModels?(query: string): Promise<readonly SubagentModelCandidate[]>`; `interface SubagentModelCandidate { key; provider; model; exact: boolean }`; `SubagentSessionOptions.model?: AgentRuntimeModel`; `pickModel(subagent, options, parentModel: AgentRuntimeModel): AgentRuntimeModel`; `SubagentSessionOverrides.model: AgentRuntimeModel`; `openChild` input gains `model`; `SubagentToolOptions.parentModel: AgentRuntimeModel` replaces `parentModelKey`; `index.ts` exports `SubagentModelCandidate`.

- [ ] **Step 1: Write the failing tests**

Spec §15 model rows.

Create `packages/agent-runtime-pi/tests/subagentModel.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { AgentRuntimeModel, SubagentModelCandidate, SubagentPort } from '../src'
import {
  recordingSubagentPort,
  routedModel,
  storingSubagentPort,
  subagentCall,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { createTestSession, finish, MODEL, streamTextPort, textParts } from './support'
import { textOf } from './toolResults'

const reply = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

const SONNET_OR: AgentRuntimeModel = { ...MODEL, provider: 'openrouter', key: 'or::sonnet', id: 'sonnet-4.5' }
const SONNET_AN: AgentRuntimeModel = { ...MODEL, provider: 'anthropic', key: 'an::sonnet', id: 'claude-sonnet-4-5' }
const DEFAULT_SUB: AgentRuntimeModel = { ...MODEL, provider: 'cherry', key: 'cherry::small', id: 'small-model' }
const MODELS = [SONNET_OR, SONNET_AN, DEFAULT_SUB]
const CATALOG = [
  { key: SONNET_OR.key, provider: 'OpenRouter', model: 'Claude Sonnet 4.5' },
  { key: SONNET_AN.key, provider: 'Anthropic', model: 'Claude Sonnet 4.5' },
  { key: 'or::gpt', provider: 'OpenRouter', model: 'GPT-5' }
]

/** Matches like the host does: exact on the model name or provider + model name, loosely on a shared word. */
async function findModels(query: string): Promise<SubagentModelCandidate[]> {
  const q = query.toLowerCase()
  const words = q.split(/\s+/)
  return CATALOG.flatMap((entry) => {
    const exact = [entry.model, `${entry.provider} ${entry.model}`].some((name) => name.toLowerCase() === q)
    const loose = words.some((word) => `${entry.provider} ${entry.model}`.toLowerCase().includes(word))
    return exact || loose ? [{ ...entry, exact }] : []
  })
}

/** A host that gives each subagent the model its key names, or `fallback` when none is named. */
function modelPort(fallback?: AgentRuntimeModel, store = recordingSubagentPort()) {
  const port: SubagentPort = {
    ...store.port,
    findModels,
    async configure(subagent) {
      const options = await store.port.configure(subagent)
      const named = MODELS.find((model) => model.key === subagent.modelKey)
      const model = subagent.modelKey === undefined ? fallback : named
      return { ...options, ...(model ? { model } : {}) }
    }
  }
  return { ...store, port }
}

/** A parent that delegates once with `input` and lets the subagent report. */
function delegating(input: Record<string, unknown>) {
  return routedModel(({ userText, humanText }) => {
    if (userText.includes('TASK-A')) return reply('REPORT-A')
    if (humanText === 'Delegate')
      return [
        toolCallPart('call_a', 'subagent', { description: 'Check A', prompt: 'TASK-A', ...input }),
        finish('tool-calls')
      ]
    return reply('OK.')
  })
}

const childRequests = (requests: { sessionId: string | undefined; model: { id: string } }[], parentId: string) =>
  requests.filter((request) => request.sessionId !== parentId)

describe('subagent models', () => {
  // Breaks when a model the user named is not the one the subagent runs on, or the origin entry
  // records another model (a continuation would switch models).
  it('runs the subagent on the one model the user named', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5' })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents[0].modelKey).toBe(SONNET_OR.key)
    expect(childRequests(requests, session.sessionId).map((request) => request.model.id)).toEqual(['sonnet-4.5'])
    const origin = host.events.get(host.subagents[0].sessionId)![0]
    expect(origin).toMatchObject({ type: 'transcript-append', entries: [{ data: { modelKey: SONNET_OR.key } }] })
  })

  // Breaks when the package picks a provider for the user among several matches.
  it('asks the model to let the user choose when several providers have the named model', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'Claude Sonnet 4.5' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents).toEqual([])
    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'Several models match "Claude Sonnet 4.5":\n- OpenRouter / Claude Sonnet 4.5\n- Anthropic / Claude Sonnet 4.5\nAsk the user which one to use, then call subagent again with the provider and model name.'
    )
  })

  // Breaks when an unmatched name silently falls back to the parent's model.
  it('fails with similar names when no model matches', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'Sonnet 9' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(host.subagents).toEqual([])
    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'No enabled model with tool support matches "Sonnet 9". Similar: OpenRouter / Claude Sonnet 4.5, Anthropic / Claude Sonnet 4.5'
    )
  })

  // Breaks when a host that does not provide the named model gets the parent's model silently.
  it('fails the launch when the host does not provide the named model', async () => {
    const recording = recordingSubagentPort()
    const port: SubagentPort = { ...recording.port, findModels }
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5' })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      'The subagent needs the model or::sonnet, which the app did not provide.'
    )
  })

  // Breaks when a fork may switch models, which loses the prompt cache it shares with the parent.
  it('refuses a model for a fork', async () => {
    const host = modelPort()
    const { model } = delegating({ model: 'OpenRouter Claude Sonnet 4.5', fork: true })
    const { session } = await createTestSession({ port: streamTextPort(model).port, subagents: host.port })
    await session.prompt('Delegate')

    expect(textOf(toolResultOf(session, 'call_a'))).toBe(
      "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
    )
  })

  // Breaks when the host's default subagent model is ignored, or the origin entry does not record it.
  it("runs on the host's default subagent model when none is named, else on the parent's", async () => {
    const withDefault = modelPort(DEFAULT_SUB)
    const first = delegating({})
    const firstPort = streamTextPort(first.model)
    const one = await createTestSession({ port: firstPort.port, subagents: withDefault.port })
    await one.session.prompt('Delegate')
    expect(withDefault.subagents[0].modelKey).toBeUndefined()
    expect(childRequests(firstPort.requests, one.session.sessionId).map((request) => request.model.id)).toEqual([
      'small-model'
    ])
    expect(withDefault.events.get(withDefault.subagents[0].sessionId)![0]).toMatchObject({
      entries: [{ data: { modelKey: DEFAULT_SUB.key } }]
    })

    const withoutDefault = modelPort()
    const second = delegating({})
    const secondPort = streamTextPort(second.model)
    const two = await createTestSession({ port: secondPort.port, subagents: withoutDefault.port })
    await two.session.prompt('Delegate')
    expect(childRequests(secondPort.requests, two.session.sessionId).map((request) => request.model.id)).toEqual([
      MODEL.id
    ])
  })

  // Breaks when a continuation asks the host for its default model instead of the first run's.
  it('continues a subagent on the model its first run used', async () => {
    const host = modelPort(DEFAULT_SUB, storingSubagentPort())
    const { model, calls } = routedModel(({ userText, humanText, lastText }) => {
      if (userText.includes('TASK-A')) return reply(lastText === 'AGAIN' ? 'REPORT-2' : 'REPORT-1')
      if (humanText === 'Delegate')
        return [subagentCall('call_a', { description: 'Check A', prompt: 'TASK-A' }), finish('tool-calls')]
      if (humanText === 'Again')
        return [
          toolCallPart('call_msg', 'message_subagent', { id: host.subagents[0].sessionId, message: 'AGAIN' }),
          finish('tool-calls')
        ]
      return reply('OK.')
    })
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port, subagents: host.port })
    await session.prompt('Delegate')
    await session.prompt('Again')
    await waitFor(() => calls.some((call) => call.lastText.includes('REPORT-2')))

    expect(host.subagents[1].modelKey).toBe(DEFAULT_SUB.key)
    expect(new Set(childRequests(requests, session.sessionId).map((request) => request.model.id))).toEqual(
      new Set(['small-model'])
    )
  })

  // Breaks when the model gets a parameter the host cannot honor.
  it('offers no model parameter when the host cannot find models', async () => {
    const { model, calls } = delegating({})
    const { session } = await createTestSession({
      port: streamTextPort(model).port,
      subagents: recordingSubagentPort().port
    })
    await session.prompt('Delegate')

    const tool = calls[0].options.tools?.find((candidate) => candidate.name === 'subagent')
    expect(Object.keys((tool as { inputSchema: { properties: object } }).inputSchema.properties)).toEqual([
      'description',
      'prompt',
      'fork',
      'background'
    ])
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts`

Expected: FAIL. `subagentModel.test.ts` fails: `model` is not a parameter yet, so `configure` gets no `modelKey`, the subagent runs on the parent's model and no error lists several or similar models.

- [ ] **Step 3: Implement**

Only `exact` candidates count (none: similar names; several: ask the user). With `modelKey` set the host must return that model; a host that returns none is given the parent's model only when the key is the parent's (Spec amendment 5). A new fork always keeps the parent's model.

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -45,6 +45,7 @@
   SUBAGENT_TOOL_NAME,
   type Subagent,
   type SubagentDetails,
+  type SubagentModelCandidate,
   type SubagentOutcome,
   type SubagentPort,
   type SubagentSessionOptions,
````

Apply to `packages/agent-runtime-pi/src/session.ts`:

````diff
--- a/packages/agent-runtime-pi/src/session.ts
+++ b/packages/agent-runtime-pi/src/session.ts
@@ -156,7 +156,7 @@
       createSession: ({ fork, ...overrides }) =>
         createAgentRuntimeSession({ ...options, ...overrides, subagents: fork ? options.subagents : undefined }),
       parentTranscript: () => tap.entries(),
-      parentModelKey: key,
+      parentModel: options.model,
       emit: (event) => options.onEvent?.(event),
       offload: options.offload
     })
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -11,7 +11,7 @@
 
 import type { ToolOutputOffload } from './offload'
 import type { ToolApprovalEvent } from './ports'
-import type { AgentRuntimeSession } from './session'
+import type { AgentRuntimeModel, AgentRuntimeSession } from './session'
 import { renderStatus, shortenResult, SubagentDelivery } from './subagentDelivery'
 import {
   DEFAULT_MAX_BACKGROUND,
@@ -27,6 +27,7 @@
   MAX_SUBAGENT_REQUESTS,
   openChild,
   originEntry,
+  pickModel,
   readOrigin,
   type RunEnd,
   type RunResult,
@@ -67,6 +68,22 @@
   onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
   /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
   maxBackground?: number
+  /**
+   * Finds models by the name the user said: only enabled models that support tool calls. Without
+   * it, `subagent` has no `model` parameter. The package picks among the candidates (spec §6.7).
+   */
+  findModels?(query: string): Promise<readonly SubagentModelCandidate[]>
+}
+
+/** A model `findModels` matched. */
+export interface SubagentModelCandidate {
+  /** Unique: one model of one provider, the `modelKey` the transcript records. */
+  key: string
+  /** Display names, e.g. "OpenRouter" and "Claude Sonnet 4.5". */
+  provider: string
+  model: string
+  /** The query is the model name, or the provider and model name, exactly. */
+  exact: boolean
 }
 
 /** The subagent about to be created or continued. */
@@ -81,7 +98,10 @@
   fork: boolean
   /** Whether this run is in the background; a continuation always is. */
   background: boolean
-  /** When it is continued: the model its first run used, from its origin entry. */
+  /**
+   * The model the host must give it: the one the `model` parameter named (unset otherwise: the host
+   * picks its default subagent model), or for a continuation the one its first run used.
+   */
   modelKey?: string
 }
 
@@ -95,6 +115,12 @@
   onEvent?: (event: AgentRuntimeEvent) => void
   /** Called before the subagent's first model request; subscribe to its live output here. */
   onSessionCreated?: (session: AgentSession) => void
+  /**
+   * The model it runs on. Required for `Subagent.modelKey` (that key's model), or the launch or
+   * continuation fails; otherwise the host's default subagent model, the parent's when unset.
+   * Ignored for a new fork, which keeps the parent's model.
+   */
+  model?: AgentRuntimeModel
 }
 
 /** How a subagent's run ended. */
@@ -118,8 +144,8 @@
   createSession: CreateSubagentSession
   /** The parent's transcript so far, including the running turn. */
   parentTranscript: () => readonly TranscriptEntry[]
-  /** Key of the parent's model, recorded as the model a subagent runs on. */
-  parentModelKey: string
+  /** The parent's model, a subagent's unless the host gives it another. */
+  parentModel: AgentRuntimeModel
   /** The parent's `onEvent`. */
   emit: (event: AgentRuntimeEvent) => void
   /** The parent's offload, also used for long results in notifications. */
@@ -211,7 +237,32 @@
   isError: true
 })
 
-const parameters = Type.Object({
+const FORK_WITH_MODEL =
+  "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
+/** Similar names an unmatched `model` error lists. */
+const SIMILAR = 5
+
+/** The key of the one model `query` names (spec §6.7); several or none throw for the model to resolve. */
+async function resolveModel(port: SubagentPort, query: string): Promise<string> {
+  const found = await port.findModels!(query)
+  const exact = found.filter((candidate) => candidate.exact)
+  const name = (candidate: SubagentModelCandidate) => `${candidate.provider} / ${candidate.model}`
+  if (exact.length === 1) return exact[0].key
+  if (exact.length > 1)
+    throw new Error(
+      [
+        `Several models match "${query}":`,
+        ...exact.map((candidate) => `- ${name(candidate)}`),
+        'Ask the user which one to use, then call subagent again with the provider and model name.'
+      ].join('\n')
+    )
+  const similar = found.slice(0, SIMILAR).map(name)
+  throw new Error(
+    `No enabled model with tool support matches "${query}".${similar.length > 0 ? ` Similar: ${similar.join(', ')}` : ''}`
+  )
+}
+
+const baseParameters = {
   description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
   prompt: Type.String({ description: 'The task for the subagent.' }),
   fork: Type.Optional(
@@ -223,6 +274,16 @@
     Type.Boolean({
       description:
         'Return at once and let the subagent work in the background; you are notified when it finishes. Default false.'
+    })
+  )
+}
+const parameters = Type.Object(baseParameters)
+const parametersWithModel = Type.Object({
+  ...baseParameters,
+  model: Type.Optional(
+    Type.String({
+      description:
+        'Only when the user (or the agent instructions) names a model for this task: the name as they said it, with the provider if they gave one, e.g. "OpenRouter Claude Sonnet 4.5". Leave it out otherwise.'
     })
   )
 })
@@ -235,7 +296,7 @@
   port,
   createSession,
   parentTranscript,
-  parentModelKey,
+  parentModel,
   emit,
   offload
 }: SubagentToolOptions): { extension: ExtensionFactory; controls: SubagentControls } {
@@ -285,7 +346,7 @@
       if (inSubagent) return
       ctx = context
       main = { registry, delivery }
-      const { records, undelivered } = restoreSubagents(branch, parentModelKey)
+      const { records, undelivered } = restoreSubagents(branch, parentModel.key)
       registry.restore(records)
       delivery.restore(undelivered)
       unsubscribeApproval = port.onApproval?.((event) => registry.approval(event))
@@ -312,7 +373,8 @@
       name: SUBAGENT_TOOL_NAME,
       label: 'Subagent',
       description: DESCRIPTION,
-      parameters,
+      // Without findModels the host cannot honor a model, so the model is not offered one.
+      parameters: (port.findModels ? parametersWithModel : parameters) as typeof parametersWithModel,
       exposure: 'model-only',
       async execute(toolCallId, params, signal, _onUpdate, ctx) {
         if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
@@ -321,25 +383,30 @@
         if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
         const fork = params.fork ?? false
         const background = params.background ?? false
+        const named = port.findModels ? params.model?.trim() : undefined
+        if (named && fork) throw new Error(FORK_WITH_MODEL)
         const subagent: Subagent = {
           parentToolCallId: toolCallId,
           sessionId: randomUUID(),
           description,
           fork,
-          background
+          background,
+          ...(named ? { modelKey: await resolveModel(port, named) } : {})
         }
         const release = background ? registry.reserveBackground() : () => {}
         const inbox = new SubagentInbox()
         let child: AgentRuntimeSession
+        let modelKey: string
         try {
           // Built before `configure`, so a failure building the fork transcript never reaches the host.
           const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
           const options = await port.configure(subagent)
           // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
           if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
-          const origin = originEntry({ parentToolCallId: toolCallId, fork, description, modelKey: parentModelKey })
-          const start = [...prefix, origin]
-          child = await openChild({ subagent, options, transcript: start, handOff: start, inbox, createSession })
+          const model = pickModel(subagent, options, parentModel)
+          modelKey = model.key
+          const start = [...prefix, originEntry({ parentToolCallId: toolCallId, fork, description, modelKey })]
+          child = await openChild({ subagent, options, model, transcript: start, handOff: start, inbox, createSession })
         } finally {
           release()
         }
@@ -349,7 +416,7 @@
           description,
           fork,
           background,
-          modelKey: parentModelKey,
+          modelKey,
           run: 1,
           status: 'running'
         }
@@ -394,10 +461,13 @@
           modelKey: origin.modelKey
         }
         const options = await port.configure(subagent)
+        const model = pickModel(subagent, options, parentModel)
+        record.modelKey = model.key
         const answers = answerInterrupted(stored)
         child = await openChild({
           subagent,
           options,
+          model,
           transcript: [...stored, ...answers],
           handOff: answers,
           inbox,
````

Apply to `packages/agent-runtime-pi/src/subagentRun.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagentRun.ts
+++ b/packages/agent-runtime-pi/src/subagentRun.ts
@@ -4,7 +4,7 @@
 import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
 import type { ToolCallPart } from 'ai'
 
-import type { AgentRuntimeSession } from './session'
+import type { AgentRuntimeModel, AgentRuntimeSession } from './session'
 import type { Subagent, SubagentSessionOptions } from './subagent'
 import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
 import type { AgentRuntimeEvent } from './transcriptTap'
@@ -51,6 +51,7 @@
   transcript: TranscriptEntry[]
   extensionFactories: NonNullable<SubagentSessionOptions['extensionFactories']>
   onEvent: ((event: AgentRuntimeEvent) => void) | undefined
+  model: AgentRuntimeModel
   /** A fork keeps `subagent` registered so its tools match the parent's. */
   fork: boolean
 }
@@ -212,9 +213,27 @@
  * prefix and origin entry, a continuation's answers to interrupted calls) go to its `onEvent` first,
  * so the host's copy is the whole transcript.
  */
+/** The model a subagent runs on (spec §6.7). */
+export function pickModel(
+  subagent: Subagent,
+  options: SubagentSessionOptions,
+  parentModel: AgentRuntimeModel
+): AgentRuntimeModel {
+  if (subagent.modelKey !== undefined) {
+    if (options.model?.key === subagent.modelKey) return options.model
+    // A host that never picks models runs every subagent on the parent's model.
+    if (!options.model && subagent.modelKey === parentModel.key) return parentModel
+    throw new Error(`The subagent needs the model ${subagent.modelKey}, which the app did not provide.`)
+  }
+  // A fork shares the parent's prompt cache, which another model cannot use.
+  if (subagent.fork) return parentModel
+  return options.model ?? parentModel
+}
+
 export async function openChild(input: {
   subagent: Subagent
   options: SubagentSessionOptions
+  model: AgentRuntimeModel
   /** The whole transcript the session starts from. */
   transcript: TranscriptEntry[]
   /** Its entries the host has not stored yet. */
@@ -229,7 +248,8 @@
     transcript,
     fork: subagent.fork,
     extensionFactories: [input.inbox.extension, ...(options.extensionFactories ?? [])],
-    onEvent: options.onEvent
+    onEvent: options.onEvent,
+    model: input.model
   })
   try {
     options.onSessionCreated?.(child.session)
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm exec eslint packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/tests/subagent.test.ts packages/agent-runtime-pi/tests/subagentContinue.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/subagentModel.test.ts packages/agent-runtime-pi/src/index.ts packages/agent-runtime-pi/src/session.ts packages/agent-runtime-pi/src/subagent.ts packages/agent-runtime-pi/src/subagentRun.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): pick subagent models by the name the user gives"
```

### Task 11: Goals with background subagents

Spec: §3 product defaults (goal), §11.1–§11.5, §14 (L5 row), D5

**Files:**
- Create: `packages/agent-runtime-pi/tests/goalSubagents.test.ts`
- Modify: `packages/agent-runtime-pi/src/goalState.ts`, `packages/agent-runtime-pi/src/goalExtension.ts`, `packages/agent-runtime-pi/src/subagent.ts`, `packages/agent-runtime-pi/tests/goalState.test.ts`, `packages/agent-runtime-pi/tests/goalStops.test.ts`

**Interfaces:**
- Consumes (Tasks 2–10): `SubagentRegistry.runningBackground`/`stop`, `SUBAGENT_NOTIFICATION_TYPE`, `SubagentNotificationDetails`, `SubagentDetails`, `SUBAGENT_TOOL_NAME`.
- Produces (`subagent.ts`, internal, not exported from `index.ts`): `SUBAGENT_GOAL_LINK = 'cherry.subagent-goal-link'`; `interface SubagentGoalLink { running(): number; stopForBudget(sessionIds: Iterable<string>): void; guardBackground(refusal: () => string | undefined): void }`, emitted on `pi.events` at the main session's `session_start`.
- Produces (`goalState.ts`): `turnStarter(entries: readonly SessionEntry[]): 'human' | 'round' | 'notification'`; `isHumanTurn` is `turnStarter(...) === 'human'`; `GoalStopCode` loses `waiting_subagents`.
- Produces (`goalExtension.ts`): `GoalPort.hasRunningSubagents` removed; `GoalPort.onApproval` ignores calls not executing in this session.

- [ ] **Step 1: Write the failing tests**

Spec §15 goal rows; a unit test for `turnStarter`.

Apply to `packages/agent-runtime-pi/tests/goalState.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/goalState.test.ts
+++ b/packages/agent-runtime-pi/tests/goalState.test.ts
@@ -19,8 +19,10 @@
   resumeGoal,
   stopGoal,
   tailRound,
-  toolCallKey
+  toolCallKey,
+  turnStarter
 } from '../src/goalState'
+import { SUBAGENT_NOTIFICATION_TYPE } from '../src/subagentDelivery'
 
 const limits = { maxGoalRounds: 100, maxGoalRoundsCeiling: 1000 }
 
@@ -71,7 +73,6 @@
       'approval_denied',
       'awaiting_approval',
       'needs_user_input',
-      'waiting_subagents',
       'provider_error',
       'continuation_rejected',
       'unsupported_model'
@@ -263,6 +264,14 @@
   content: 'injected',
   display: false
 })
+const notificationEntry = (id: string): SessionEntry => ({
+  ...base(id),
+  type: 'custom_message',
+  customType: SUBAGENT_NOTIFICATION_TYPE,
+  content: 'Background subagent update',
+  display: false,
+  details: { subagents: [] }
+})
 const stateEntry = (id: string, data: unknown): SessionEntry => ({
   ...base(id),
   type: 'custom',
@@ -308,6 +317,25 @@
       isHumanTurn([roundEntry('r', 1), assistantEntry('a', 'x'), otherMessage('o'), assistantEntry('b', 'y')])
     ).toBe(false)
     expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok'), otherMessage('o')])).toBe(true)
+  })
+
+  // Breaks when a notification's turn passes for a human turn (the model could create or change a
+  // goal no person asked for), or a person's turn stops being one because a notification rode with it.
+  it('tells a notification turn from a human turn the notification rode with', () => {
+    expect(
+      turnStarter([
+        userEntry('u', 'do it'),
+        assistantEntry('a', 'ok'),
+        notificationEntry('n'),
+        assistantEntry('b', 'read')
+      ])
+    ).toBe('notification')
+    expect(turnStarter([userEntry('u', 'do it'), notificationEntry('n'), assistantEntry('a', 'ok')])).toBe('human')
+    expect(
+      turnStarter([roundEntry('r', 1), assistantEntry('a', 'x'), notificationEntry('n'), assistantEntry('b', 'y')])
+    ).toBe('notification')
+    expect(turnStarter([notificationEntry('n'), assistantEntry('a', 'x'), roundEntry('r', 2)])).toBe('round')
+    expect(isHumanTurn([userEntry('u', 'do it'), assistantEntry('a', 'ok'), notificationEntry('n')])).toBe(false)
   })
 
   it('reads the round committed after the last message, past entries other extensions append', () => {
````

Apply to `packages/agent-runtime-pi/tests/goalStops.test.ts`:

````diff
--- a/packages/agent-runtime-pi/tests/goalStops.test.ts
+++ b/packages/agent-runtime-pi/tests/goalStops.test.ts
@@ -505,18 +505,6 @@
     expect(lastAssistant(s).stopReason).toBe('aborted')
     expect(snapshots(host.entries)).toEqual([])
     expect(notices(host.entries)).toEqual(['Goal: Keep working\nPhase: active · disarmed\nRounds: 1/100 · Tokens: 0'])
-  })
-
-  // Breaks when decide() never asks the port: the goal would open round 2 while subagents still run.
-  it('a host reporting running subagents ends the goal after the round with waiting_subagents', async () => {
-    const { session: s, host, calls } = await goalSession([working], goalPort({ hasRunningSubagents: () => true }))
-    await promptIdle(s, '/goal Keep working')
-    expect(lastSnapshot(host.entries)).toMatchObject({
-      phase: 'blocked',
-      roundsStarted: 1,
-      lastStop: { code: 'waiting_subagents' }
-    })
-    expect(calls).toHaveLength(1)
   })
 })
 
````

Create `packages/agent-runtime-pi/tests/goalSubagents.test.ts`:

````ts
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { SubagentPort, ToolApprovalEvent } from '../src'
import {
  goalPort,
  lastSnapshot,
  notices,
  openGoalSession,
  promptIdle,
  rounds,
  roundStart,
  snapshots
} from './goalSupport'
import {
  gate,
  recordingSubagentPort,
  type RoutedCall,
  routedModel,
  subagentCall,
  subagentStates,
  toolCallPart,
  toolResultOf,
  waitFor
} from './subagentSupport'
import { finish, textParts } from './support'
import { textOf } from './toolResults'

const NOTE = 'Background subagent update (automatic message, not from the user):'
const reply = (text: string, input = 10): LanguageModelV3StreamPart[] => [
  ...textParts('t', text),
  finish('stop', input, 0)
]
/** A background launch; the description never holds the task marker the routes look for. */
const bg = (id: string, task: string) =>
  subagentCall(id, { description: `Check ${task.slice('TASK-'.length)}`, prompt: task, background: true })
const isNotice = (call: RoutedCall) => call.lastText.startsWith(NOTE)
const round = (call: RoutedCall) => (call.lastRole === 'user' ? roundStart(call.options.prompt) : undefined)
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** The user messages a request ends with: what started it. */
const trailingUserTexts = (call: RoutedCall) => {
  const texts: string[] = []
  for (let i = call.options.prompt.length - 1; i >= 0; i--) {
    const message = call.options.prompt[i]
    if (message.role !== 'user') break
    texts.unshift(message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''))
  }
  return texts
}

describe('goal and background subagents', () => {
  // Breaks when a goal blocks while its background subagents work, writes a snapshot for the wait,
  // or never goes on once their notification turn settles.
  it('waits for its background subagents and goes on after their notification', async () => {
    const held = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (round(call) === 1) return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call)) return reply('Read the report.')
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      subagents: recordingSubagentPort().port
    })
    await promptIdle(s, '/goal Check A')
    const waiting = snapshots(host.entries).length
    expect(lastSnapshot(host.entries)).toMatchObject({ phase: 'active', roundsStarted: 1 })
    await s.prompt('/goal')
    expect(notices(host.entries).at(-1)).toMatch(/\nWaiting for 1 background subagent$/)

    held.open()
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')

    expect(snapshots(host.entries).length).toBeGreaterThan(waiting)
    expect(
      calls.filter((call) => round(call) !== undefined || isNotice(call)).map((call) => round(call) ?? 'notice')
    ).toEqual([1, 'notice', 2])
    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })

  // Breaks when a request carries a goal round and a notification together (two starts in one request).
  it('lets the notification turn settle before the next round when both are due at one settle', async () => {
    const held = gate()
    const parentStates = { finished: () => false }
    const waitHere = defineTool({
      name: 'wait_here',
      label: 'Wait',
      description: 'Waits for A',
      parameters: Type.Object({}),
      async execute() {
        held.open()
        await waitFor(() => parentStates.finished())
        return { content: [{ type: 'text', text: 'waited' }], details: undefined }
      }
    })
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (round(call) === 1) return [bg('call_a', 'TASK-A'), toolCallPart('wait_1', 'wait_here'), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      tools: [waitHere],
      subagents: recordingSubagentPort().port
    })
    parentStates.finished = () => subagentStates(host.entries).some((state) => state.status === 'finished')
    await promptIdle(s, '/goal Check A')

    const starts = calls
      .filter((call) => call.lastRole === 'user' && !call.userText.includes('TASK-A'))
      .map((call) =>
        trailingUserTexts(call).map((text) =>
          text.startsWith(NOTE)
            ? 'notice'
            : `round ${roundStart([{ role: 'user', content: [{ type: 'text', text }] }])}`
        )
      )
    expect(starts).toEqual([['round 1'], ['notice'], ['round 2']])
  })

  // Breaks when a notification turn counts as a human turn: the model could create or change a goal
  // no person asked for.
  it('refuses create_goal in a notification turn', async () => {
    const held = gate()
    const { model } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A'))
      if (call.humanText === 'Check A in the background') return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call))
        return [toolCallPart('call_goal', 'create_goal', { objective: 'Fix everything A found' }), finish('tool-calls')]
      return reply('OK.')
    })
    const { session: s, host } = await openGoalSession(model, goalPort(), { subagents: recordingSubagentPort().port })
    await s.prompt('Check A in the background')
    held.open()
    await waitFor(() => {
      try {
        return textOf(toolResultOf(s, 'call_goal')).length > 0
      } catch {
        return false
      }
    })

    expect(textOf(toolResultOf(s, 'call_goal'))).toMatch(/needs a direct human request/)
    expect(snapshots(host.entries)).toEqual([])
  })

  // Breaks when the parent's own usage in a notification turn is left out of an armed goal's budget,
  // or the usage of a subagent the goal did not start is put in.
  it("counts the parent's notification turn toward an armed goal, not a human turn's subagent", async () => {
    const held = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A')) return held.wait(reply('REPORT-A', 5_000))
      if (call.humanText === 'Check A in the background') return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      if (isNotice(call)) return reply('Read the report.', 1_000)
      if (round(call) === 1) {
        // Round 1 settles while A still works, so its notification turn comes while the goal waits.
        void held.reached.then(() => setTimeout(held.open, 30))
        return reply('working')
      }
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(model, goalPort({ defaults: { maxGoalRounds: 2 } }), {
      subagents: recordingSubagentPort().port
    })
    await s.prompt('Check A in the background')
    await held.reached
    await promptIdle(s, '/goal Keep working')
    await waitFor(() => rounds(host.entries).length === 2)

    // Round 1 (10 + 2 cached) and the notification turn (1000 + 2 cached); A's 5002 tokens are the human turn's.
    expect(snapshots(host.entries).find((snapshot) => snapshot.roundsStarted === 2)).toMatchObject({
      tokensUsed: 1_014
    })
  })

  // Breaks when a background subagent the goal started runs past the goal's budget unseen: its usage
  // must count at delivery, new background launches must be refused and running ones stopped.
  it("counts its subagents' usage, then refuses and stops background subagents once the budget is used up", async () => {
    const heldB = gate()
    const heldC = gate()
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-B')) return heldB.wait(reply('REPORT-B', 5_000))
      if (call.userText.includes('TASK-C')) return heldC.wait(reply('REPORT-C'))
      if (round(call) === 1) return [bg('call_b', 'TASK-B'), bg('call_c', 'TASK-C'), finish('tool-calls')]
      if (round(call) === 2) return [bg('call_d', 'TASK-D'), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ defaults: { maxGoalRounds: 5, budget: { tokens: 3_000 } } }),
      { subagents: recordingSubagentPort().port }
    )
    await promptIdle(s, '/goal Check B and C')
    await heldC.reached
    heldB.open()
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')

    expect(
      subagentStates(host.entries).find((state) => state.description === 'Check C' && state.status === 'finished')
    ).toMatchObject({
      outcome: 'stopped',
      stoppedBy: 'budget'
    })
    expect(rounds(host.entries).map((details) => details.kind)).toEqual(['work', 'wrap-up'])
    expect(textOf(toolResultOf(s, 'call_d'))).toBe(
      "The goal's budget is used up; background subagents cannot be started."
    )
    expect(lastSnapshot(host.entries)).toMatchObject({ lastStop: { code: 'budget_exhausted' } })
  })

  // Breaks when a subagent's denied call stops the parent's goal: the host's one approval registry
  // reports both, and providers may reuse call ids across sessions.
  it("ignores a subagent's denied approval, even under a call id the parent used", async () => {
    const listeners = new Set<(event: ToolApprovalEvent) => void>()
    const onApproval = (listener: (event: ToolApprovalEvent) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
    const denyAll: ExtensionFactory = (pi) => {
      pi.on('tool_call', (event) => {
        for (const listener of listeners) listener({ kind: 'denied', toolCallId: event.toolCallId })
        return { block: true, reason: 'denied' }
      })
    }
    const risky = defineTool({
      name: 'risky',
      label: 'Risky',
      description: 'Needs approval',
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: 'text', text: 'done' }], details: undefined }
      }
    })
    const { model, calls } = routedModel((call) => {
      if (call.userText.includes('TASK-A'))
        return call.lastText.includes('TASK-A')
          ? [toolCallPart('call_a', 'risky'), finish('tool-calls')]
          : reply('REPORT-A')
      if (round(call) === 1) return [bg('call_a', 'TASK-A'), finish('tool-calls')]
      return reply(`working ${calls.length}`)
    })
    const recording = recordingSubagentPort(() => ({ extensionFactories: [denyAll] }))
    const subagents: SubagentPort = { ...recording.port, onApproval }
    const { session: s, host } = await openGoalSession(
      model,
      goalPort({ onApproval, defaults: { maxGoalRounds: 2 } }),
      {
        tools: [risky],
        subagents
      }
    )
    await promptIdle(s, '/goal Check A')
    await waitFor(() => lastSnapshot(host.entries)?.phase === 'blocked')
    await settle()

    expect(lastSnapshot(host.entries)).toMatchObject({ roundsStarted: 2, lastStop: { code: 'round_limit' } })
  })
})
````

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts`

Expected: FAIL. `goalSubagents.test.ts` fails: the goal opens round 2 while its background subagent still works, a request carries a goal round and a notification together, `create_goal` succeeds in a notification turn, notification-turn and subagent usage never reach the budget, and a subagent's denial stops the goal; `goalState.test.ts` fails with `turnStarter is not a function`. Delete the old `waiting_subagents` test in `goalStops.test.ts` and its entry in `goalState.test.ts` (the stop code no longer exists).

- [ ] **Step 3: Implement**

The goal waits (no round, no stop, no snapshot) while background subagents run, yields when its settle already carries a notification, counts an armed goal's notification turns and its own background subagents' delivered usage, refuses background launches and stops its subagents once the budget is used up, and ignores approval events of calls not executing in its own session.

Apply to `packages/agent-runtime-pi/src/goalExtension.ts`:

````diff
--- a/packages/agent-runtime-pi/src/goalExtension.ts
+++ b/packages/agent-runtime-pi/src/goalExtension.ts
@@ -1,12 +1,15 @@
-import { StringEnum, Type } from '@earendil-works/pi-ai'
+import { type AssistantMessage, StringEnum, type ToolResultMessage, Type } from '@earendil-works/pi-ai'
 import {
   type AgentBeforeSettleEvent,
   type AgentBeforeSettleEventResult,
   type AgentToolResult,
   buildSessionContext,
   convertToLlm,
+  type CustomMessageEntryDraft,
   type ExtensionContext,
-  type ExtensionFactory
+  type ExtensionFactory,
+  type SessionBoundaryDraft,
+  type SessionEntry
 } from '@earendil-works/pi-coding-agent'
 
 import { ASK_USER_TOOL_NAME, type AskUserQuestionDetails } from './askUserExtension'
@@ -35,11 +38,19 @@
   type RoundDetails,
   stopGoal,
   tailRound,
-  toolCallKey
+  toolCallKey,
+  turnStarter
 } from './goalState'
 import { type ConversationModelMessage, toModelMessages } from './modelMessages'
 import type { ToolApprovalEvent } from './ports'
-import { isSubagentSession } from './subagent'
+import {
+  isSubagentSession,
+  SUBAGENT_GOAL_LINK,
+  SUBAGENT_TOOL_NAME,
+  type SubagentDetails,
+  type SubagentGoalLink
+} from './subagent'
+import { SUBAGENT_NOTIFICATION_TYPE, type SubagentNotificationDetails } from './subagentDelivery'
 
 /** Host-side completion check; without it the extension falls back to runtime checks (spec §9). */
 export interface GoalVerifier {
@@ -65,10 +76,11 @@
     autonomy: () => 'auto' | 'confirm-each-round'
   }
   modelSupportsTools(): boolean
-  /** Wired by the host integration (its ToolApprovalRegistry): approval events of this session's tool calls. */
+  /**
+   * Wired by the host integration (its ToolApprovalRegistry): approval events of this session's
+   * tool calls. Events of other calls (a subagent's) are ignored.
+   */
   onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
-  /** L6: background subagents of this session still running; foreground subagents finish inside their call. */
-  hasRunningSubagents?(): boolean
   verify?: GoalVerifier
 }
 
@@ -83,6 +95,8 @@
 /** Identical calls in a row within one round before they are blocked, and before the goal stops (spec §7.2). */
 const BLOCK_REPEAT_AT = 3
 const STOP_REPEAT_AT = 5
+const BUDGET_REFUSAL = "The goal's budget is used up; background subagents cannot be started."
+
 /** Sent after the goal view when a completion is accepted (spec §7.5). */
 const COMPLETE_INSTRUCTION =
   'The goal is complete. End your turn with a short summary for the user of what was delivered and how it was checked; do not start new work.'
@@ -92,7 +106,7 @@
 // 0 counts as omitted (weak models fill optional fields with it); negatives reach the limit checks.
 const hasNumber = (value: number | undefined): value is number => value !== undefined && value !== 0
 
-function statusText(goal: GoalSnapshot, armed: boolean): string {
+function statusText(goal: GoalSnapshot, armed: boolean, waitingFor: number): string {
   const stop = goal.lastStop
     ? ` (${goal.lastStop.code}${goal.lastStop.message ? ` — ${goal.lastStop.message}` : ''})`
     : ''
@@ -100,8 +114,37 @@
     `Goal: ${goal.objective}`,
     `Phase: ${goal.phase}${stop} · ${armed ? 'armed' : 'disarmed'}`,
     `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds} · Tokens: ${goal.tokensUsed}` +
-      (goal.costUsed > 0 ? ` · Cost: $${goal.costUsed.toFixed(4)}` : '')
+      (goal.costUsed > 0 ? ` · Cost: $${goal.costUsed.toFixed(4)}` : ''),
+    ...(goal.phase === 'active' && waitingFor > 0
+      ? [`Waiting for ${waitingFor} background subagent${waitingFor === 1 ? '' : 's'}`]
+      : [])
   ].join('\n')
+}
+
+const isNotificationDraft = (draft: SessionBoundaryDraft): draft is CustomMessageEntryDraft =>
+  draft.type === 'custom_message' && draft.customType === SUBAGENT_NOTIFICATION_TYPE
+
+/** The background subagents the goal's rounds started: their usage counts toward its budget (spec §11.4). */
+function goalSubagentsOf(entries: readonly SessionEntry[], goalId: string): Set<string> {
+  const ids = new Set<string>()
+  let inRound = false
+  for (const entry of entries) {
+    if (entry.type === 'custom_message' && entry.customType === GOAL_ROUND_TYPE)
+      inRound = (entry.details as RoundDetails).goalId === goalId
+    else if (entry.type === 'message' && entry.message.role === 'user') inRound = false
+    else if (entry.type === 'custom_message' && entry.customType === SUBAGENT_NOTIFICATION_TYPE) inRound = false
+    else if (inRound && entry.type === 'message' && entry.message.role === 'toolResult') {
+      const id = launchedInBackground(entry.message)
+      if (id) ids.add(id)
+    }
+  }
+  return ids
+}
+
+/** The id of a subagent a `subagent` result started or moved to the background. */
+function launchedInBackground(result: ToolResultMessage): string | undefined {
+  const details = result.details as SubagentDetails | undefined
+  return result.toolName === SUBAGENT_TOOL_NAME && details?.background === true ? details.sessionId : undefined
 }
 
 const createParams = Type.Object({
@@ -151,6 +194,10 @@
   roundAdmitted: boolean
   /** This is a subagent's session: the goal belongs to the main agent (spec §8.4). */
   inSubagent: boolean
+  /** Tool calls of this session executing now; approval events of other calls are not the goal's. */
+  ownCalls: Set<string>
+  /** Background subagents this goal's rounds started. */
+  goalSubagents: Set<string>
 }
 
 /**
@@ -185,8 +232,14 @@
       blocked: { round: 0, count: 0 },
       pendingUsage: { tokens: 0, usd: 0 },
       roundAdmitted: false,
-      inSubagent: false
-    }
+      inSubagent: false,
+      ownCalls: new Set(),
+      goalSubagents: new Set()
+    }
+    let subagents: SubagentGoalLink | undefined
+    pi.events.on(SUBAGENT_GOAL_LINK, (link) => {
+      subagents = link as SubagentGoalLink
+    })
     const limits = () => ({
       maxGoalRounds: port.defaults.maxGoalRounds,
       maxGoalRoundsCeiling: port.defaults.maxGoalRoundsCeiling,
@@ -206,6 +259,8 @@
       runtime.blocked = { round: 0, count: 0 }
       runtime.roundAdmitted = false
     }
+    const usedUp = () =>
+      runtime.goal !== undefined && budgetExceeded(recordUsage(runtime.goal, runtime.pendingUsage, false))
     /** Every persisted change goes through here; pending usage rides along when it is the same goal's. */
     const commit = (next: GoalSnapshot) => {
       const withUsage = next.id === runtime.goal?.id ? recordUsage(next, runtime.pendingUsage, false) : next
@@ -240,6 +295,7 @@
     const create = (goal: GoalSnapshot) => {
       commit(goal)
       resetGoalRuntime()
+      runtime.goalSubagents = new Set()
       runtime.armed = true
       // A round still running belongs to the previous goal; the new one counts from its own first round.
       runtime.inGoalRound = false
@@ -305,8 +361,13 @@
       runtime.goal = currentGoal(entries)
       runtime.armed = false
       runtime.inGoalRound = false
+      if (runtime.goal) runtime.goalSubagents = goalSubagentsOf(entries, runtime.goal.id)
+      subagents?.guardBackground(() =>
+        runtime.goal?.phase === 'active' && runtime.armed && usedUp() ? BUDGET_REFUSAL : undefined
+      )
       unsubscribeApproval = port.onApproval?.((event) => {
-        if (!runtime.goal || !runtime.inGoalRound) return
+        // The host's registry also reports the subagents' calls; only this session's are the goal's.
+        if (!runtime.goal || !runtime.inGoalRound || !runtime.ownCalls.has(event.toolCallId)) return
         if (event.kind === 'denied')
           runtime.stopRequest = { code: 'approval_denied', message: `tool call ${event.toolCallId} was denied` }
         if (event.kind === 'unavailable')
@@ -567,6 +628,8 @@
         return undefined
       }
       if (!goal || goal.phase !== 'active') return undefined
+      // Spec §11.2: one start per request; the notification's turn settles first, then the goal decides.
+      if (event.entries.some(isNotificationDraft)) return undefined
       if (runtime.stopRequest) {
         const { code, message } = runtime.stopRequest
         runtime.stopRequest = undefined
@@ -580,10 +643,8 @@
       }
       // Pi continues for a queued user message, not for an extension message that starts no turn.
       if (event.context.pendingMessages.some((message) => message.role === 'user')) return undefined
-      if (port.hasRunningSubagents?.() === true) {
-        stop('waiting_subagents')
-        return undefined
-      }
+      // Spec §11.4: the goal's own background subagents stop with its budget.
+      if (usedUp()) subagents?.stopForBudget(runtime.goalSubagents)
       if (runtime.noProgressRounds >= STOP_AFTER_ROUNDS) {
         stop('no_progress')
         return undefined
@@ -592,6 +653,8 @@
         stop(goal.roundsStarted >= goal.maxGoalRounds ? 'round_limit' : 'budget_exhausted')
         return undefined
       }
+      // Spec §11.1: background subagents still at work; their notification starts the next turn.
+      if ((subagents?.running() ?? 0) > 0) return undefined
       // The budget check sees this round's usage; the next snapshot write folds it in.
       const projected = recordUsage(goal, runtime.pendingUsage, false)
       const round = { type: 'custom_message' as const, ...roundMessage(projected, reserve(projected)) }
@@ -607,7 +670,12 @@
       // A round a command sent: its message_end comes after turn_start, before Pi persists it.
       else if (message.role === 'custom' && message.customType === GOAL_ROUND_TYPE)
         admit(message.details as RoundDetails)
-    })
+      // A notification that starts a turn or rides with a prompt; one merged at a settle has no message_end.
+      else if (message.role === 'custom' && message.customType === SUBAGENT_NOTIFICATION_TYPE)
+        countDelivered(message.details as SubagentNotificationDetails)
+    })
+    pi.on('tool_execution_start', (event) => void runtime.ownCalls.add(event.toolCallId))
+    pi.on('tool_execution_end', (event) => void runtime.ownCalls.delete(event.toolCallId))
 
     pi.on('tool_call', (event) => {
       if (!runtime.goal || !runtime.inGoalRound || event.parentToolCallId !== undefined) return undefined
@@ -628,17 +696,40 @@
       }
     })
 
-    pi.on('turn_end', (event) => {
-      if (!runtime.goal || !runtime.inGoalRound || event.message.role !== 'assistant') return
-      const { usage } = event.message
+    /** A turn's usage, with what its tools report: a foreground subagent's requests. */
+    const addTurnUsage = (message: AssistantMessage, results: readonly ToolResultMessage[]) => {
+      const { usage } = message
       runtime.pendingUsage.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
       runtime.pendingUsage.usd += usage.cost.total
-      for (const result of event.toolResults) {
-        // A tool's own usage (a subagent's requests) counts too: the host billed it, the budget has not seen it.
+      // A tool's own usage (a subagent's requests) counts too: the host billed it, the budget has not seen it.
+      for (const result of results)
         if (result.usage) {
           runtime.pendingUsage.tokens += result.usage.totalTokens
           runtime.pendingUsage.usd += result.usage.cost.total
         }
+    }
+    /** Spec §11.4: a run of the goal's background subagents counts once its notification reaches the model. */
+    const countDelivered = (details: SubagentNotificationDetails) => {
+      for (const item of details.subagents)
+        if (runtime.goalSubagents.has(item.sessionId)) {
+          runtime.pendingUsage.tokens += item.usage.totalTokens
+          runtime.pendingUsage.usd += item.usage.cost.total
+        }
+    }
+
+    pi.on('turn_end', (event, ctx) => {
+      if (!runtime.goal || event.message.role !== 'assistant') return
+      if (!runtime.inGoalRound) {
+        // Spec §11.3: a notification's turn works for an armed goal, so its usage counts, but it is no round.
+        const forGoal = runtime.goal.phase === 'active' && runtime.armed
+        if (forGoal && turnStarter(ctx.sessionManager.getBranch()) === 'notification')
+          addTurnUsage(event.message, event.toolResults)
+        return
+      }
+      addTurnUsage(event.message, event.toolResults)
+      for (const result of event.toolResults) {
+        const launched = launchedInBackground(result)
+        if (launched) runtime.goalSubagents.add(launched)
         if (isProgressResult(result)) runtime.round.toolProgress = true
         // Stored sessions and thrown calls carry no `outcome`.
         if (
@@ -654,6 +745,8 @@
 
     pi.on('agent_before_settle', (event, ctx) => {
       if (runtime.inSubagent) return undefined
+      for (const draft of event.entries)
+        if (isNotificationDraft(draft)) countDelivered(draft.details as SubagentNotificationDetails)
       // A request the host aborted through its own signal settles here; agent_settled reports aborted: false.
       if (event.outcome === 'aborted') {
         runtime.inGoalRound = false
@@ -685,7 +778,7 @@
           if (input === '') {
             notice(
               runtime.goal
-                ? statusText(runtime.goal, runtime.armed)
+                ? statusText(runtime.goal, runtime.armed, subagents?.running() ?? 0)
                 : 'No goal is set. Use /goal <objective> to create one.'
             )
             return
````

Apply to `packages/agent-runtime-pi/src/goalState.ts`:

````diff
--- a/packages/agent-runtime-pi/src/goalState.ts
+++ b/packages/agent-runtime-pi/src/goalState.ts
@@ -2,6 +2,8 @@
 
 import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai'
 import type { SessionEntry } from '@earendil-works/pi-coding-agent'
+
+import { SUBAGENT_NOTIFICATION_TYPE } from './subagentDelivery'
 
 export const GOAL_STATE_TYPE = 'cherry.goal'
 export const GOAL_ROUND_TYPE = 'cherry.goal-round'
@@ -20,7 +22,6 @@
   | 'approval_denied'
   | 'awaiting_approval'
   | 'needs_user_input'
-  | 'waiting_subagents'
   | 'provider_error'
   | 'aborted'
   | 'paused_by_user'
@@ -265,15 +266,30 @@
 }
 
 const isRoundMessage = (entry: SessionEntry) => entry.type === 'custom_message' && entry.customType === GOAL_ROUND_TYPE
-
-/** True when the last user-side input on the branch came from a person, not from a goal round. */
-export function isHumanTurn(entries: readonly SessionEntry[]): boolean {
+const isNotification = (entry: SessionEntry) =>
+  entry.type === 'custom_message' && entry.customType === SUBAGENT_NOTIFICATION_TYPE
+
+/**
+ * What started the turn the branch ends in: a person, a goal round, or a background-subagent
+ * notification (spec §11.3). A notification that rode with a person's message is part of their turn.
+ */
+export function turnStarter(entries: readonly SessionEntry[]): 'human' | 'round' | 'notification' {
+  let notification = false
   for (let i = entries.length - 1; i >= 0; i--) {
     const entry = entries[i]
-    if (isRoundMessage(entry)) return false
-    if (entry.type === 'message' && entry.message.role === 'user') return true
-  }
-  return true
+    if (isRoundMessage(entry)) return 'round'
+    if (isNotification(entry)) notification = true
+    else if (entry.type === 'message') {
+      if (entry.message.role === 'user') return 'human'
+      if (notification) return 'notification'
+    }
+  }
+  return notification ? 'notification' : 'human'
+}
+
+/** True when the last user-side input on the branch came from a person, not from a goal round or a notification. */
+export function isHumanTurn(entries: readonly SessionEntry[]): boolean {
+  return turnStarter(entries) === 'human'
 }
 
 /**
````

Apply to `packages/agent-runtime-pi/src/subagent.ts`:

````diff
--- a/packages/agent-runtime-pi/src/subagent.ts
+++ b/packages/agent-runtime-pi/src/subagent.ts
@@ -152,6 +152,19 @@
   offload: ToolOutputOffload | undefined
 }
 
+/** Pi event-bus channel on which this extension hands the goal extension its link (spec §11.4). */
+export const SUBAGENT_GOAL_LINK = 'cherry.subagent-goal-link'
+
+/** What the goal extension of the same session asks of its subagents; internal to the package. */
+export interface SubagentGoalLink {
+  /** Background subagents running or waiting for an approval. */
+  running(): number
+  /** Stops those of `sessionIds` still running, as the goal's budget is used up. */
+  stopForBudget(sessionIds: Iterable<string>): void
+  /** While `refusal()` returns a message, background launches and continuations fail with it. */
+  guardBackground(refusal: () => string | undefined): void
+}
+
 /** What the parent's `AgentRuntimeSession` reaches through to its subagents. */
 export interface SubagentControls {
   /** Held by a host prompt or compaction until it returns; no notification starts a run meanwhile. */
@@ -312,6 +325,11 @@
     let ctx: ExtensionContext | undefined
     let inSubagent = false
     let unsubscribeApproval: (() => void) | undefined
+    let backgroundRefusal: () => string | undefined = () => undefined
+    const refuseBackground = () => {
+      const refusal = backgroundRefusal()
+      if (refusal) throw new Error(refusal)
+    }
     const registry = new SubagentRegistry({
       appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
       emit,
@@ -350,6 +368,14 @@
       registry.restore(records)
       delivery.restore(undelivered)
       unsubscribeApproval = port.onApproval?.((event) => registry.approval(event))
+      const link: SubagentGoalLink = {
+        running: () => registry.runningBackground(),
+        stopForBudget: (sessionIds) => {
+          for (const sessionId of sessionIds) void registry.stop(sessionId, 'budget')
+        },
+        guardBackground: (refusal) => (backgroundRefusal = refusal)
+      }
+      pi.events.emit(SUBAGENT_GOAL_LINK, link)
     })
     // After a compaction the model no longer sees its subagent calls; this keeps it from starting them again.
     pi.on('session_compact', () => {
@@ -393,6 +419,7 @@
           background,
           ...(named ? { modelKey: await resolveModel(port, named) } : {})
         }
+        if (background) refuseBackground()
         const release = background ? registry.reserveBackground() : () => {}
         const inbox = new SubagentInbox()
         let child: AgentRuntimeSession
@@ -444,6 +471,7 @@
     /** A finished subagent's next run, in the background, from the transcript the host stored. */
     const continueSubagent = async (record: SubagentRecord, message: string, toolCallId: string) => {
       const id = record.sessionId
+      refuseBackground()
       const release = registry.reserveBackground()
       const inbox = new SubagentInbox()
       let child: AgentRuntimeSession
````

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts`

Expected: PASS, every test in these files.

- [ ] **Step 5: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/subagent.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/subagent.ts
pnpm exec eslint packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/subagent.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm exec vitest run --project agent-runtime packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goal.test.ts packages/agent-runtime-pi/tests/goalRebuild.test.ts
pnpm test:agent-runtime
```

Expected: oxfmt leaves the files as given, oxlint and eslint report nothing, typecheck exits 0, both test runs pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-pi/tests/goalState.test.ts packages/agent-runtime-pi/tests/goalStops.test.ts packages/agent-runtime-pi/tests/goalSubagents.test.ts packages/agent-runtime-pi/src/goalExtension.ts packages/agent-runtime-pi/src/goalState.ts packages/agent-runtime-pi/src/subagent.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "feat(agent-runtime): let goals wait for and budget their background subagents"
```

### Task 12: README and exports

Spec: §13 (host contract), §14 (README rows)

**Files:**
- Modify: `packages/agent-runtime-pi/README.md`, `packages/agent-runtime-pi/src/index.ts`

**Interfaces:**
- Consumes (Tasks 1–11): every public name above.
- Produces: `index.ts` exports `MESSAGE_SUBAGENT_TOOL_NAME`, `STOP_SUBAGENT_TOOL_NAME`, `SUBAGENT_MESSAGE_TYPE`, `SUBAGENT_ORIGIN_STATE`; the README's Subagents section rewritten, the goal bullet, approval notes and Known gaps updated.

- [ ] **Step 1: Update the README and the exports**

No test: documentation and re-exports only (a test that a name is exported would only pin it).

Apply to `packages/agent-runtime-pi/README.md`:

````diff
--- a/packages/agent-runtime-pi/README.md
+++ b/packages/agent-runtime-pi/README.md
@@ -38,9 +38,10 @@
   `statusCode` and `responseBody`), and `onUnmappedPart` receives `source`, `file` and
   provider-executed tool parts. Both get the request identity. Pi keeps only the error message, as
   the provider wrote it, so Pi's context-overflow detection still works.
-- **Usage** – the usage handed to Pi feeds its context accounting and compaction only. A `subagent`
-  result also carries its subagent's summed usage on the tool result, for budgets. The host's AI SDK
-  calls already account all of it, so it must not be billed again.
+- **Usage** – the usage handed to Pi feeds its context accounting and compaction only. A foreground
+  `subagent` result also carries its subagent's summed usage on the tool result, and a background
+  run's notification carries it in `details`, for budgets. The host's AI SDK calls already account
+  all of it, so it must not be billed again.
 - **Retries** – Pi's retry is always disabled. Retries belong to the AI SDK layer.
 - **Model identity** – every model has a host `key` (in Cherry, the unique model id). Assistant
   entries store it, and on rebuild only replies with the current key replay their reasoning as
@@ -57,7 +58,9 @@
 factories, the model descriptor, compaction and Pi settings such as `shellCommandPrefix`. It may
 opt in to workspace `AGENTS.md` / `CLAUDE.md` context files and to explicit skill directories, as
 Cherry's current Pi runtime does. `dispose()` aborts the running turn, emits `session_shutdown` to
-extensions and disposes the session.
+extensions and disposes the session. `prompt()` and `compact()` wrap `session.prompt` and
+`session.compact`; the host starts every user turn and manual compaction through them (see
+Subagents). `stopSubagent()` and `backgroundSubagent()` are the user's controls for subagents.
 
 ## Transcript
 
@@ -89,7 +92,8 @@
   request.
 - **Output** – `onEvent` receives `transcript-append` with new entries in Pi order, each exactly
   once; `compaction-start` / `compaction-end` (after the compaction entry was appended); and
-  `turn-complete` with the head entry id when a run settles. Pi `system`, `model_change`,
+  `turn-complete` with the head entry id when a run settles; `subagents` with the background
+  subagents after each change of one of them. Pi `system`, `model_change`,
   `thinking_level_change` and `usage` entries are never emitted: the host owns the prompt, the
   model and billing.
 - **Tool loadout** – tools activated beyond the session's base tools (by `tool_search`) are
@@ -137,39 +141,83 @@
 
 ## Subagents
 
-`subagents: SubagentPort` registers `subagent({ description, prompt, fork? })`, a `model-only` tool with DSH's
-name, so Cherry's renderer shows it as a Task card. Each call builds a session in-process from the
-parent's options (port, request options, model, prompts, tools, compaction, offload, recall,
-settings) plus the extensions the host returns from `SubagentPort.configure(subagent)`, starts it
-with `session.prompt()` so `before_agent_start` handlers run as in any turn, waits for it to settle
-and disposes it. It shares the parent's `sideChannel`, so its requests' errors and unmapped parts
-reach the parent's side channel, told apart by the request `sessionId`; the parent's
-`extensionFactories` and `onEvent` are not inherited. The call blocks: the subagent's final message
-is the call's result, `details` is `{ sessionId, fork, outcome }`, and the result's `usage` is the
-sum of the subagent's replies (for budgets; the host already accounted each request). Its transcript
-events go only to the `onEvent` the host returned; `onSessionCreated` receives its session before
-its first request. Its session id is `<parent session id>.<random UUID>`, unique per subagent even
-when provider call ids repeat; treat it as opaque. Subagent calls of one step run at the same time,
-and a fresh subagent has no `subagent` tool of its own.
-
-A subagent's session holds a `cherry.subagent-origin` state entry (`{ parentToolCallId, fork }`),
-never sent to the model; `AskUserQuestion` ends there as `unavailable` without asking the port.
-To find a subagent again: once it ends, the parent's tool result carries its id in
-`details.sessionId`; while it runs, or when its call never returns, `configure` has already handed
-the host its `parentToolCallId` and its `sessionId`, which starts with the parent's id. The origin
-entry is part of the transcript the subagent starts from (after the forked prefix for a fork), so
-`onEvent` never emits it; only the live session that `onSessionCreated` receives holds it.
-
-`fork: true` starts the subagent from the parent's transcript up to the assistant message holding the
-call, every call of that message answered by the same placeholder, so forks of one step send the same
-prefix and can share the prompt cache. A fork keeps the parent's tools, `subagent` included, and the
-host must return the parent's extensions for it; calls a subagent may not make (another `subagent`,
-`AskUserQuestion`, the goal tools) fail or end as `unavailable` instead of being removed.
-
-A subagent that fails, is cut off by its output limit, is aborted with the parent's turn or would
-start a 201st model request returns an `isError` result with the reason, its last partial output,
-`details` and `usage`; `outcome` is `failed`, `truncated`, `aborted` or `limit_reached`. A host
-whose `configure` throws fails that call only.
+`subagents: SubagentPort` registers three `model-only` tools: `subagent({ description, prompt,
+fork?, background?, model? })` with DSH's name, so Cherry's renderer shows it as a Task card,
+`message_subagent({ id, message })` and `stop_subagent({ id })` (`SUBAGENT_TOOL_NAME`,
+`MESSAGE_SUBAGENT_TOOL_NAME`, `STOP_SUBAGENT_TOOL_NAME`). Design:
+`docs/superpowers/specs/2026-10-14-agent-runtime-background-subagent-design.md`.
+
+Each `subagent` call builds a session in-process from the parent's options (port, request options,
+model, prompts, tools, compaction, offload, recall, settings) plus the extensions the host returns
+from `SubagentPort.configure(subagent)`, and starts it with `session.prompt()` so
+`before_agent_start` handlers run as in any turn. It shares the parent's `sideChannel`, told apart by
+the request `sessionId`; the parent's `extensionFactories` and `onEvent` are not inherited. Its
+session id is a random UUID: the id the model addresses it by and the key the host stores it under.
+A run makes at most 200 model requests. Calls of one step run at the same time. A fresh subagent has
+none of the three tools; a fork keeps them, so its tools match the parent's, and they fail with
+`Subagents cannot start or manage subagents.`
+
+- **Foreground** (the default) – the call blocks. Its result is the final message followed by
+  `(id: … — continue this subagent with message_subagent.)`, `details`
+  `{ sessionId, fork, background: false, outcome }` and `usage`, the sum of the subagent's replies.
+  A run that fails, is cut off by its output limit, is aborted with the parent's turn or would start
+  a 201st request returns an `isError` result with the reason and its last partial output
+  (`outcome` `failed`, `truncated`, `aborted`, `limit_reached`). A host whose `configure` throws
+  fails that call only. `backgroundSubagent(sessionId)` moves a running foreground subagent to the
+  background: the call returns at once (`details.background: true`) and the same run goes on; the
+  parent's turn no longer stops it.
+- **Background** (`background: true`) – the call returns its id at once, and stopping the parent's
+  turn does not stop the subagent. At most `maxBackground` (default 20) run at once. When a run
+  ends, its result reaches the parent as a `cherry.subagent-notification` custom message (a user
+  message to the model; `details` is `SubagentNotificationDetails`): merged into the parent's run
+  as it settles, or, when the parent is idle, as the start of a new run, which the host shows as an
+  autonomous turn (`background-work`). Never in the middle of a run; a queued user message goes
+  first, and results that end together go in one message. After the user stops a turn, nothing
+  starts on its own until their next prompt, which pending results ride with. A report over the
+  offload threshold (20,000 characters without offload) is saved through the offload store, or cut
+  to its head and tail.
+- **Messages** – `message_subagent` queues a message for a running subagent: it reads it after its
+  current tool batch, and one that comes as it settles starts its next run in the same session.
+  For a finished subagent it loads the stored transcript (`SubagentPort.load`), configures the
+  same subagent again (`continuedBy`, and `modelKey` from its origin entry), answers tool calls an
+  interrupted run left open with an "interrupted" result and runs the message in the background,
+  after a recovery hint when the last run was interrupted or aborted. Without `load`, finished
+  subagents cannot be continued. The id must be one this conversation started.
+- **Stopping** – `stop_subagent` stops a running subagent and returns its partial output; no
+  notification follows, and it can be continued. `stopSubagent(sessionId)` is the user's stop
+  button for a background subagent: the parent hears of it only with its next message, and it
+  cannot be continued. Disposing the parent stops and disposes every subagent session.
+
+With `SubagentPort.findModels`, `subagent` takes a `model` the user named: the package resolves it
+among the exact candidates the host finds (none or several fail and tell the model what to ask) and
+hands the key to `configure` as `Subagent.modelKey`, for which the host must return that model in
+`SubagentSessionOptions.model`. Without a named model the host may return its default subagent
+model; otherwise the subagent runs on the parent's. A fork always keeps the parent's model, and a
+continuation the model of its first run.
+
+The host's approval extension comes from `configure` and labels each request with `Subagent`.
+`SubagentPort.onApproval` (the host's one approval registry) marks a subagent `awaiting_approval`
+while one of its calls waits; the parent sees this in the `subagents` event, its status message and
+errors that list subagents.
+
+The parent records each background run in `cherry.subagent-state` snapshots (started; finished with
+its outcome, result and usage), never sent to the model, and `onEvent` gets
+`{ type: 'subagents', subagents: SubagentView[] }` after each change. A rebuilt parent restores its
+subagents from them and from `subagent` results: a run whose last snapshot is `running` was cut off
+(`interrupted`) and can be continued; such runs, and results that never reached the parent, ride
+with the user's next message, once. After a compaction a `cherry.subagent-status` message lists the
+background subagents still running and the results not delivered yet.
+
+A subagent's `onEvent` receives its whole transcript: the first `transcript-append` holds its start
+entries, the forked prefix and a `cherry.subagent-origin` state entry
+(`{ parentToolCallId, fork, description, modelKey }`, never sent to the model). The host stores it
+per `sessionId` to implement `load`. `onSessionCreated` receives the live session before its first
+request. `AskUserQuestion` ends as `unavailable` inside a subagent without asking the port.
+
+Host contract: start user turns with `AgentRuntimeSession.prompt` and manual compactions with
+`compact`, never `session.prompt` or `session.compact` directly (Pi reports a preparing prompt as
+idle, and a notification run would collide with it); do not dispose or rebuild the parent while
+background subagents run.
 
 ## Extensions
 
@@ -205,8 +253,8 @@
   the runtime's and sets `phase` and `lastStop`: round cap (the last allowed round is a wrap-up),
   token or USD budget, no progress (two rounds hint, three stop; the same tool call three times in
   a row within a round is blocked, five times ends the goal), a denied approval, an approval nobody
-  can give or a dismissed question in a goal round, background subagents the host reports as
-  running, a round another extension's settle handler overrides, and a failed request or an abort
+  can give or a dismissed question in a goal round, a round another extension's settle handler
+  overrides, and a failed request or an abort
   (`session.abort()` or the host's own request signal) while the goal is armed. A stop's snapshot
   counts tokens, cost and progress up to the stop; requests later in the same round (the summary
   after `complete`) are not in it. `update_goal(complete)` passes the host's `GoalVerifier` (it
@@ -228,7 +276,13 @@
   handled: a command that starts a round ends with `turn-complete` as usual, the others (the
   status, a pause while idle, …) produce none. A rebuilt session restores the goal disarmed;
   `/goal resume` continues it. The budget also counts the `usage` a tool result carries, so a
-  `subagent` call's requests count toward it. When `port.modelSupportsTools()` is false, no tools
+  `subagent` call's requests count toward it. While background subagents run, an armed goal waits
+  (no round, no stop; `/goal` shows `Waiting for N background subagents`) and goes on after their
+  notification's turn settles. That turn is neither a human turn nor a goal round; while the goal
+  is armed its usage counts toward the budget, and so does the usage of background subagents the
+  goal's rounds started, once delivered. Once the budget is used up, background launches fail and
+  the goal's running background subagents stop. `port.onApproval` events of calls not executing in
+  this session (a subagent's) are ignored. When `port.modelSupportsTools()` is false, no tools
   or command are registered and an active goal is blocked with `unsupported_model`. In a
   subagent's session the goal tools fail with `in_subagent`, nothing continues and
   `port.onApproval` is not subscribed, so a fork ignores the goal entries it inherits. Design:
@@ -241,8 +295,9 @@
 The host sets `create_goal` to ask for approval, so a goal the model proposes is confirmed by the
 user through the existing approval card. `GOAL_TOOL_NAMES` holds the goal tools' names.
 
-The approval layer may auto-allow `subagent` as long as `SubagentPort.configure()` returns the
-approval extension, so each call the subagent makes is approved on its own.
+The approval layer may auto-allow `subagent`, `message_subagent` and `stop_subagent` as long as
+`SubagentPort.configure()` returns the approval extension, so each call a subagent makes is approved
+on its own.
 
 ## Known gaps
 
@@ -269,10 +324,15 @@
   will is decided when the host is wired up.
 - A fork's requests carry the subagent's session id, so a host that routes prompt caches by session id
   (OpenAI's `prompt_cache_key`) does not reach the parent's cache partition.
-- Goals: no `waiting` state for background work (the goal blocks with `waiting_subagents` when the
-  host reports running background subagents, which only L6 adds) and no fresh-context (Ralph)
-  mode. The package does not know the permission mode; keeping goals from running rounds in plan
-  mode is up to the host.
+- Goals: no fresh-context (Ralph) mode. The package does not know the permission mode; keeping
+  goals from running rounds in plan mode is up to the host.
+- Every fork stores the parent's prefix in its own transcript; a host may deduplicate it.
+- A background result reaches a busy parent only when its run settles, after the whole turn.
+- Shutdown writes no snapshots, so a rebuilt parent cannot tell a closed app from a crash.
+- Messages queued for a running subagent that is then stopped are dropped with it.
+- Approval events find their subagent by call id; two sessions running calls with the same id at
+  the same moment cannot be told apart.
+- A subagent on another model gets the parent's `requestOptions`.
 - A goal continuation that another extension vetoes, or a run aborted during the settle, leaves
   the committed round prompt at the branch tail, so the next request carries it ahead of the next
   user message.
````

Apply to `packages/agent-runtime-pi/src/index.ts`:

````diff
--- a/packages/agent-runtime-pi/src/index.ts
+++ b/packages/agent-runtime-pi/src/index.ts
@@ -42,6 +42,10 @@
   createAgentRuntimeSession
 } from './session'
 export {
+  MESSAGE_SUBAGENT_TOOL_NAME,
+  STOP_SUBAGENT_TOOL_NAME,
+  SUBAGENT_MESSAGE_TYPE,
+  SUBAGENT_ORIGIN_STATE,
   SUBAGENT_TOOL_NAME,
   type Subagent,
   type SubagentDetails,
````

- [ ] **Step 2: Gates**

```bash
pnpm exec oxfmt --write packages/agent-runtime-pi/README.md packages/agent-runtime-pi/src/index.ts
pnpm exec oxlint --deny-warnings packages/agent-runtime-pi/src/index.ts
pnpm exec eslint packages/agent-runtime-pi/src/index.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
pnpm test:agent-runtime
```

Expected: oxlint and eslint report nothing, typecheck exits 0, the whole package suite passes.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime-pi/README.md packages/agent-runtime-pi/src/index.ts
git -c core.hooksPath=/dev/null commit -S --signoff -m "docs(agent-runtime): document background subagents and continuations"
```

## Self-review

**1. Spec coverage** (section → task):

| Spec | Task |
|---|---|
| §1–§2 scope; §14 L4/L5/L2 rows | 1–12 as below |
| D1 delivery | 3 · D2 abort keeps background running: 2, 3 · D3 approvals: 8 (package side) · D4 continuation across restarts: 6, 7 · D5 goal: 11 · D6 three tools: 2, 4, 5 · D7 one id: 1 · D8 package owns table and timing: 2, 3 · D9 move to background: 9 · D10 models: 10 |
| Product defaults: approvals wait in a goal (nothing auto-denies), budget refusal and stop, cap 20, user-stopped quiet and final, notification turns are neither human nor goal turns, suppression after a user abort | 8, 11, 2, 5/6, 11, 3 |
| §4.1 files | 1 (`subagentRun.ts`), 2 (`subagentRegistry.ts`), 3 (`subagentDelivery.ts`) |
| §4.2 record | 2; `stoppedBy` 5; `awaiting_approval` 8. `delivered` is not a field: queue membership is the in-memory truth and notification `details` the persisted one (§4.3 says the same) |
| §4.3 entries and restore rules | origin 1, state 2, notification 3, child message 4, status and restore 7 |
| §4.4 types | `Subagent`/`SubagentDetails`/`SubagentOutcome` 1; `maxBackground`, `subagents` event, `SubagentView` 2; `prompt`/`compact`, `SubagentNotificationDetails` 3; `load`, `continuedBy`, `modelKey` 6; `onApproval`, `ToolApprovalEvent` 8; `backgroundSubagent` 9; `findModels`, `SubagentModelCandidate`, `SubagentSessionOptions.model` 10; `stopSubagent` 5; `hasRunningSubagents` removed 11 |
| §5.1 | foreground trailer 1, background text and cap 2, moved text 9, `model` 10 |
| §5.2 | running row, unknown id, no-`load` row 4; finished rows, user-stopped row, ownership 6 |
| §5.3 | 5 |
| §5.4 | refusal in a fork 4 (+5 for `stop_subagent`), same tool set (fork test, 1/4), lists of 20 4 and 7 |
| §6.1 runner, §6.2 foreground | 1 (inbox 4) |
| §6.3 background, §6.5 fork | 2 (background fork: Review Focus 3) |
| §6.4 inbox | 4 (Spec amendment 1) |
| §6.6, §6.7 | 9, 10 |
| §7.1–§7.6 | 3 (quiet items 5) |
| §7.7, §12 | 7 |
| §8.1 | 1 · §8.2, §8.3, §8.5 6 · §8.4 host (README 12) |
| §9 | shutdown 2, model and user stops 5, budget 11, user abort 2/3, destroy then rebuild 7 |
| §10, §11 | 8, 11 |
| §13 host contract, §16 risks | README and Known gaps, 12 |
| §15 test plan | every row has a test in the task of its feature (background 2; delivery rows 3; `message_subagent` 4 and 6; stops 5; rebuild and compaction 7; approvals 8; goal rows 11; start entries 1 and 6; long results 3; refusal in a subagent 4/5; UUID 1; move 9; models 10) |

Gaps found while reviewing and closed in the plan: §15's "子代理会话里调用 `stop_subagent` 失败" had no test (added to Task 5's fork refusal); "续接重建时不再发起始条目" had no test (Task 6's first test now checks one origin entry and unique ids in the stored copy). The host-only parts of §10 (approval cards) and §13 are documentation for the host integration PR.

**2. Placeholder scan:** no "TBD", "TODO", "similar to Task N", "handle edge cases" or untyped references; every code step carries its code, every test its `// Breaks when …` line.

**3. Type consistency:** the code blocks are generated from the same code at each task, so names agree by construction. Signatures that change between tasks, in order: `subagentExtension` → `createSubagentExtension` (Task 3); `SubagentControls` gains `stopSubagent` (5), `backgroundSubagent` (9); `openChild` gains `inbox` (4), takes `transcript`/`handOff` instead of `prefix`/`parentModelKey` (6), gains `model` (10); `runSubagent` takes `RunStart` and `inbox` (4); `runForeground` resolves `RunResult | undefined` (9); `SUBAGENT_TOOL_NAME` moves to `subagentRun.ts` (7); `SubagentToolOptions.parentModelKey` → `parentModel` (10); `GoalApprovalEvent` → `ToolApprovalEvent` (8).

**4. Review Focus coverage:** item 1 → Task 2 "frees the background slot of a launch that fails" and Task 6 "fails when the host cannot load the transcript, and frees the slot"; item 2 → Task 6 "sends two messages of one step to a single continuation" (fails without the start lock); item 3 → Task 2 "starts a background fork from the conversation as it is"; item 4 → Task 3 "delivers a waiting result in a turn a command starts"; item 5 → Task 6 "leaves no subagent running when the parent is disposed during a continuation".

Choices where the spec is silent (no amendment needed): a run that settles with outcome `error` gets no merged notification, and the idle check right after the settle delivers it; a rebuilt foreground subagent carries the parent's model key until it is continued, when its origin entry's key is used; the `subagents` event lists every background subagent of the session, finished ones included; the `/goal` line says `subagent` for one.

## Spec amendments needed

1. **§6.4, inbox at the child's settle.** Spec: the child's `agent_before_settle` delivers unsent inbox messages as entries with `continue: true`, and a message left when `prompt` returns is re-prompted. Pi: a message pushed while the child runs is steered and Pi continues for it on its own (probe d); the only loss is a steer sent after Pi decided to settle, which stays unread in Pi's queue (probe d2) and which no settle handler can see. Amendment: from the child's own `agent_before_settle` on, the inbox holds new messages instead of steering them; when the run returns, held messages start the next run on the same session (`sendCustomMessage(…, { triggerTurn: true })`); the inbox closes in the same tick as its last check, and a message after that continues the subagent. Behaviour kept: a message that arrives as the subagent settles makes it go on, and none is lost.
2. **§7.5, §7.6, §7.7, §12, `deliverAs: 'nextTurn'`.** Spec: quiet items, results held after a user abort and the rebuild status ride with the next user message via `nextTurn`. Pi: `nextTurn` messages go only with the next real `session.prompt()`; a command such as `/goal resume` starts its run with `sendMessage` and does not carry them, so they wait in Pi's queue unseen by the package (probe c). Amendment: the parent's `before_agent_start` returns them as its `message` (same place, after the user's message), taken only when a prompt really runs; until then they stay in the package's queue and also merge at the next settle (Review Focus 4).
3. **§4.3, §12, rebuild status.** Spec: a `cherry.subagent-status` message after a rebuild, with undelivered notifications merged into it. Problem: with `(sessionId, run)` from notification `details` as the dedupe key, a status message would be said again after every rebuild. Amendment: after a rebuild, interrupted runs (as items with outcome `interrupted`, zero usage) and undelivered results ride in one `cherry.subagent-notification` with the next prompt, so the same key keeps each from being said twice; `cherry.subagent-status` is only the post-compaction list.
4. **§8.1, §8.3, entries handed to the host.** Spec: start entries go out after the child session is built; answers to interrupted calls are added before rebuilding. Problem: if the host never stores the answers, the next continuation loads a transcript whose open call is followed by later messages. Amendment: the answers go to the subagent's `onEvent` as a `transcript-append` before its session is built; the start entries are handed over at the same point (after `configure`, before the session is built), so entries the child's extensions append at `session_start` follow them in the host's append-only copy.
5. **§4.4, §13.5, model of a continuation.** Spec: with `Subagent.modelKey` set the host must return that model, or the launch or continuation fails. Problem: every continuation sets `modelKey`, so a host without model selection could never continue a subagent. Amendment: when the host returns no model and `modelKey` is the parent's current key, the parent's model is used; any other mismatch fails as written.
6. **§7.6, start of the suppression.** Spec: `agent_settled { aborted: true }`. Pi: a turn the host stops through its own request signal settles through `agent_before_settle` with `outcome: 'aborted'` and `agent_settled { aborted: false }` (probe g, L5 note). Amendment: either starts the suppression.
7. **§7.2, notification lines.** The example abbreviates ids (`7c1e…`); the model needs the full id for `message_subagent`, so lines carry full ids. Line forms: `- "<description>" (id: <id>) completed:` + the indented report; `… failed: <reason>`; `… hit its output limit before finishing.`; `… was stopped after 200 model requests.`; `… was aborted.`; `… was stopped because the goal's budget is used up.`; each of those + `Partial output before it stopped:` and the indented partial when there is one; `… was stopped by the user.`; `… was interrupted (the app closed while it was running). Continue it with message_subagent if the work is still needed.`; footer `<n> other background subagent(s) is/are still running.`
