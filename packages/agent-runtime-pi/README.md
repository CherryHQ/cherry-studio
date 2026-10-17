# Pi agent runtime

`createPiRuntime` adapts native Pi 1.3.0 sessions to the common runtime contract.
`create` creates a new access; `open` loads an existing native context and checks its identity.
Concurrent handles share execution and observation. Releasing a handle stops its observation;
shutdown aborts owned sessions and disposes their resources without deleting native storage.


Constructs native Pi coding-agent sessions. The caller supplies Pi's `ModelRuntime` and `Model`;
Pi owns the execution loop, tools, context accounting and compaction. The package has no AI SDK
dependency and imports no Cherry application code.

## Session builder

`createAgentRuntimeSession({ modelRuntime, model, cwd, agentDir, ... })` returns a native
`AgentSession` and an asynchronous `dispose()` method. The model runtime is borrowed: the caller
owns credentials and provider registration, and closing a session does not unregister its providers.
Settings, including retries and thinking level, retain native Pi semantics.

The owner of a model runtime can require things of every session built on it with
`setSessionRequirements(modelRuntime, { extensionFactories, settings })`: the builder installs those
extension factories ahead of the session's own and applies those settings over the session's,
whichever host builds the session. Cherry's AI SDK binding uses it for its tool-call guard and to
keep Pi's retry off.

The builder uses in-memory settings, disables resource discovery, and accepts
explicit tools, extension factories, system prompts, workspace context files and skill directories.
Without a `systemPrompt` Pi's own prompt is used, and Pi appends a `<cwd>` section either way. No
built-in tool is enabled unless `builtinTools` names it. Workspace `AGENTS.md` / `CLAUDE.md` files
load only with `contextFiles: true`, and skills only from the host's `skillPaths`.
`dispose()` aborts execution, lets extensions handle `session_shutdown`, then disposes the session.
Pi is ESM-only; CommonJS hosts must load the package with dynamic `import()`.

Known gap: Pi's resource loader still resolves its discovery directories while it loads; the
`no*` flags and prompt overrides discard everything it finds there.

## Cherry integration

Cherry's AI SDK provider bridge lives in `src/main/ai/runtime/pi/aiSdkModelBinding.ts`. It supplies
native model configuration and, through session requirements, its tool-call guard ahead of approval
handlers. AI SDK conversion, retries, provider metadata and request side channels stay in Cherry.

This package is not wired into the desktop runtime yet. The integration tests live with Cherry's
bridge; `tests/nativeSession.test.ts` verifies native provider execution and borrowed-runtime ownership.

```bash
pnpm test:agent-runtime packages/agent-runtime-pi/tests/nativeSession.test.ts
pnpm --filter @cherrystudio/agent-runtime typecheck
```

## Native session storage

Pass `sessionManager: SessionManager.create(cwd, sessionDir)` to create a persistent session, or
`SessionManager.open(file)` to reopen it. Omit the manager for an in-memory session. The host chooses
the location and records the native session ID/file association. Pi writes and reads its own JSONL;
there is no second transcript schema, message conversion for storage, or host event replay.

A native file includes messages, provider signatures, usage and cost, compaction boundaries,
context edits, branch entries, system state and extension entries. Extensions see restored state
at `session_start`. Activated tools are recorded as a native `cherry.tool-loadout` entry and restored
beside the host's current base tools. Reopening context does not resume work automatically.

Pi creates the file lazily, once a user or assistant message exists. Pi's low-level `open` also
accepts a missing path as a new session; hosts loading an existing association must check its
existence and verify the native session ID instead of silently replacing it.

`onEvent` observes copied native entries (`session-append`), compaction start/end, and completed
turns. These events are for observation; storage works without a listener. A slow listener should
hand off its work because callbacks run inline. `dispose()` flushes the final observations.

## Compaction

