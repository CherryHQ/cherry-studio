# Agent Note: Agent history operations and explicit Plan/Goal controls

Status: proposed

English | [中文](2026-11-08-agent-history-operation-boundaries.zh.md)

## Problem

A planning word in a draft currently offers a Plan Mode hint and temporarily changes Shift+Tab handling. Accepting the hint persists the Agent's permission mode, although the affordance is tied to one draft. The user wants explicit Plan and Goal entries in the Quick Panel without input-placeholder hints or draft inference. Shift+Tab must toggle only ordinary/Plan; Goal is selected separately.

History operations have a separate ambiguity. Claude Code and Pi save native fork boundaries and implement desktop fork/edit. Pi Durable can fork a native child conversation but does not expose desktop fork/edit checkpoints. The renderer currently enables fork for a successful assistant row without checking driver support or checkpoint presence. Conversation editing does not restore workspace files.

This Spec owns the concrete follow-up scope and acceptance gates. The [runtime contract](2026-10-17-agent-runtime-contract.md) continues to own product-tree/native-binding semantics; the [boundary ownership proposal](../simplification/2026-11-05-agent-runtime-boundary-ownership.md) owns input, projection and shutdown boundaries. This is an additive proposal, not a claim that those documents or this work are approved or complete. The broader post-merge approval, terminal-result, shutdown and provider-validation findings remain separate work.

### Verified baseline

The source baseline is commit `3ace7c1389454fea8cb02aa3029fefa15dc7c3df`. These facts were checked in code, not newly accepted in Electron or against a live provider.

| Area | Current behavior | Required treatment |
|---|---|---|
| Plan Mode discovery | `PlanModeHint.tsx` renders the hint; `usePlanModeHint.ts` owns keyword and draft state | Remove the entire suggestion path; retain explicit mode selection |
| Claude desktop history | Checkpoint contains native session ID, assistant UUID and config directory; native `forkSession()` remaps UUIDs | Preserve the native implementation and verify the boundary/mapping contract |
| Pi desktop history | Checkpoint contains native session ID and leaf ID; `createBranchedSession()` extracts the selected path | Preserve native branch extraction and reject missing/corrupt history |
| Durable child context | `tx.forkConversation()` creates an owned child from a native entry | Keep this separate from desktop conversation fork |
| Durable desktop history | Driver has no `fork()`; no desktop fork checkpoint is emitted | Present unsupported operation honestly; require a separate native-storage design before enabling it |
| Workspace rewind | No desktop file-checkpoint/rewind integration | Keep history actions free of file rollback and state their scope |

Source owners are [fork operations](../../../../src/main/ai/agentSession/fork/AgentSessionForkOperations.ts), [checkpoint persistence](../../../../src/main/ai/agentSession/persistence/AgentSessionMessageBackend.ts), [Claude fork](../../../../src/main/ai/runtime/claudeCode/claudeFork.ts), [Pi fork](../../../../src/main/ai/runtime/pi/piFork.ts), [Durable driver](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts), and [message action availability](../../../../src/renderer/pages/agents/messages/agentSessionFork.ts).

## Proposal

### 1. Scope and operation names

Deliver hint removal, accurate history-action availability, and the existing Claude/Pi history contracts. Do not add a history manager, another transcript, a generic capability registry, or common Runtime fork/rewind methods.

| Operation | Product effect | Native effect | File effect |
|---|---|---|---|
| Fork conversation | Create a new product conversation and copy the retained prefix with new product message IDs | Create an independent native context at the verified boundary | Copy the current system workspace, or reuse the existing ordinary workspace |
| Edit and resend | Keep the conversation ID; create a sibling input and select its new branch | Fork before the edited input; use a new native binding | Keep current workspace contents |
| Select retained branch | Select an existing product path | Resolve its existing binding when later input is dispatched | No rollback |
| Fork child context | Keep native child ownership and its independent archive | Let the concrete harness inherit the selected native context | Follow existing child workspace policy |
| Rewind files | Not delivered by this Spec | Would require a separately approved file-recovery contract | Would modify files and requires its own preview/conflict rules |

Use “edit and resend” and “fork conversation” for the current product actions. Do not label either as restoring files or rolling back execution. A copied system workspace reflects the copy-time state, not the selected message's historical file state.

