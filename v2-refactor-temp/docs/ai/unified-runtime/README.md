# Unified Runtime — active forward-looking plan

> **Status: active design, not yet implemented.** Distinct from the parent `docs/ai/` reviewer-guide
> docs, which document the *already-done* v2 refactor. This folder is the *forward* plan for collapsing
> Cherry's two AI runtimes (chat `aiSdk` driver + agent `claudeCode` driver) into one model-agnostic
> runtime.

## The thesis in one line

A runtime is an **environment**, not a controller: two levers — `C` (context engineering, the only
input-side lever) and `G` (safety gate on side-effecting actions, the only output-side lever) — and the
loop is *emergent*, not driven. Chat and Agent are the same runtime with different `C`. The
model-agnostic loop already exists (`src/main/ai/runtime/aiSdk/`); the work is collapsing the fork, not
building a runtime.

## Documents

| Doc | What it is |
|---|---|
| [migration-plan.md](./migration-plan.md) | **Start here.** Decision log (D1–D7), the full v6→v7 upgrade checklist, a self-contained scheme per phase (problem → approach → files → steps → verify → risk), and open decisions with recommendations. |
| [architecture.md](./architecture.md) | The `(C, G)` design: the three collapses, the `prepareStep` red line, and the full context & call-options model (`CALL_OPTIONS` / `runtimeContext` / `toolsContext`) including the `builtin/` worked example. |
| [tool-approval-refactor.md](./tool-approval-refactor.md) | Grounds Phase 1: centralize the approval *decision* (`G`) into one `PermissionEngine` (no OPA), retire scattered per-tool `needsApproval`; v6/v7 wiring; the native message-based flow = D6/D7. |
| [aisdk-v7-research.md](./aisdk-v7-research.md) | Upgrade-cost analysis: why stay on `ai@6` for now; what the v7 bump actually costs (provider V4 spec, 6 patches, the silent `usage` flip). |
| [aisdk-v7-feature-inventory.md](./aisdk-v7-feature-inventory.md) | Source-grounded inventory of what's new in AI SDK v7.0.0 (read from the `tallinn` checkout), flagged for Cherry relevance. |

## Relationship to the rest of `docs/ai/`

The parent dir's docs are the **historical reviewer guide** for the v2 AI refactor. This plan *consumes*
a few of them as live context — `../tool-approval-state-consolidation.md`,
`../steer-state-machine-consolidation.md`, `../agent-session-workspace.md` — but does not supersede them.
