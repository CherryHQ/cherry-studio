---
description: AI SDK 7.0.127 assessment and pinned main deltas against Cherry Studio 6.0.185, with capability coverage and migration gates
sources:
  - src/main/ai
  - packages/aiCore/src/core/context/compaction.ts
  - package.json
  - pnpm-workspace.yaml
---

# AI SDK v7 — Upgrade Assessment

> Refreshed 2026-10-04 against published **`ai@7.0.127`** and upstream main **`15f1a4d0531ac641a4a4d9cc602c0536c1906834`**.
> Cherry baseline: **`e3052500309`** (includes main `b6e69eb2012e`), still `ai@6.0.185`.
> This is research, not an SDK upgrade or a runtime migration approval.
> The [June report](https://github.com/CherryHQ/cherry-studio/blob/e51a3ad0643e6d15e76b7720b8739e4fb4f77c6b/docs/references/ai/unified-runtime/aisdk-v7-research.md) remains available in Git history.
> The earlier 2026-10-01 assessment used `ai@7.0.123` and main `09aa6c2af27ec15482c5476f601984a9c7361890`.
> The [research coverage matrix](./migration-plan.md#research-coverage) now includes the refreshed release
> deltas, main-only fixes, provider skill uploads, and Cherry's current native Pi/VCC baseline.

## Recommendation

Evaluate an SDK upgrade independently of runtime unification. The strongest new reasons to evaluate v7
are native deferred-tool discovery, streaming recovery, and upstream fixes overlapping Cherry's patches.
The [phase-1 implementation plan](./sdk-upgrade-plan.md) specifies codemod coverage and manual repairs.
Code Mode is a later gated phase. The [migration plan](./migration-plan.md#harness-migration-direction)
now targets Harness for all Agent execution backends, gated by per-runtime black-box acceptance;
completing that migration is not a prerequisite for upgrading `ai`. The previous blanket recommendations
to stay on v6 and reject Harness are superseded by this capability-based assessment.

The earlier SDK → Tool Search → Code Mode → Harness summary was not a complete migration plan.
[FilesV4](./large-file-upload-port.md) and [images, stream recovery and media](./capability-migration-plan.md)
are explicit workstreams. Existing capabilities must survive phase 1; new capabilities need their own
adoption and lifecycle decisions. Runtime replacement does not cover them automatically.

## Reproducible baseline

| Surface | Observed value | Evidence |
|---|---|---|
| Published SDK comparison | `ai@7.0.127` | [Release](https://github.com/vercel/ai/releases/tag/ai%407.0.127) |
| Historical v6 maintenance observation | `ai@6.0.297`, npm `ai-v6` tag on 2026-10-01; not rechecked in this refresh | [Release](https://github.com/vercel/ai/releases/tag/ai%406.0.297) |
| Cherry SDK pin | `ai@6.0.185` | `package.json`, `pnpm-lock.yaml` |
| Upstream source inspected | `15f1a4d0531ac641a4a4d9cc602c0536c1906834` | [Main snapshot](https://github.com/vercel/ai/commit/15f1a4d0531ac641a4a4d9cc602c0536c1906834) |
| Published comparison point | `ai@7.0.127` tag | [Core changelog](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md) |

Main contains post-release changes even where `package.json` still says `7.0.127`. The inventory's
[release/main ledger](./aisdk-v7-feature-inventory.md#release-and-main-delta-ledger) separates released
Tool Search, audio telemetry and provider changes from pending approval/Harness fixes. Use fixed tags
and commit links to reproduce this assessment; npm tags and live docs can move.

### Changes that affect the implementation plan

- Tool Search now accepts a custom ranking callback and result limit. Evaluate the public callback
  before proposing another search layer; namespace browsing and next-step execution remain separate constraints.
- Provider `uploadSkill` / `SkillsV4` was already present in the old baseline but missing from this
  research. Track it separately from attachment uploads and local/Harness skills in [S](./large-file-upload-port.md#s--provider-skill-uploads).
- OpenAI-compatible multipart tool results need an endpoint-specific adoption decision; speech and
  transcription need operation-specific telemetry/usage gates if adopted. See [capability work](./capability-migration-plan.md).
- Cherry now uses Pi 1.0 native Code Mode, Tool Search, MCP and pi-vcc. The old Pi worker replacement
  map is superseded; [H2](./migration-plan.md#phase-4-implementation-slices) must resolve the native
  dependency gap and prove these contracts through the selected Harness Pi adapter before cutover.

## What changed after 7.0.0

See the [feature inventory](./aisdk-v7-feature-inventory.md) for versions, constraints, and sources.

- **Tool discovery:** `toolSearch()` and `deferLoading` can overlap Cherry's deferred-tool infrastructure.
- **Code Mode:** QuickJS-hosted tool composition adds parallel calls and result filtering, but nested
  approval requires explicit host integration. The published Code Mode package exposes callback/interrupt
  APIs despite the narrower live guide; see the [correction and plan](./tool-discovery-plan.md#31-resolve-the-approval-contract-from-the-published-package). It remains experimental and Node-only.
- **Streaming recovery:** `StreamProviderError` plus `streamRetries` cover provider error events after
  streaming starts. This is distinct from cross-model fallback and transport reconnection.
- **Files and media:** FilesV4 adds lifecycle operations; batches, realtime voice, streaming transcription,
  speech translation, and asynchronous video APIs expand the SDK beyond request/response text.
- **Harness:** more adapters, caller-owned sandboxes, per-turn settings, steering, and a history-access
  contract make the old blanket rejection too broad. Experimental status and adapter gaps remain.
- **UI streams:** upstream fixes address long-text snapshot copying, resumable partial parts, cancellation,
  approval continuation, and optional SSE heartbeats.

## Migration boundaries that still need verification

| Boundary | v7 contract / migration concern | Cherry verification |
|---|---|---|
| Context | Shared orchestration moves to `runtimeContext`; tool callbacks read `context` supplied through `toolsContext` / `contextSchema` | Audit `Agent.ts`, tool execution adapters, and request-context ownership; v6 does not expose all three under the v7 names |
| Approval | Central `toolApproval` replaces per-tool `needsApproval`; reasons, transformed inputs, and signed approvals affect continuation | Preserve approval state and validate resumed tool inputs; SDK contracts do not replace Cherry authorization |
| Lifecycle | `onStepFinish` → `onStepEnd`, `onFinish` → `onEnd`; native tool/model-call callbacks | Reconcile `AgentLoopHooks`, `composeHooks`, observers, aborts, and per-attempt telemetry before removing shims |
| Results / usage | `usage` is aggregate; final-step data lives in `finalStep`; `fullStream` → `stream` | Audit usage/cost accounting and persistence, not just compilation |
| Prompt / UI | `system` → `instructions`; system messages require explicit allowance; UI stream helpers change | Verify prompt assembly, attachments, stream projections, and restored history |
| Telemetry | `telemetry` and separate `@ai-sdk/otel` integrations | Preserve Cherry's opt-in policy and parent spans across tools, retries, and approvals |
| Provider contracts | V4 adds new parts and options; older model interfaces have compatibility adapters | Test native and OpenAI-compatible providers separately; do not infer new-feature parity from accepted types |
| Packaging | ESM-only SDK; current upstream builds target ES2022 and use tsdown | Verify Electron main/preload/renderer builds and packaged runtime; Node compatibility alone is insufficient |

Sources: [migration guide](https://github.com/vercel/ai/blob/ai%407.0.123/content/docs/08-migration-guides/23-migration-guide-7-0.mdx),
[agent settings](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/agent/tool-loop-agent-settings.ts),
[core changelog](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/CHANGELOG.md).
June call-site counts and codemod counts are intentionally not reused: they were measured on a different
Cherry tree. Select and dry-run codemods against the version used by an actual upgrade PR.

### Provider upgrades need not be all-or-nothing

The published SDK accepts V2/V3/V4 language models. Its
[compatibility adapter](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/model/as-language-model-v4.ts) translates older prompts,
results, and streams. This permits evaluating a staged migration; it does not make new V4 file references,
reasoning controls, or provider-specific options work on every old provider. Package peer dependencies,
custom middleware, and patched wire formats still need verification.

### Audit the current patches, not the June count

The directly relevant core / first-party / OpenRouter entries in `pnpm-workspace.yaml` are:

| Patch | Audit focus |
|---|---|
| `ai@6.0.185` | Image-download customization and UI-message snapshots; assess each hunk separately |
| `@ai-sdk/react@3.0.187` | Streaming snapshot behavior and nested-value isolation |
| `@ai-sdk/anthropic` | Provider-specific changes against the selected target version |
| `@ai-sdk/openai@3.0.109` | Provider-specific request/response behavior |
| `@ai-sdk/google@3.0.113` | Provider-specific request/response behavior |
| `@ai-sdk/openai-compatible@2.0.72` | Reasoning replay and media output on compatible endpoints |
| `@ai-sdk/open-responses@1.0.34` | Reasoning replay and reasoning-part identity |
| `@openrouter/ai-sdk-provider@2.10.0` | Community-provider compatibility and patched behavior |

Also include community-provider patches such as Ollama and GitHub Copilot when defining the upgrade's
provider coverage. The table is not a count of every AI-related patch in the repository.

For each patch record **remove / retain / reimplement**, the upstream equivalent, and a regression case.
For example, v7.0.65 optimized `readUIMessageStream` by excluding accumulated text from deep copies while
still isolating mutable nested data. That overlaps Cherry's snapshot patch but is not proof that the
entire `ai` or React patch can be deleted. See the
[published snapshot implementation](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/ui-message-stream/read-ui-message-stream.ts).

## Runtime and compaction conclusions

Cherry's current [agent-session runtime](../agent-session-runtime.md) has Claude Code, Pi, and DSH drivers.
The June description of a Claude-Code-only agent stack is historical. SDK upgrade, new adapter adoption,
message-store unification, and driver removal are separate decisions.

`ToolLoopAgent` still has no published top-level `compact()` / `compactWhen` facility;
[the proposal remains open](https://github.com/vercel/ai/issues/14017). Cherry already has
`packages/aiCore/src/core/context/compaction.ts` and the aiSdk compaction feature (currently
`params/features/inLoopCompaction.ts`, rechecked 2026-10-04). Evaluate and reuse
that implementation; do not plan a second compaction subsystem from scratch. Provider-native compaction,
Harness session compaction, message pruning, and application-owned summarization are different contracts.

## Suggested validation order

1. Map every research item to its current callers, provider/runtime matrix, migration/adoption decision,
   acceptance and removal record. Inventory resolved versions and every patch; reproduce protected behavior.
2. Complete the core API, usage, approval and packaging migration together with existing attachments,
   image generation/editing, custom image jobs, embedding/rerank, structured output, compaction and UI
   regression gates. Keep runtime ownership unchanged during this SDK baseline.
3. Run the independent FilesV4, image-capability/result-lifecycle, stream-recovery and Tool Search workstreams
   through their detailed acceptance plans. Do not treat their completion as a consequence of an SDK upgrade.
4. Evaluate Core Code Mode separately; initially keep approval-required tools direct. Preserve Pi's
   existing native QuickJS and nested approvals until its Harness acceptance passes; audit leftover
   worker code independently rather than assuming Pi still consumes it.
5. Resolve the explicit provider-skill, Batch, audio/transcription/translation, async-video, Realtime and evaluation
   adoption records. Selected features follow their own provider/lifecycle gates; unresolved items remain open.
6. Execute Harness acceptance per runtime with its consumed file/image/tool/delivery contracts, real
   adapters, failure injection, real providers and packaged Electron. Independent new-media decisions
   do not block a runtime that does not consume them.
7. Remove superseded code per capability only after caller coverage, historical data and rollback pass;
   Harness completion is not the cleanup gate for files, images, recovery or other media.

No compatibility prototype, SDK upgrade, real-provider run, or Electron packaging test was performed as
part of this documentation refresh.
