---
description: AI SDK 7.0.123 assessment against Cherry Studio 6.0.185, with migration boundaries and patch audit priorities
sources:
  - src/main/ai
  - packages/aiCore/src/core/context/compaction.ts
  - package.json
  - pnpm-workspace.yaml
---

# AI SDK v7 — Upgrade Assessment

> Verified 2026-10-01. Published baseline: **`ai@7.0.123`**, released 2026-09-30.
> Cherry baseline: **`e51a3ad0643`**, `ai@6.0.185`. This is research, not an SDK upgrade or a runtime migration approval.
> The [June report](https://github.com/CherryHQ/cherry-studio/blob/e51a3ad0643e6d15e76b7720b8739e4fb4f77c6b/docs/references/ai/unified-runtime/aisdk-v7-research.md) remains available in Git history.

## Recommendation

Evaluate an SDK upgrade independently of runtime unification. The strongest new reasons to evaluate v7
are native deferred-tool discovery, streaming recovery, and upstream fixes overlapping Cherry's patches.
Code Mode and Harness adapters deserve separate compatibility experiments; adopting them is not a
prerequisite for upgrading `ai`. The previous blanket recommendations to stay on v6 and reject Harness
are superseded by this capability-based assessment.

## Reproducible baseline

| Surface | Observed value | Evidence |
|---|---|---|
| Published stable SDK | `ai@7.0.123` | [Release](https://github.com/vercel/ai/releases/tag/ai%407.0.123) |
| v6 maintenance line | `ai@6.0.297`, npm `ai-v6` tag | [Release](https://github.com/vercel/ai/releases/tag/ai%406.0.297); `npm view ai dist-tags --json` |
| Cherry SDK pin | `ai@6.0.185` | `package.json`, `pnpm-lock.yaml` |
| Upstream source inspected | `09aa6c2af27ec15482c5476f601984a9c7361890` | [Main snapshot](https://github.com/vercel/ai/commit/09aa6c2af27ec15482c5476f601984a9c7361890) |
| Published comparison point | `ai@7.0.123` tag | [Core changelog](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/CHANGELOG.md) |

The main snapshot contains changes after the release, including the Topaz provider addition. Those are
not counted as released v7.0.123 capabilities here. npm tags and live docs can move; use the fixed tag
when reproducing this assessment. A v6 maintenance tag is not a promise of indefinite support.

## What changed after 7.0.0

See the [feature inventory](./aisdk-v7-feature-inventory.md) for versions, constraints, and sources.

- **Tool discovery:** `toolSearch()` and `deferLoading` can overlap Cherry's deferred-tool infrastructure.
- **Code Mode:** QuickJS-hosted tool composition adds parallel calls and result filtering, but nested
  calls cannot pause for human approval. It remains experimental and Node-only.
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
| Context | `experimental_context` becomes `runtimeContext`; `toolsContext` / `contextSchema` are a separate per-tool facility | Audit `Agent.ts`, tool execution adapters, and request-context ownership; v6 does not expose all three under the v7 names |
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
`packages/aiCore/src/core/context/compaction.ts` and the aiSdk `contextCompaction` feature. Evaluate and reuse
that implementation; do not plan a second compaction subsystem from scratch. Provider-native compaction,
Harness session compaction, message pruning, and application-owned summarization are different contracts.

## Suggested validation order

1. Inventory resolved SDK/provider versions and every applicable patch; reproduce the behavior each patch protects.
2. Prototype the core API migration, usage semantics, approval round trips, and ESM packaging without changing runtime ownership.
3. Compare native tool search and stream recovery with Cherry's existing implementations using real tool-heavy and interrupted streams.
4. Evaluate Code Mode separately, with approval-required tools excluded from nested execution.
5. Evaluate individual Harness adapters for local execution, permissions, steering, history, and packaged dependencies before proposing adoption.

No compatibility prototype, SDK upgrade, real-provider run, or Electron packaging test was performed as
part of this documentation refresh.
