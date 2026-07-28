# AI Refactor — Reviewer Guide

The AI domain is the largest single surface in the v2 refactor. The
renderer's `src/renderer/src/aiCore/` tree (~80 files) is **deleted in
full**; its logic ports into `src/main/ai/` (~150 files). The transport
becomes IPC + a Main-owned active-stream registry. This directory
breaks the change into clusters reviewable in parallel — one cluster
per agent.

## How to read this

Each cluster doc:

- States the **scope** (file list + ownership boundary).
- States the **intent** — what the cluster is solving, what it
  intentionally is not.
- Lists the **key changes** with file:line references and the design
  rationale that would otherwise live in PR descriptions.
- Lists **invariants** the reviewer should check are preserved.
- Lists **validation** — which tests cover the change and current
  status.
- Lists **known follow-ups** that are out of scope here but tracked.

## Cluster index

| Cluster | What it covers | Doc |
|---|---|---|
| Stream Manager | `AiStreamManager`, listeners, persistence backends, lifecycle, dispatcher, context providers | [stream-manager-cluster.md](./stream-manager-cluster.md) |
| Agent Loop | `Agent` class, hooks composition, single-pass stream, observers, tool-execution events | [agent-cluster.md](./agent-cluster.md) |
| Params Pipeline | `buildAgentParams`, `RequestFeature` set, capability resolution, system-prompt assembly | [params-cluster.md](./params-cluster.md) |
| Tool Registry | Registry, built-in tools, MCP sync, meta-tools, defer exposition, tool-call repair | [tool-cluster.md](./tool-cluster.md) |
| Provider Resolution | `provider/config.ts`, `endpoint.ts`, extensions, custom providers (aihubmix, newapi), Claude Code runtime helpers | [provider-cluster.md](./provider-cluster.md) |
| Messages & Observability | UI part conversion, file processor, OTel span adapter | [messages-observability-cluster.md](./messages-observability-cluster.md) |
| AiService & IPC | `AiService` lifecycle wiring, IPC handlers, request-type schemas | [ai-service-cluster.md](./ai-service-cluster.md) |
| Renderer Transport | `IpcChatTransport`, dispatch coordinator, topic-level subscription, awaiting-approval bridge | [renderer-transport-cluster.md](./renderer-transport-cluster.md) |
| Renderer V2 Chat UI | Parts-based rendering, approval cards, branch navigation, execution overlay | [renderer-ui-cluster.md](./renderer-ui-cluster.md) |
| Composer Tool Surface | `+` menu, `/` panel, active chips, assistant/agent tool discoverability and disabled-state rules | [composer-tool-surface-design.md](./composer-tool-surface-design.md) |
| Package Changes | `packages/aiCore`, `packages/provider-registry`, shared types | [packages-cluster.md](./packages-cluster.md) |
| Data Layer | Agent / session / workspace schema rewrite, MessageService, migrators, DataApi handlers, shared types/schemas | [data-cluster.md](./data-cluster.md) |
| Agents Core Carve | Renderer agent-session stack onto `main` (`types/agent.ts` enriched shape + `hooks/agents` + `pages/agents` + v2 `utils/export`); the **history** page rides this — measured *not* an independent page split | [agents-core-carve.md](./agents-core-carve.md) |

## Already-documented sub-features

Three smaller, self-contained sub-features have their own design docs
that pre-date this index — these stay where they are and the cluster
docs above reference them:

- [`adapter-family.md`](./adapter-family.md) — endpoint → `@ai-sdk/*`
  routing. (Covered also at [Provider Resolution](./provider-cluster.md).)
- [`translate-on-main.md`](./translate-on-main.md) — translate flow,
  why it's not chat-shape.
- [`branch-navigation.md`](./branch-navigation.md) — UX for branched
  DAG history; UX-side, not on the AiService critical path.
- [`token-estimator-p0.md`](./token-estimator-p0.md) — backend token
  estimation behind the input-bar badge.
- [`large-file-upload-port.md`](./large-file-upload-port.md) — outstanding
  port from renderer for Gemini/OpenAI File APIs.
- [`tool-approval-defer-fix.md`](./tool-approval-defer-fix.md) — fix design
  for the defer-exposition approval-gate bypass (review #1).
- [`tool-approval-state-consolidation.md`](./tool-approval-state-consolidation.md) —
  diagnosis + target design + **phased refactor plan** for the approval split-brain
  (stream / DB / renderer state can't be simultaneously consistent); single-authority
  (DB parts) model, collapsing the main-side multi-write into one authoritative write
  (Phase 1 = CR-002, done).
- [`steer-state-machine-consolidation.md`](./steer-state-machine-consolidation.md) —
  steer-queue state machine (#15935 fresh-eyes review): delete the `lastTerminalKind`
  shadow, drive chaining / enqueue / approve-gate off the single authority
  (`stream.status` on the in-grace stream). **Blockers 1–3 implemented** on
  `codex/main-3` (+ S5 removed for free); blocker 4 (renderer `executionId` reuse)
  handed off to the renderer slice.
- [`channel-ingress-security.md`](./channel-ingress-security.md) — security
  model + gaps for externally-triggered (inbound IM) agent runs (review D1).
- [`stream-ipc-validation.md`](./stream-ipc-validation.md) — scheme to validate
  the untrusted-renderer AI stream IPC payloads (review D2).
- [`declarative-tool-registry.md`](./declarative-tool-registry.md) — one
  declarative registry for Claude Code agent tools (policy + catalog UI +
  chat rendering): `exposure`/`category`/`pairGroup`, opt-out `disabledTools`,
  SDK 0.3.168 upgrade, 7-PR sequence.

## Suggested review order

The clusters are not strictly independent — but the listed order
roughly matches dependency depth (later clusters consume earlier
ones). For solo review, take them in order. For agent-parallel review,
assign the first six clusters in any order; renderer clusters last
since they consume the Main contract.

## Out of scope here

- v1 deletion artefacts (file removals only, no logic) — those are part
  of the renderer cleanup chain and reviewed at git level.
- Quick assistant / API server lifecycle — separate PRs with their own
  docs.