### 2. Use explicit Plan and Goal entries

Delete the hint component, keyword matcher, per-draft state and dedicated tests. Remove its imports, accept/dismiss/reset wiring and JSX from `AgentComposer.tsx`, and all `agent.input.plan_hint.*` locale keys. Do not add mode suggestions or mode-specific input placeholders.

Move Plan out of the composer's Permission Mode submenu into an independent Quick Panel toggle. Keep the existing supported-mode filtering and saved native `permission_mode`: Plan selects `plan`; leaving Plan selects `default`. Do not reset existing Agents on mount or introduce another persisted mode. The Agent configuration dialogs keep their existing native permission choices.

Keep `onShiftTab` in both composer surfaces. On supported harnesses, plain Shift+Tab toggles ordinary/Plan regardless of draft wording; it neither sends nor rewrites the draft. Repeated keydown events do not cycle again. Open-panel navigation and prompt-variable navigation retain priority; composition and modified shortcuts do not change modes. Goal never joins this cycle.

Promote the existing native `/goal` command to an independent Goal Mode Quick Panel entry. Selection prefixes the draft with `/goal ` once, preserves existing tokens and focuses the composer; the user supplies the objective and explicitly submits it through the existing native command path. Do not create another Goal state machine or infer a goal from normal text. Pi and Durable advertise their implemented command in the static fallback; Claude shows the entry when its live SDK catalog advertises it. Explicit custom commands are not promoted as native mode controls.

Keep Full Access confirmation, native Plan execution and the shared `useUpdateAgent` consumers for reasoning/service-tier settings. No replacement keyword detector, model classifier, notification or onboarding banner is introduced.

### 3. Keep three different checkpoint purposes distinct

| Value | Owner and consumer | Guarantee |
|---|---|---|
| `runtimeAnchor.checkpoint` | Concrete desktop driver produces it; fork/edit consumes it through Main | Locates a native conversation boundary; it is not a transcript or a file snapshot |
| `checkpointMapping` | Existing context service and product projections/fork mapping | Preserves source-to-product identity and branch-specific checkpoint associations |
| Native Durable task/document checkpoints | Native SDK scheduler and storage | Support their declared native recovery semantics; do not imply desktop fork or file recovery |

Keep the persisted Claude and Pi checkpoint formats. Main routes by runtime and validates product ownership; the concrete native helper validates its own fields and history. Only a successful reply with valid native evidence obtains a fork anchor. If checkpoint capture/persistence fails, preserve the completed answer and make its fork action unavailable; do not fabricate a boundary.

On a native session reset such as Claude `/clear`, prepare the successor context using the current product branch boundary. Commit the handle/context switch only after preparation succeeds. Do not reuse the connection's original `branchHead` for every new native session, weaken the unique anchor constraint, or let old observations overwrite the successor's checkpoint.

### 4. Preserve native fork and edit behavior

Claude continues to freeze the JSONL prefix and call the SDK's `forkSession()` through its existing worker and SessionStore. The SDK allocates new UUIDs. Verify inherited checkpoints, compaction references and content replacements against the returned mapping; unsupported evidence rejects the operation.

Pi continues to open a fixed source snapshot and call `SessionManager.createBranchedSession(leafId)`. Verify the session and leaf before publication and rewrite inherited checkpoint session identities. Do not reconstruct native context from the displayed product text.

A retained product prefix may span several native contexts after `/clear`. Fork the retained boundary of each context separately through the existing adapter, preserving per-context checkpoint mappings and independent native identities. Copy all product messages in the prefix, bind each copied segment to its own prepared context, and resume only the context at the selected boundary. Earlier contexts remain available for historical edits and further forks without entering the selected context’s model history. Prepare every native artifact before publication, revalidate the captured context bindings with the product prefix, and publish the session, messages and bindings in one SQLite transaction. A preparation or publication failure compensates all operation-owned artifacts. Deleting the source must not invalidate either earlier or later copied history. In-place editing forks only its predecessor’s native context and leaves earlier contexts owned by the same product session intact.

For a nonempty edit prefix, require the successful assistant boundary immediately before the edited user input. For an empty first-input prefix, reserve a fresh native identity without inventing a pre-input checkpoint. Preserve this product-tree result:

