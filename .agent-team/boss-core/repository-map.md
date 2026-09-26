# Repository and graph evidence

Recorded 2026-09-24 against Boss HEAD 8344b485203427952716cd142da28c181162be61. Source is authoritative when the graph is partial. Exact source-selection/build/MCP receipts are in .compass/verification.json and ignored compass-out/verification.

| Observed source boundary | Graph/source evidence | Team responsibility |
| --- | --- | --- |
| Electron startup | src/main/main.ts startApp → src/main/ipc.ts registerIpc | desktop; lead assigns composition roots |
| Preload boundary | src/preload/miniAppBridge.ts gateKey → assertPayloadSize; ipcApi.request arrow has no callable graph node | desktop + security |
| DSH runtime | src/main/ai/runtime/dsh/dshFork.ts forkDshSession → parseDshForkCheckpoint/runForkWorker | runtime; inspect worker source separately |
| DSH package | packages/dsh-bridge/src/fork.ts forkSession → createForkCheckpoint at three sites | runtime |
| Shared UI | packages/ui/src/components/primitives/toast.tsx getToastUtilities → createToastUtilities; renderer/services/toast.ts import found, cross-package call not established | UX + renderer |
| Resource installer | resources/scripts/install-ovms.js installOvmsBase → downloadWithPowerShell in download.js | desktop + security; no installer executed |

Graph: 5,481 sources, 254,715 nodes, 438,852 edges, 39,677 calls. There are 63 omitted edges and one partial parse in src/shared/data/cache/cacheSchemas.ts. No Program IR; truncated depth-one queries, IPC, dependency injection and dynamic workers need further source/runtime evidence. Counts do not determine staffing: packages/ui contains many icons.

## Cross-project relationships

- UAR: planned Boss runtime integration per user intent. No direct adapter was established by this research. Existing UAR team is ../universal-agent-runtime/.agent-team/uar-core/team.json; read roles and contract before proposing a handoff. Do not import UAR frontend entity architecture into Boss.
- Prometheus skills mini: direct git submodule resources/prometheus-skills-mini in .gitmodules; scripts/sync-prometheus-skills.ts bundles it. Do not edit the submodule here.
- Compass: development graph tool and app workspace integration. src/main/services/prometheus/workspaceMcp.ts configures managed per-workspace servers and invokes graph/skill setup.
- rust-mcp-filesystem: external MCP binary wired in that workspace service with explicit roots/write policy. A checkout's presence does not prove a direct library dependency or active peer team.
- surreal-memory-server: optional external memory service wired by workspaceMcp.ts; UAR separately vendors its library. Boss SQLite remains its own application store.
- prometheus-skill-pack: workspace skill installation considers the full pack; mini is the actual embedded submodule. UAR's skill system is a distinct pinned submodule; do not conflate these.
- Liter: UAR has a pinned vendored provider integration. This research does not establish a direct Boss dependency on Liter. A configured development model gateway is separate from product architecture.

These are source relationships, not a combined cross-repository call graph. Peer repositories remain read-only for this team unless a task explicitly extends scope. No peer-team communication service or shared orchestration daemon was created.

