# Stage 5 / Track A — AI Runtime Unification (Three Waves)

## Objective

Converge desktop `src/main/ai` (683 files, 162,842 lines) and mobile
`apps/mobile/packages/ai-runtime` (+ `apps/mobile/src/backend/ai` shell) onto a single shared
`packages/ai-runtime`. This is the largest unification prize in the repository: 215 files are
currently maintained as live semantic duplicates (≈35–40k lines).

The cut line already exists: `apps/mobile/packages/ai-runtime/desktop-sync-map.json` is a
608-entry, file-granular classification produced by the mobile team during their port. This track
executes along that map rather than re-deriving a decomposition.

## Preconditions

Stage 2b/2c (package dependency chain). Wave 2 additionally requires Stage 4a
(`lifecycle-kernel`). Stage 3a (`provider-registry`) is *not* a hard prerequisite (Track A consumes
whichever registry package mobile declares).

## Prerequisite Task: Re-baseline the sync map

The map is pinned to desktop commit `12498d68` and is **stale** — measured: desktop
`src/main/ai/tokens/` (6 files) has no entries. Before Wave 1:

1. Regenerate/extend the map against the current desktop HEAD (reuse the audit logic in
   `apps/mobile/scripts/desktopSyncAudit.ts`).
2. Reinterpret the map as the **package membership registry**:
   `semantic-port` → shared package; `blocked` → desktop shell (graduates when mobile ships the
   feature); `explicit-exclusion` → excluded from the current package cut and reclassified only by
   an explicit architecture decision.

## Measured Profile (drives the wave partition)

| Directory | Lines | electron / `@application` files | Map (port / blocked / excluded) | Wave |
|---|---|---|---|---|
| `provider` | 8,661 | 0 / 4 | **118 / 2 / 0** (98% already ported) | W1 |
| `types`, `utils`, `tokens`, `messages`, `hooks`, `steerReminder.ts`, `constants.ts` | ≈4,100 | ≈0 | predominantly port | W1 |
| `streamManager` | 6,242 | 0 / 7 | 4 / 45 / 2 | W2 |
| `runtime` | 22,639 | 0 / 28 | 30 / 39 / 34 — **three classes interleaved in one directory** | W2 (file-level surgery) |
| `tools` | 5,250 | 1 / 9 | 22 / 45 / 5 | W2 |
| `mcp` | 13,105 | 7 / 14 | 2 / 72 / 0 | W3 (catalog/process split) |
| `channels`, `inference`, `contextBuild`, `observability`, `skills` | ≈15,000 | low | blocked wholesale | W3 (product-driven graduation) |
| `agents`, `agentSession` | 6,037 | low | explicit-exclusion | **Separate scope** (no dependency on #18802) |

Of the 317 `blocked` entries, **315 carry the reason "No mobile implementation or approved semantic
equivalence mapping exists"** — product lag, not a platform wall. Genuine platform blocks: 2 files
(Node-native local inference).

### Non-dependency with the Agent protocol

[#18802](https://github.com/CherryHQ/cherry-studio/issues/18802) is an independent architecture
initiative, not a migration stage, prerequisite, or residual item. It may proceed before, during, or
after this track; Track A must not postpone protocol work, and protocol work does not block the
measured runtime-package moves here.

Independently of that schedule, keep `src/main/ai/runtime/pi` platform-pure: no Electron or Node-only
API may enter the runtime core. Filesystem, process, network, and secret access stay behind injected
ports so mobile Pi support does not require a later rewrite.

## Coupling Disposition (measured `application.get()` histogram over `src/main/ai`)

| Cluster | Members (call counts) | Disposition |
|---|---|---|
| 1 — intra-domain DI (~60 calls) | `AiStreamManager`×29, `AgentSessionRuntimeService`×18, `ChannelManager`×7, `AiService`×4 | The AI domain uses the DI container as its own module system. Becomes package-internal imports / kernel registrations (Wave 2; depends on 4a). Not a port surface. |
| 2 — cross-domain ports (~100 calls) | `CacheService`×28, `McpCatalogService`×21, `PreferenceService`×18, `FileManager`×18, `JobManager`×10, `DbService`×7, `KnowledgeService`×7 | The true injection surface: 7–8 narrow port interfaces, declared in-package per Stage 0e §2; both applications have counterparts. |
| 3 — desktop-only leaves (~25 calls) | `IpcApiService`×9, `ClaudeCode*`×7, `WindowManager`×2, `BinaryManager`, `PythonService`, `AnalyticsService`, … | All located in `blocked`/`excluded` files. Remain in the desktop shell; no work required. |

Electron symbol surface across the domain: `net`×15 (→ the `fetch` port), plus scattered
single-digit usages (`app`, `shell`, `session`, `BrowserWindow`) confined to shell-destined files.
Direct DB access ≈0 (3 files) — the AI domain reads/writes through data services.

## Wave 1 — `provider` + pure modules (≈13k lines, lowest risk)

1. **Convergence direction: desktop adopts the package boundary.** Promote
   `apps/mobile/packages/ai-runtime` → `packages/ai-runtime` (`git mv` + purity glob), then
   reconcile desktop `src/main/ai/provider/` against `packages/ai-runtime/src/provider/`
   file-by-file (118 port entries).
2. Same wave absorbs: `types/`, `utils/` (23 port files), `tokens/` (6 files; added to the map
   during re-baseline), `messages/` (5 port files), `hooks/` (2), `steerReminder.ts`,
   `constants.ts`.
3. Desktop original paths receive strangler shims (`src/main/ai/provider/… → package re-export`);
   desktop import sites unchanged (Invariant I2).
4. Ports: Wave 1 files need only `fetch`, `cache`, `preference` — declared in-package, adapters
   injected at each application's composition root.
5. **Boundary discipline takes effect at Wave 1 merge:** new desktop AI code lands either in the
   package (pure) or in the shell (impure); PR review enforces.

## Wave 2 — `streamManager` / `runtime` / `tools` (file-level surgery)

- Move the `semantic-port` file set **per file, not per directory** (the three classes interleave
  inside `runtime/`); `blocked`/`excluded` files stay at their desktop paths.
- Cluster-1 refactor happens here: `AiStreamManager` et al. register with `lifecycle-kernel`; each
  application assigns phases at its registration site (desktop `WhenReady`, mobile `Gate`).
- Mobile shell (`apps/mobile/src/backend/ai/{streamManager,runtime,tools}` counterparts) repoints
  to the package.
- Largest work item of the track; partition into 3 PRs (`streamManager` → `tools` → `runtime`),
  each passing both applications' full gates.

## Wave 3 — `mcp` split + long-tail graduation

- `mcp/`: split **catalog** (data/protocol; shareable) from **process runtime** (stdio spawn —
  a genuine platform wall: iOS cannot spawn subprocesses). Remote/SSE transports enter the
  package; stdio stays in the desktop shell. Mobile currently has 2 ported files; the split hands
  it catalog + remote capability wholesale.
- `channels`, `inference`, `contextBuild`, `observability`, `skills`: graduate directory-by-
  directory when the mobile roadmap schedules the corresponding feature. **Unscheduled in this
  playbook.**
- The 2 Node-native local-inference files remain desktop-shell permanently.

## Verification (every PR)

```
pnpm test:main && pnpm build:check
pnpm --filter cherry-studio-app test:ai-runtime && pnpm --filter cherry-studio-app typecheck
```
End-to-end smoke on both applications: send a chat message (desktop `pnpm dev`; mobile simulator).