Pi's native compaction runs, configured by `compaction: { reserveTokens, keepRecentTokens,
enabled?, summarize? }`: it compacts once the context passes `contextWindow - reserveTokens`, and
compacts and retries once when a request overflows; `enabled: false` turns both off and leaves
`session.compact()` working. The host computes both numbers from its own settings. Without
`summarize`, Pi's default summarizer runs on the session model through its native model runtime.

With `summarize`, the host summarizes with its own prompt and model:
`summarize({ reason, sessionId, model, messages, previousSummary?, instructions?, signal })` gets
the compacting session's id and model and the folded native messages after the session model's
replay rules (failed replies left out, tool calls without a result answered); Cherry converts them
only when it calls its summarization model. The text it returns is stored as the summary as is; Pi
frames it when it builds the next context. A summarizer that fails, or returns an empty summary,
cancels that compaction (it never falls back to the session model), and `compaction-end` carries
the error.

## Tool output offload

`offload: { store, thresholdChars }` keeps one oversized tool result from overflowing the context.
A `tool_result` hook, after every other extension's, saves text output longer than
`thresholdChars` (and than 3,000 characters, so the marker is always shorter than the output)
through the host's `ToolOutputStore` and gives the model its head and tail around a
`<persisted-output>` note with the saved path, to read back with Pi's `read` tool. If the store
throws, the note gives its error instead and the model keeps only the head and tail. Names are
content addressed (`tool-output-<first 16 hex digits of its sha256>.txt`), so the same output gives
the same marker and prompt caches hold. Images and `structuredContent` are kept. Not offloaded:
errors, `read` results (reading an offloaded file back must not offload it again) and nested tool
calls, which reach the model only through their caller. Pi persists the marker, which is what the
model saw.

Host obligation: let `read` open the store's paths without an approval prompt.

## Recall

`recall: true` registers `vcc_recall`, with pi-vcc's tool name and parameters (`query`, `range`,
`expand`, `page`, `scope`, `mode`), so existing tool settings and approvals apply; the host
disables it by name like any tool. It reads the native active branch, including messages a
compaction folded into its summary and the running turn. `#N` is an entry's position among the
branch's user, assistant, tool-result and custom messages, so it stays the same once the session
is reopened.
`query` is a keyword search (entries matching more of the words first, 5 per page), `range:
[from, to]` lists entries in order (20 per page), `expand: [N]` returns full text, and no argument
lists the latest entries. `scope: 'all'` is the same as `'lineage'`.

## Interaction extensions

Factories the host passes in `extensionFactories`. Their tools are `model-only` (never callable
from codemode scripts, so every call stays its own tool part) and use the names Cherry's renderer
already handles.

- **`createTodoExtension()`** – `todo_write` with dsh's schema: `{ todos: { content, status }[] }`,
  status `pending | in_progress | completed`, no other item fields. Every call carries the whole
  list and replaces the previous one; content is trimmed and must be non-empty and unique, and at
  most one todo may be `in_progress`. Invalid lists come back as error results. `details` is
  `{ todos, counts }`. The extension keeps no state: the latest list is the last successful
  `todo_write` result on the native active branch, so it follows forks and edits and the model
  sees it in the history, until a compaction folds that call into the summary.
- **`createAskUserExtension(port)`** – `AskUserQuestion` with Claude Code's input schema (1–4
  questions, each with a `header`, 2–4 options and `multiSelect`; question texts must differ,
  since answers are keyed by them, and so must the option labels of a question, since answers
  name them). The tool waits on `AskUserPort.ask`, which resolves `answered` (`answers`, optional
  `annotations` notes), `declined` (optional `feedback`) or `unavailable` (no one can answer, e.g.
  a channel or scheduled run); inside a subagent's session it ends as `unavailable` without asking
  the port. The result text tells the model what happened; only `answered` is a
  success. Every result the tool returns, aborted included, has `details`
  `{ questions, answers, annotations?, outcome }`, `outcome` being
  `'answered' | 'declined' | 'unavailable' | 'aborted'`; invalid input and a rejecting port fail the
  call with empty `details`. Calls in one model step run one at a time. When the turn aborts, the tool stops
  waiting at once and the request's `signal` aborts so the host can withdraw the question; a late
  answer is ignored. A question pending at a crash is not resumed after a restart.

Host obligations: the approval layer must not ask approval for `AskUserQuestion` (the question is
itself the interaction, or the user would be asked twice) and may auto-allow `todo_write` (it only
changes the session's list). `ASK_USER_TOOL_NAME` and `TODO_TOOL_NAME` hold the names.

## Subagents

`subagents: SubagentPort` registers the `model-only` tool `subagent({ description, prompt, fork? })`
(`SUBAGENT_TOOL_NAME`), with DSH's name, so Cherry's renderer shows it as a Task card. Each call
builds a session in-process from the parent's options (model runtime, model, prompts, tools,
compaction, offload, recall, settings) plus the extensions, native event listener and live-session
callback the host returns from `SubagentPort.configure(subagent)`, and starts it with
`session.prompt()`, so `before_agent_start` handlers run as in any turn. The parent's
`extensionFactories` and `onEvent` are not inherited. Sessions on a model binding's runtime still
get the binding's requirements (Cherry's tool-call guard, Pi's retry off): they come with the
runtime, not with `configure`. A subagent shares its parent's model runtime, so a host's side
channel tells their requests apart by `sessionId`, which is the subagent's own:
`<parent session id>.<random UUID>`. Calls of one step run at the same time. A host whose
`configure` throws fails that call only.

