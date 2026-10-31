---
description: AI SDK v7 research conclusions and implementation plans for SDK controls, files, images, tools, media, and Harness
sources:
  - src/main/ai
  - package.json
---

# AI SDK v7 and Runtime Migration

Research compares Cherry's `ai@6.0.185` baseline with published `ai@7.0.127` and pinned upstream main
`15f1a4d0531a` on 2026-10-04. Plans and research belong to
[PR #16462](https://github.com/CherryHQ/cherry-studio/pull/16462); the SDK/V4 implementation and its
validation record belong to [PR #21310](https://github.com/CherryHQ/cherry-studio/pull/21310).

| Document | Responsibility |
|---|---|
| [Research conclusions](./aisdk-v7-research.md) | What v7 adds, what already existed, Cherry adoption gaps, and released versus main-only findings |
| [Migration plan](./migration-plan.md) | Post-upgrade Agent/reasoning, image/media and recovery work, Harness cutover and cleanup |
| [SDK upgrade](./sdk-upgrade-plan.md) | Dependency/patch closure, codemods, semantic migration and existing-capability regression gates |
| [Files and skills](./large-file-upload-port.md) | Attachment upload/reference lifecycle and separate provider skill adoption |
| [Tool Search and Code Mode](./tool-discovery-plan.md) | Discovery/execution replacement, nested approvals and current native Pi boundaries |

Read research for conclusions and the migration plan for sequencing; use the focused plans when
implementing a workstream. Existing behavior must survive the SDK upgrade. New file, image, recovery
and tool capabilities have independent gates; replacing a runtime does not implement them automatically.
Current product architecture and approval ownership remain documented in the
[AI reference](../README.md), [agent-session runtime](../agent-session-runtime.md) and
[tool approval reference](../tool-approval.md).
