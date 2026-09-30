---
description: Current AI SDK v7 research and migration assessment, with the original unified-runtime proposal preserved for context
sources:
  - src/main/ai
  - package.json
---

# Unified Runtime — Design & AI SDK Research

> Updated 2026-10-01. The SDK research is verified against **ai@7.0.123** and Cherry **ai@6.0.185**.
> Architecture proposals are not implementation status or approval to replace existing runtimes.

## Start here

| Document | Purpose |
|---|---|
| [AI SDK v7 assessment](./aisdk-v7-research.md) | Current recommendation, compatibility boundaries, patch audit, and verification order |
| [Feature delta inventory](./aisdk-v7-feature-inventory.md) | Changes since 7.0.0, first relevant versions, experimental status, and official sources |
| [Migration plan](./migration-plan.md) | Separates SDK upgrade from runtime unification; preserves the original phased proposal as historical rationale |
| [Architecture proposal](./architecture.md) | The original context (`C`) / safety gate (`G`) model, with current scope and compatibility corrections |
| [Tool approval](./tool-approval-refactor.md) | Updated approval constraints, including Code Mode, followed by the original centralization proposal |
| [Large-file upload](./large-file-upload-port.md) | Current attachment boundary and the expanded FilesV4 lifecycle assessment |

## Decision boundary

Evaluate SDK upgrade, native tool search, streaming recovery, Code Mode, and individual Harness adapters
separately. The research does not authorize message-store migration, driver removal, or a new permission
system. Cherry's current architecture is documented in the [AI reference](../README.md) and
[agent-session runtime reference](../agent-session-runtime.md).

The June proposal treats runtime as an environment with context and safety controls. That is a design
hypothesis retained for discussion, not evidence that every current runtime should be collapsed.