A fresh subagent starts empty and has no `subagent` tool. A fork starts at the native assistant
entry that holds the calling tool: every tool call in that entry gets a placeholder result, so
siblings started together share the same model-visible prefix, and it keeps the `subagent` tool,
so its tools match the parent's, but the tool fails there with
`Subagents cannot start subagents.` The parent's manager and branch are left unchanged.

Children follow their parent's persistence mode. File-backed parents create native child files in
the same session directory, with a native parent-session link; in-memory parents create in-memory
children. Each child records a `cherry.subagent-origin` entry (`{ parentToolCallId, fork }`, never
sent to the model) before its extensions start; it marks a subagent's session.

The call blocks until the subagent's run settles. Its result is the subagent's final message, with
`details` `{ sessionId, fork, outcome }` and `usage`, the sum of the subagent's replies. A run that
fails, is cut off by its output limit, is aborted with the parent's turn or would make a 201st
request returns an `isError` result with the reason and its last partial output (`outcome`
`failed`, `truncated`, `aborted`, `limit_reached`). That `usage` is for budgets: the host's AI SDK
calls already account it, so it must not be billed again.

A subagent makes at most 200 model requests, counted where its session makes them: its turns and
the compaction summaries made for it (Pi's own summarizer through the model runtime, or the host's
`compaction.summarize`) alike; the 201st is refused before it goes out. Counting wraps the child's
native `agent.streamFunction` and the host summarizer, so it is independent of the provider and
does not modify the borrowed model runtime. Pi's cache warmer
would re-send requests past that count, so subagent sessions run with cache warming off. The
compaction summarizer gets the compacting session's id, so a host can tell a subagent's compaction
from its parent's.

Host obligation: the approval layer may auto-allow `subagent` as long as `configure` returns the
approval extension, so each call a subagent makes is approved on its own.

## Goals

`createGoalExtension(port)` adds a persisted objective the runtime keeps pushing while the model is
idle. Design: `docs/superpowers/specs/2026-10-11-agent-runtime-goal-design.md`.

