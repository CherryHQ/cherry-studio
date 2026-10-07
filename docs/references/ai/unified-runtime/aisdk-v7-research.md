---
description: AI SDK v7 research conclusions, composable agents, unified reasoning, media capabilities, and Cherry adoption boundaries
sources:
  - src/main/ai
  - packages/aiCore/src/core/agents/createAgent.ts
  - packages/aiCore/src/core/context/compaction.ts
  - src/shared/ai/reasoning.ts
  - package.json
  - pnpm-workspace.yaml
---

# AI SDK v7 — Research Conclusions

## Reproducible baseline

This assessment compares Cherry `e3052500309` (`ai@6.0.185`, including the main merge) with published
`ai@7.0.127`. Additional source findings are pinned to upstream main
[`15f1a4d0531ac641a4a4d9cc602c0536c1906834`](https://github.com/vercel/ai/commit/15f1a4d0531ac641a4a4d9cc602c0536c1906834).
Research date: 2026-10-04. These are fixed comparison points, not a claim about the latest release.

SDK compatibility, capability adoption and runtime replacement are separate milestones. Upgrade the
SDK first while preserving existing behavior; then adopt the useful controls at their actual Cherry
callers. Files, image generation/editing and recovery are independent of Tool Search, Code Mode and
Harness. [PR #21310](https://github.com/CherryHQ/cherry-studio/pull/21310) implements the SDK/V4 baseline;
its implementation record and remaining validation belong to that PR.

The conclusions below incorporate public API, retained-contract, package and provider source checks.
They establish migration scope, not real-provider or packaged-runtime acceptance. Detailed work and
validation belong in the [migration plan](./migration-plan.md) and its linked implementation plans.

## Composable agents and finer execution control

`Agent`, `ToolLoopAgent`, parameterized `prepareCall` with validated call options, dynamic `prepareStep`,
subagents expressed as tools, middleware chains, preliminary results and `toModelOutput` already exist
in `6.0.185`. They are useful composition patterns, but are not all new v7 features. See the fixed
[v6 agent](https://github.com/vercel/ai/blob/ai%406.0.185/packages/ai/src/agent/tool-loop-agent.ts) and
[subagent pattern](https://github.com/vercel/ai/blob/ai%406.0.185/content/docs/03-agents/06-subagents.mdx).

v7 improves how those pieces can be combined:

- **Context and policy:** typed `runtimeContext`, per-tool `toolsContext` / `contextSchema`, and dynamic
  descriptions separate orchestration from tool dependencies. Per-step generation settings (`7.0.42`)
  and `prepareCall` reasoning overrides (`7.0.54`) allow different budgets and reasoning for different
  stages of one agent. Step generation settings and carried-forward messages/context have different lifetimes.
- **Execution control:** first-output timeouts (`7.0.35`), whole-tool and per-tool budgets supplement the
  existing total/step/chunk limits. Stable lifecycle hooks, model-call events and performance data expose
  run, step, model and tool boundaries. Cancellation cannot undo an already-committed host effect.
- **Tool and prompt composition:** `toolOrder` controls provider-visible definition order, not scheduling;
  `experimental_refineToolInput` transforms already-validated input without revalidating its return value;
  `defaultInstructionsMiddleware` supplies missing instructions without overriding explicit ones. Typed
  active-tool subsets and variadic `hasToolCall` simplify composition without adding a scheduler.
- **Streams and results:** standalone UI/text stream helpers and separate aggregate/final-step results
  make custom producers and child-agent progress easier to combine. `experimental_streamLanguageModelCall`
  is public, but `executeToolsFromStream` is internal; a custom loop still owns execution semantics.

Cherry's initial V4 implementation still fixes `CALL_OPTIONS = never`, exposes only total/step/chunk
through `AgentOptions.timeout`, and supplies the same request context to multiple scoped tools. Those
are compatibility choices; parameterized presets, narrower dependencies and richer controls remain
caller-driven adoption work. Subagents do not automatically gain durable sessions or inherited permissions.

Sources: [v7 agent settings](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/agent/tool-loop-agent-settings.ts),
[step preparation](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/generate-text/prepare-step.ts),
[tool contract](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider-utils/src/types/tool.ts),
[request controls](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/src/prompt/request-options.ts),
and [core release history](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md).

## Unified reasoning control

v7 adds top-level `reasoning` to model calls and agents:
`provider-default | none | minimal | low | medium | high | xhigh`. Omission leaves the choice to the
provider. Cherry's chat `AgentOptions` / `Agent.ts` now forwards it. Registry-driven per-call projection
uses the portable option where equivalent and retains native serialization for budgets and custom wires;
see the [delivery contract](../../../../packages/provider-registry/docs/reasoning-control.md#ai-sdk-v7-delivery).

The common option expresses intent, while adapters determine the actual request. OpenAI maps it to
native effort fields; Anthropic selects adaptive thinking/effort or budgets; Google uses thinking levels
or budgets according to the model. Open Responses maps `minimal` to `low`. `none` may mean the lowest
supported thinking level on models that cannot disable it. V2/V3 wrapping does not add native reasoning
translation to legacy providers.

Explicit native settings require care: OpenAI's `reasoningEffort` wins, Google overlays explicit
`thinkingConfig` fields, and Anthropic can retain native thinking while deriving missing effort. Sending
two competing policies is not a portable override strategy. Exact budgets still need native options.
The SDK's default budget ratios (2/10/30/60/90 percent) differ from Cherry's descriptor-based mapping,
so replacing it can change cost and output headroom even when the visible label stays the same.

Cherry's `default`, `auto`, `max` and `ultra` do not all map directly to the SDK enum. Adoption must preserve
those distinctions, exact budgets, sampling/output-limit coupling and custom endpoint dialects,
and inspect the final wire request. Reasoning visibility, summaries, signatures/encrypted replay and
accounting remain separate. For example, `openrouterReasoning.ts` removes output `[REDACTED]` markers;
it cannot be retired as an input serializer. The [reasoning adoption gates](./migration-plan.md#unified-reasoning-adoption)
cover these decisions before cutover.

Sources: [V4 call contract](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider/src/language-model/v4/language-model-v4-call-options.ts),
[budget mapping](https://github.com/vercel/ai/blob/ai%407.0.127/packages/provider-utils/src/map-reasoning-to-provider.ts),
[OpenAI](https://github.com/vercel/ai/blob/ai%407.0.127/packages/openai/src/responses/openai-responses-language-model.ts),
[Anthropic](https://github.com/vercel/ai/blob/ai%407.0.127/packages/anthropic/src/anthropic-language-model.ts),
[Google](https://github.com/vercel/ai/blob/ai%407.0.127/packages/google/src/google-language-model.ts),
and [Open Responses](https://github.com/vercel/ai/blob/ai%407.0.127/packages/open-responses/src/responses/open-responses-language-model.ts).

## Tools, approvals and recovery

Native Tool Search (`7.0.104`) supports custom ranking and a result limit in `7.0.127`. It searches the
eligible tool set and exposes matches on the next model step. Cherry's namespace browsing and
inspect/invoke protocol are different; the [tool plan](./tool-discovery-plan.md) owns that replacement.
Core Code Mode is an experimental, separately installed QuickJS package. Published `1.0.84` requires
Node >=22.13.0 and peers on `ai@7.0.127`; it provides approval callbacks and interrupt/continue APIs that
need explicit host integration. Pi already has native Code Mode/search/MCP and nested approval.

Central `toolApproval`, request reasons and signed continuation improve approval integration, but do
not replace Main authorization or durable decision ownership. Resumed inputs still need schema/policy
validation. `fingerprintTools` / `detectToolDrift` (`7.0.19`) can detect changes in string descriptions,
schemas and titles; Cherry would still own the trust baseline and response to a changed catalog.

Opt-in `streamRetries` retries a failed model step after streaming starts. Earlier completed steps are
not replayed, and failed-attempt client tool calls/approvals are withheld until a successful finish.
Already-visible text/reasoning/files cannot be retracted, and provider-side effects cannot be undone.
This is distinct from key/model fallback and UI reconnection. Keep it disabled until partial-output,
effect and attempt-budget policies pass the [recovery gate](./migration-plan.md#r--stream-recovery-and-ui-delivery).

UI changes include selective snapshot copying, preservation of partial parts on resume, merged-reader
cancellation and optional SSE heartbeats. `UIMessageStreamOutcome` and `isCancelled` distinguish terminal
outcomes from consumer cancellation; cancellation can leave an outcome `unknown`, not successful.
Agent helpers now accept `convertDataPart`; React stabilizes `throttle` and `useObject`. These refinements
must preserve Cherry's IPC transport, Main-owned generation and persisted history. Provider `CustomPart`
content also needs explicit durable storage, UI and replay handling; it is not an arbitrary `data-*` part.

Sources: [core changes](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md),
[Code Mode contract](https://github.com/vercel/ai/blob/ai%407.0.127/packages/code-mode/src/types.ts),
[React changes](https://github.com/vercel/ai/blob/ai%407.0.127/packages/react/CHANGELOG.md).

## Files, images and other media

FilesV4 extends uploads with optional metadata, streaming download, deletion, cancellation and expiry
information. Provider references need account/endpoint scope, readiness, renewal and cleanup; an upload
success does not prove a model can consume the file. SkillsV4 standardizes skill upload only, separately
from file lifecycle and Cherry's local/Harness skills. The [file plan](./large-file-upload-port.md) owns
these lifecycle decisions and the existing native/extracted/OCR attachment regression gate.

Image migration includes generation, input images, edits/masks, canonical parameters, custom submit/poll
jobs, download and durable result ownership. Model file/mask declarations can be unknown.
`GenerateImageResult.calls` retains per-call images, metadata and usage; adopting it must preserve
Cherry's existing provider-call billing without double counting. Compatible multipart tool content is
opt-in and endpoint-specific. Imagen remains an explicit V4 patch in #21310 alongside Gemini image
support. The [image plan](./migration-plan.md#i--image-generation-and-editing) owns those paths.

Existing embedding/rerank and structured-output callers remain required upgrade coverage. Byte-bounded
embedding batches and multimodal option slicing need input/result alignment checks; final structured
output must come from the actual final tool-loop step. New Batch, streaming transcription/translation,
video, Realtime and evaluation APIs each need a product caller, provider support and lifecycle decision.
Audio telemetry also has operation-specific hooks and usage units. Availability is not automatic
adoption; the [media plan](./migration-plan.md#images-recovery-and-media) records their acceptance boundaries.

Sources: [core changes](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md),
[FilesV4](https://github.com/vercel/ai/tree/ai%407.0.127/packages/provider/src/files/v4),
[SkillsV4](https://github.com/vercel/ai/tree/ai%407.0.127/packages/provider/src/skills/v4).

## Runtime and provider boundaries

Harness is the target for Agent execution backends, with a separate acceptance gate for each driver.
Cherry retains admission, persistence, approval, UI, credentials and application lifecycle. Current
Claude Code, Pi and DSH contracts exceed basic send/stream/stop: fork/edit, background output, live
policy, steering consumption and history recovery remain adapter gaps. Harness Pi's older native
dependency set must be reconciled with Cherry's Pi 1.0 and VCC. See the
[Harness plan](./migration-plan.md#harness-migration-direction); ordinary chat is not implicitly moved.

WorkflowAgent requires Workflow DevKit and its inspected `generate()` is unimplemented. Workflow-Harness,
per-call sandbox sessions, just-bash/Vercel adapters, OPA policy, MCP Apps and TUI are optional integration
surfaces, not prerequisites for this migration. Cherry uses the official MCP SDK directly; upgrading
`ai` does not import `@ai-sdk/mcp` transport, OAuth, session or completion improvements into that client.

Provider-native orchestration (OpenAI hosted programmatic/async tools, Google Interactions managed
agents and Open Responses extension codecs), Gateway routing, caching, service tiers and compaction
require endpoint-specific decisions. They do not replace Cherry's registry or local compaction.
`ToolLoopAgent` at the pinned release has no generic top-level `compact()` / `compactWhen`; reuse
Cherry's existing compaction. SDK download/response-limit helpers likewise apply only to paths that
consume them, so overridden fetch/download and custom providers need separate checks.

Sources: [Harness adapters](https://github.com/vercel/ai/blob/ai%407.0.127/content/docs/03-ai-sdk-harnesses/05-harness-adapters.mdx),
[WorkflowAgent](https://github.com/vercel/ai/blob/ai%407.0.127/packages/workflow/src/workflow-agent.ts),
[MCP changes](https://github.com/vercel/ai/blob/ai%407.0.127/packages/mcp/CHANGELOG.md),
and [provider packages](https://github.com/vercel/ai/tree/ai%407.0.127/packages).

## Released versus main-only changes

Use published versions for implementation, and reproduce any relevant pending fix before selecting a
later version or scoped patch. The main snapshot's package version alone does not prove a fix shipped.

| Availability at the research snapshot | Migration consequence |
|---|---|
| Released `ai@7.0.124–127` | Audio usage/telemetry, Agent `convertDataPart`, stale-approval cleanup, cross-realm equal inputs, merged-reader cancellation and configurable search are available |
| Released compatible `3.0.62` / Harness ACP `1.0.77` | Multipart content remains opt-in; ACP approval relay must match the approved tool/input |
| [Main-only approval resume](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/calm-tools-resume.md) | Same-message approval state versus new-message state needs a regression case |
| [Main-only Harness terminal telemetry](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/honest-beans-wait.md) | Success/error/abort must settle one correctly attributed terminal event |
| [Main-only Claude cumulative cost](https://github.com/vercel/ai/blob/15f1a4d0531ac641a4a4d9cc602c0536c1906834/.changeset/tidy-claude-cumulative-cost.md) | Do not sum cumulative results or charge a resumed session's prior cost again |

The [SDK upgrade plan](./sdk-upgrade-plan.md) owns dependency/patch decisions, codemods and compatibility
checks. This research does not duplicate that ledger or certify its real-account and packaged-platform gates.