```text
root
└── U1 → A1
    ├── U2  → A2       (retained)
    └── U2' → A2'      (selected)
```

Main retains the existing edit guard for live/queued/background work, approvals and unconfirmed close. Revalidate the captured history version before selecting the new branch. A failed preparation leaves the old selection intact. After publication, rejected or unknown input stays on the new branch with its actual delivery state; never restore the old tail or resubmit automatically.

### 5. Make action availability match the evidence

Main remains authoritative. Reuse the existing Agent message read model to expose only the action availability actually consumed by the renderer: driver support and the relevant persisted checkpoint/branch validity. Do not expose opaque checkpoints to the renderer merely to duplicate native validation. Listing messages must not open native storage or resume a scheduler.

Keep ordinary message pagination in `AgentSessionMessageService` free of runtime callbacks and action policy. `AgentSessionForkService` batch-reads only the requested messages' boundary fields and their parents, including parents outside the page. A stateless module in `agentSession/fork` owns the common eligibility rules, reusing the selected driver's checkpoint validator. `AgentSessionRuntimeService` composes those decisions for the message-list API; edit preparation and fork/edit execution use the same rules. Missing edit parents and delivery inputs are rejected; a root parent permits first-input editing only on a supported driver. Execution retains branch-specific checkpoint mapping, busy/closing guards, version checks, attachment validation and native-history verification.

Use that result in the existing fork action and edit entry. A successful assistant status alone is insufficient. Durable's unsupported desktop actions must be unavailable with a reason; normal copy/export/delete and explicit permission selection remain independent. History missing after listing is still a typed execution-time error, not permission to rebuild it.

### 6. Retain publication and recovery ownership

Continue using `AgentSessionForkOperations` and its existing resource intent record. Native artifacts are prepared outside the live source, verified, published without overwriting existing files, and then bound to the product tree in a SQLite transaction. Filesystem publication and SQLite are not one atomic transaction; the resource record supports compensation and startup recovery.

Cancellation or a failed write removes only proven operation-owned resources that are not bound to a committed product context. Recovery retains committed contexts and never deletes a different file at a reused path. An explicit conversation fork does not inherit live approval cards, task ownership or execution receipts. Product message IDs and native IDs are remapped at their respective owners; native compaction must not erase the retained product branch.

### 7. Durable and file-rewind enablement gates

The follow-up [Durable desktop fork proposal](../feature/2026-11-09-pi-durable-desktop-fork.md) proposes a shared backend owner instead of a separate target backend, using public same-storage native forks without a new SDK behavior patch. It remains subject to its own Spec approval and verification.

This delivery keeps Durable desktop fork/edit unavailable. Its shared-behavior child fork remains unchanged. Enabling desktop history needs a follow-up proposal with evidence for all of these conditions:

- A pinned committed conversation/entry boundary and matching historical configuration.
- Exclusive source ownership and an isolated target backend that can open after process restart.
- Native preservation of compaction and rewindable documents, without inheriting live task/submission ownership.
- Publication, cancellation and compensation that fit the existing Main resource lifecycle.
- Use of public SDK/storage APIs; any missing export or native operation is an explicit upstream decision before implementation.

A same-store `forkConversation()` call alone does not prove those conditions. Do not copy an active SQLite file, truncate native tables, replay display text, or introduce a second Harness over the source store to fill the gap.

File rewind also remains outside this delivery. A future proposal must distinguish tracked file restoration from arbitrary shell/network effects and define capture time, tracked paths, preview, user-edit conflicts, partial failures, restart behavior and explicit user action. Claude's `rewindFiles()` requires file checkpointing and is not currently called; it is a candidate native capability, not a cross-harness guarantee. Do not create generic filesystem snapshots for Pi/Durable as a fallback.

### 8. Change list and delivery order

