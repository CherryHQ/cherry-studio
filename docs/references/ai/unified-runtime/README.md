---
description: Current AI SDK v7 research and migration assessment, with the original unified-runtime proposal preserved for context
sources:
  - src/main/ai
  - package.json
---

# Unified Runtime — Design & AI SDK Research

> Plan coverage updated 2026-10-04. The retained SDK research compares **ai@7.0.123** and Cherry **ai@6.0.185**.
> Architecture proposals are not implementation status or approval to replace existing runtimes.

## Start here

| Document | Purpose |
|---|---|
| [AI SDK v7 assessment](./aisdk-v7-research.md) | Current recommendation, compatibility boundaries, patch audit, and verification order |
| [Feature delta inventory](./aisdk-v7-feature-inventory.md) | Changes since 7.0.0, first relevant versions, experimental status, and official sources |
| [Migration plan](./migration-plan.md) | Research coverage matrix, SDK baseline, dependent capability workstreams, adoption decisions and cleanup gates |
| [Phase 1: SDK upgrade](./sdk-upgrade-plan.md) | Dependency and patch closure, all 32 official codemods, manual semantic work, and baseline acceptance |
| [FilesV4 migration](./large-file-upload-port.md) | Attachment routing, upload/reference lifecycle, account scope, expiry, cleanup, replay and F-01–06 |
| [Images, recovery and media](./capability-migration-plan.md) | Image generation/editing and custom jobs, UI/provider stream recovery, Batch, audio/video/Realtime, structured output and evaluation |
| [Phases 2–3: Tool Search and Code Mode](./tool-discovery-plan.md) | Concrete replacement/deletion maps, Pi versus chat boundaries, approval integration, and black-box cases |
| [Architecture proposal](./architecture.md) | The original context (`C`) / safety gate (`G`) model, with current scope and compatibility corrections |
| [Tool approval](./tool-approval-refactor.md) | Updated approval constraints, including Code Mode, followed by the original centralization proposal |

## Decision boundary

Start with the [AI SDK upgrade](./sdk-upgrade-plan.md); subsequent features require its regression gate.
Existing attachments, images/editing, embedding/rerank, structured output and UI delivery are mandatory
baseline coverage. Files, images, recovery and tools then have independent adoption workstreams; they
do not wait for Harness. New Batch/audio/video/Realtime/evaluation capabilities have explicit
decision-pending records, not an implicit exclusion from the plan.
Target Harness for all Agent execution backends, with each replacement gated by the
[migration plan and black-box acceptance](./migration-plan.md#black-box-acceptance). Full compatibility
has not yet been proven. Cleanup is gated per replaced capability and caller. Wholesale message-store
unification and a new permission system are outside this plan; selected file/media features may still
need explicit, forward-only durable-state changes. Cherry's current architecture is documented in the [AI reference](../README.md) and
[agent-session runtime reference](../agent-session-runtime.md).

The June proposal treats runtime as an environment with context and safety controls. That is a design
hypothesis retained for discussion, not evidence that every current runtime should be collapsed.