- **State** – native `cherry.goal` entries hold one snapshot per change and a tombstone on clear;
  each round is a `cherry.goal-round` custom message the host maps to the "round N" header. A
  round has run once a snapshot names its id (`admittedRound`, the round message's `details.id`).
  A round prompt no snapshot names (another extension vetoed the continuation, the run was aborted
  at the settle, or the round was withdrawn) stays on the branch and is left out of later model
  requests and of the verifier's conversation; the compaction summarizer still reads it.
- **Rounds** – rounds continue only at `agent_before_settle` and count once Pi sends them on; a
  queued user message always goes first, and its turn does not count for the goal. When
  `port.defaults.autonomy()` returns `confirm-each-round`, every round ends paused. Creating or
  resuming a goal on an idle session starts its first round; during a run it only arms the goal
  for that run's settle. A reopened session restores the goal disarmed and writes that down
  (`armed: false` in a snapshot of the same revision); `/goal resume` continues it.
- **Stops** – every stop sets `phase` and `lastStop.code`. The runtime stops the goal for the
  round cap (`round_limit`; the last allowed round is a wrap-up, and a cap lowered to the running
  round ends the goal with it), the token or USD budget (`budget_exhausted`, after a wrap-up round), no
  progress (`no_progress`: two rounds without progress get a hint, three stop; the same tool call
  three times in a row within a round is blocked, five times ends the goal), a denied approval
  (`approval_denied`), an approval nobody can give (`awaiting_approval`) or a dismissed question
  (`needs_user_input`) in a goal round, a round another extension's settle handler overrides
  (`continuation_rejected`), and, while the goal is armed, a failed request (`provider_error`) or
  an abort (`aborted`: `session.abort()` or the host's own request signal, but see the known
  gaps). While the host's `port.hasRunningSubagents()` reports background subagents running, an
  armed goal blocks with `waiting_subagents` at its settle; no host reports them before background
  subagents arrive (#21693). `/goal pause` stops with `paused_by_user`, `confirm-each-round` with
  `paused_each_round`, `update_goal(blocked)` with `model_blocked` and an accepted completion with
  `complete`.
- **Usage** – never kept: every check (the budget, `resume`, `/goal`, `get_goal`) reads it from the
  branch, so a reopened session sees what the live one saw. It is every request made in one of the
  goal's admitted rounds while the goal was active, judged where the request's input ends (a
  `/goal pause` written while its reply was being handled does not drop it), the request whose tool
  call stopped it included and requests after a stop (the summary after `complete`) never, priced
  at each entry's stored `cost`, plus the `usage` a tool result reports when the request that made
  its call counted (a foreground subagent still running under `/goal pause` counts when it
  returns). Snapshots record that usage when written (`tokensUsed`, `costUsed`) for display only.
- **Progress** – read from the branch too (`goalProgress`): a round moved the objective when one of
  its tool results so far succeeded and does more than read or bookkeep (`read`, `grep`, `find`,
  `ls`, `tool_search`, `vcc_recall`, `get_goal`, `todo_write`, `AskUserQuestion`), or its last
  text-bearing reply (not one cut off by the output limit) differs from the previous round's. An
  aborted round counts for nothing; a person's message, and arming the goal, start the no-progress
  streak over. The completion check, the no-progress stop and hint, the goal view and every
  snapshot read it; a snapshot's `progressRounds` is for display only.
- **Withdrawal** – a round reserved at a settle is checked again when it starts: if a command
  changed the goal meanwhile (a later extension's settle handler was still running), the round is
  withdrawn before its request, and the goal goes on as it now is (a new round, or the stop its new
  limits call for). The host sees a withdrawal as a run that ends aborted (`turn-complete` with
  `aborted: true`) right after that round's prompt, its reply `stopReason: 'error'` with the
  message `This operation was aborted`; it should show it as a withdrawn round, not as a failure or
  a stop the user made.
- **Completion** – `update_goal(complete)` passes the host's `GoalVerifier` (it gets the objective,
  the claim, the session's whole context after compaction as native messages after the session
  model's replay rules, the model, and the call's `signal`; the package sets no timeout) or,
  without one, needs evidence and a round that made progress. An accepted completion also tells
  the model to end its turn with a summary, and a complete goal is final: pause, resume and further
  reports are refused, and new work needs a new goal. `update_goal(blocked)` is accepted at once in
  a human turn and in goal rounds only after `port.defaults.blockedAfter` consecutive rounds report
  it; several reports in one round count once, a human turn, `resume` or a user edit starts the
  count over, and the reasons are not compared.
- **Tools and command** – `get_goal`, `create_goal` and `update_goal` (`GOAL_TOOL_NAMES`) with
  DSH's output shape; the model can create, edit, pause or resume a goal only in a human turn. The
  command `/goal [<objective> | edit <objective> | pause | resume | clear | rounds <n> |
  budget <tokens|$usd>]` makes no model request itself and reports through `cherry.goal-notice`
  entries. `/goal pause` and `/goal clear` abort the running turn only when the goal drives it
  (active and armed). `port.onApproval` events stop the goal only during a goal round.
- **Models and subagents** – when `port.modelSupportsTools()` is false, no tools or command are
  registered and an active goal is blocked with `unsupported_model`. In a subagent's session the
  goal tools fail with `in_subagent`, nothing continues and `port.onApproval` is not subscribed, so
  a fork ignores the goal entries it inherits.

Host obligations: set `create_goal` to ask for approval, so a goal the model proposes is confirmed
by the user through the existing approval card. Show a withdrawn round as described above.

## Known gaps

- `vcc_recall` has no regex search, `mode: 'touched'` (files worked on) or `#N:path` file
  drill-down; compaction summaries do not cite `#N` entries.
- `read` results are never offloaded, and Pi caps them at 2,000 lines or 50 KB, which can still
  overflow a small context window.
- A parallel tool batch whose results together exceed the context window, each below the
  threshold, still overflows; offloading at `turn_end` is deferred.
- Pi's `bash` tool saves the full output of a truncated command to a temp file and names it in the
  result; that file is not moved into the offload store and may be gone when read later.
- A fork's requests carry the subagent's session id, so a host that routes prompt caches by session
  id (OpenAI's `prompt_cache_key`) does not reach the parent's cache partition.
- Every fork's native session holds its own copy of the parent's history (a file-backed fork copies
  the parent's file); a host may deduplicate it.
- Goals have no `waiting` state for background work (the goal blocks with `waiting_subagents` when
  the host reports running background subagents, which only #21693 adds) and no fresh-context
  (Ralph) mode. The package does not know the permission mode; keeping goals from running rounds in
  plan mode is up to the host.
- A `session.abort()` that lands in the run withdrawing a stale goal round (it ends before any
  request) is taken for that withdrawal: the goal goes on instead of pausing.