| Step | Files or owner | Change | Verification |
|---|---|---|---|
| A | `variants/agent/PlanModeHint.tsx`, `usePlanModeHint.ts`, dedicated test, `AgentComposer.tsx`, both composer surfaces and locale catalogs | Delete draft hints; keep ordinary/Plan Shift+Tab and separate Quick Panel Plan/Goal entries | Composer consumer tests and unmodified Electron Work launch |
| B | `AgentSessionMessageBackend.ts`, existing context/read-model service and Agent message action adapter | Keep checkpoint evidence coherent; publish honest action availability | Real migrated SQLite and renderer action behavior |
| C | `ClaudeCodeRuntimeDriver.ts`, `claudeContext.ts`, existing fork helpers and fork operations | Correct reset boundary handoff; retain SDK identity mapping and publication/compensation | Native SDK contract and Main fork/edit failure cases |
| D | Runtime package/desktop READMEs, Agent runtime reference and action copy | Document exact support and distinguish conversation history from file state | Documentation gates and representative Electron interaction |

Deliver A independently, then B/C with their affected consumers, and finish D against the actual implementation. Do not declare the Spec implemented until all acceptance criteria below have recorded evidence. Durable enablement and file rewind are separate follow-ups, not unverified final stages of this delivery.

### 9. Local implementation verification (2026-11-09)

The local implementation uses the existing driver schemas and message read model. `historyActions` contains nullable fork/edit failure reasons; no native checkpoint is sent to the renderer. The draft hint path is deleted. Explicit Quick Panel controls and ordinary/Plan Shift+Tab use the existing native mode/command paths. Claude reset prepares the current-head successor before switching handles and ignores retired-session results.

| Criteria | Recorded evidence |
|---|---|
| AC1–AC2 | Correction acceptance is recorded separately below; the earlier Shift+Tab-does-not-change-mode check is superseded and does not verify the corrected contract |
| AC3 | Migrated SQLite read-model tests and `AgentSessionMessageBackend.test.ts` cover missing, malformed, foreign and failed-persistence checkpoints without losing completed answers |
| AC4 | Pi SDK leaf/compaction and Claude SDK UUID/unsafe-metadata contract tests; real native JSONL checks exclude later source turns and retain independent identities |
| AC5 | Pi and Claude Electron fork, noninitial edit, first-input edit and branch navigation; persisted edited text and native transcript match the new input |
| AC6 | Runtime-service busy/close guards, publication changed-history/write-failure tests, read-model rejection and Durable forced-edit IPC rejection |
| AC7 | Real temporary files and migrated SQLite publication/recovery tests, prepared-fork cancellation, and worker exit/cancellation/timeout tests |
| AC8 | Main read-model and renderer tests; real Durable fork is disabled with a reason, edit is absent, and direct edit IPC returns `checkpoint_unsupported` |
| AC9 | Real system-workspace marker copied from the current state and unchanged after edits; native branch publication tests reopen both retained histories without model execution |
| AC10 | Publication fixture retains source content while removing live task events and approval authority from the child; its runtime connection rejects any accidental execution |
| AC11 | Captured-prewarm desktop integration plus two real Electron `/clear` operations and later model requests; three distinct bound native contexts and distinct product anchors remain valid |
| AC12 | Updated runtime/fork/driver references, paired Spec review and documentation gates |

The provider acceptance uses the existing development LongCat-2.5 configuration through all three production harness paths. Credentials remain outside the verification artifacts. Local logs, screenshots, persisted results and native-prefix assertions are recorded under `.context/cherry-electron-dev/history-operations/`; this untracked evidence is not a packaged or cross-platform acceptance claim.

One existing UI gap remains separate: a successful, empty Claude `/clear` receipt is persisted as success but the Agent message adapter renders its generic “No response” error card. This verification does not claim that card is fixed. The Spec stays proposed until its publication/review lifecycle is completed; Durable desktop fork and file rewind remain outside the delivery.

### 10. Mode-control correction verification (2026-11-09)

The corrected AC1–AC2 contract was verified on the current checkout after the main-base refresh. Nine explicitly selected renderer test files passed 475 tests, including both composer surfaces, the Agent consumer, Plan/Goal launchers, Quick Panel behavior and a real editor preserving selected text/file chips during command prefix insertion. The shared capability file passed six tests; the Pi and Durable connection consumers passed 59 tests, including their existing native Goal command cases. Web typecheck, changed-file Oxfmt/Oxlint/ESLint, i18n and documentation checks passed.

In the tracked Electron instance, Claude Shift+Tab changed saved mode `default → plan → default` without changing the draft. The root Plan entry toggled the same native setting, and the composer permission submenu omitted Plan. Claude's live SDK catalog exposed Goal; its root entry prefixed an existing draft once without submitting or changing permissions. Pi and Durable exposed Goal independently, preserved the objective and returned their native status after an explicit `/goal` submission. These status checks do not claim a complete autonomous Goal run.

A separate real LongCat-2.5 request in Claude Plan mode returned the exact requested `MODE_BOUNDARY_PLAN_OK` reply and persisted the expected user input with a successful answer. The shortcut then returned the saved mode to `default`. Correction screenshots, logs and results are under `.context/cherry-electron-dev/mode-correction/`; the earlier history acceptance remains separately scoped above.

### 11. History-action ownership correction verification (2026-11-09)

Ordinary message pagination no longer accepts a runtime callback or computes action policy. The fork-domain module shares static eligibility across list projection, edit preparation and execution. Six explicitly selected Main files passed 329 tests; two renderer action/edit consumers passed 22 tests. Coverage includes a predecessor outside the page, first-input editing, missing parents, delivery inputs, session/ID scoping, unsupported Durable execution, consistent legacy/malformed/foreign checkpoint rejection, effective legacy runtime names, and existing branch publication/version/close/recovery guards. Node typecheck, changed-file formatting/Oxlint/ESLint and documentation gates passed.

A restarted, isolated Electron instance read existing real-model histories through the production DataApi, matched one-row page actions with their off-page parents, prepared Pi/Claude edit drafts, and published native Pi/Claude forks. Durable forced fork/edit requests returned their declared unsupported reasons; its real message UI kept history readable, omitted editing and disabled Fork. This correction made no new model request. Evidence is under `.context/cherry-electron-dev/history-policy/`.

One separate limitation was observed: forking the later boundary of the old Claude history spanning multiple `/clear` contexts returned `history_changed` from the unchanged native prefix validator. Forking the earlier single-context boundary succeeded. That observation exposed the single-context fork assumption addressed by the per-context publication contract above; verification of the follow-up is recorded separately.

### 12. Independent context fork verification (2026-11-09)

AC13 is implemented through the existing fork coordinator and resource ledger. Main groups retained checkpoints by their persisted context binding; each adapter forks only its own native history. All native artifacts are prepared before publication, and the product session, copied messages and context bindings commit in one SQLite transaction. Revalidation includes the captured native bindings and branch-specific checkpoint mapping. In-place editing forks only the predecessor context and preserves earlier contexts.

Seven explicit Main test files passed 329 tests, with another 20 tests passing for `AgentChatContextProvider`; two renderer history-action/edit consumers passed 22 tests. The six new real-Pi-SDK/production-migration cases cover independent native prefixes, source/native-file deletion followed by earlier and later forks and edits, reforking an edited shared prefix, second-context preparation failure, concurrent binding change, and binding insertion failure after native publication. Failure cases leave no partial target session or operation-owned artifacts. Fresh Node typechecking without incremental cache, changed-file formatting/lint and documentation checks passed.

The restarted isolated Electron instance successfully forked the previously rejected real Claude history spanning two `/clear` operations into three independent native contexts. It then forked that copy again, permanently deleted the intermediate source through production IPC, and verified removal of all three source JSONL files. Earlier and later boundaries in the surviving copy still forked successfully. A real LongCat-2.5 continuation used only the selected context. Editing and resending that input created a new native context, excluded the replaced input, and left the earlier two native files byte-for-byte unchanged. A further fork of the edited multi-context history succeeded. The selected native transcripts excluded both earlier-context markers; product history remained visible. No renderer page errors were observed.

Evidence is stored under `.context/cherry-electron-dev/context-fork/` (`result.json`, `live-result.json`, `edited-live.png`, logs and scripts). These checks do not establish packaged, cross-platform or power-kill behavior. The empty `/clear` receipt display gap recorded above remains separate.

## Alternatives considered

- Rename the hint hook or move the hint elsewhere. This repairs import resolution or placement while retaining keyword inference and the draft-to-Agent scope mismatch.
- Add a model-based planning-intent classifier. This adds latency, cost and a second decision owner without establishing permission intent.
- Truncate the existing native transcript to simulate rewind. This mutates retained history and risks compaction, queued work and old branch bindings.
- Rebuild context from product messages or add a unified history/snapshot service. Product display history is not authoritative native execution state.
- Enable Durable desktop fork immediately because child fork exists. Child ownership and same-store inheritance do not establish an independently recoverable product conversation.
- Restore files automatically during edit/resend or fork. Conversation selection does not authorize overwriting current workspace files.

## Acceptance criteria

- AC1 — Planning keywords, negations and quoted text never render mode suggestions or change settings. Plan and native Goal have independent Quick Panel entries; Plan is absent from the composer permission submenu, Goal selection inserts the native command without submitting, and existing saved modes are not reset on mount. (verification: renderer and Electron — implementation author)
- AC2 — Plain Shift+Tab toggles only ordinary/Plan on supported harnesses in both deferred and initialized composer surfaces, preserves the draft and ignores repeats/composition/modified shortcuts. Goal stays independent; open-panel and prompt-variable navigation retain priority. (verification: renderer and Electron — implementation author)
- AC3 — A successful Claude/Pi reply saves its evidenced native boundary with the product reply; absent/invalid checkpoint evidence preserves the answer and disables fork rather than inventing a boundary. (verification: unit with migrated SQLite — implementation author)
- AC4 — Claude and Pi forks include exactly the selected native prefix, preserve supported compaction/replacement state, remap inherited checkpoints and leave source history unchanged. (verification: native SDK contract — implementation author)
- AC5 — Editing a noninitial input keeps the old branch and selects a sibling with new product input and native identities; editing the first input succeeds without a fake checkpoint. (verification: unit with migrated SQLite and Electron — implementation author)
- AC6 — Busy, closing, changed-history and missing/unsupported-checkpoint cases do not publish a partial branch or dispatch reconstructed/duplicate input. (verification: Main fork/edit consumers — implementation author)
- AC7 — Cancellation, artifact write/publication failure and product-transaction failure clean only proven operation-owned resources; reopening preserves committed branches and recovers incomplete intents. (verification: publication and recovery tests with real temporary files and migrated SQLite — implementation author)
- AC8 — Durable desktop fork/edit are unavailable with an actionable reason while supported Claude/Pi boundaries are offered; listing messages starts no native work, and a later missing-history error remains explicit. (verification: renderer and Main read-model consumers — implementation author)
- AC9 — Selecting a retained branch makes no model request or file rollback; fork copies current system-workspace files or reuses the ordinary workspace, and edit/resend keeps current files. (verification: filesystem integration and Electron — implementation author)
- AC10 — Forked product history contains no live approval or task ownership; opening the fork does not replay inherited execution. (verification: Main fork/SDK consumers — implementation author)
- AC11 — Actual Main prewarm/connect followed by repeated Claude /clear and later input retains consistent branch/native identities without unique-anchor failures or stale-observer checkpoint writes. (verification: desktop runtime integration and Electron — implementation author)
- AC12 — Paired references state the shipped support matrix, file-state limits and outstanding Durable/file-rewind gates; acceptance is recorded only for checks actually run. (verification: docs gate and final evidence review — implementation author and maintainer)
- AC13 — Forking a product prefix across native resets creates independent contexts for every retained segment; only the selected context resumes. After deleting the source and its native files, both earlier and later copied boundaries still fork and edit correctly. Failed preparation, changed bindings or publication leave no partial product conversation or owned native artifacts. (verification: migrated SQLite/native SDK tests and Electron — implementation author)

## Risks

Checkpoint and source mappings already exist in real user data. This delivery adds no schema or shipped-migration rewrite, preserves historical evidence and reports unsupported history instead of silently replacing it.

Availability at list time cannot guarantee native files still exist at execution time. The action must retain typed failures and Main revalidation. Avoid expensive per-message native reads or a parallel capability cache.

Native compaction/content-replacement behavior varies with the pinned SDK. A rejected unsupported fork is preferable to a resumable-looking context with different history. Any dependency patch requires its own maintainer decision and updated contract evidence.

The reset handoff touches asynchronous observations and persistence. Validate old-source fencing and failure before/after publication, rather than relying on a single successful clear.

Documentation and unit tests do not establish native process-kill recovery, packaged behavior, live-model acceptance or file restoration. Record these evidence classes separately; no proposed follow-up is marked shipped.
