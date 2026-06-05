# Branch Navigation UX (Sibling navigator + tree view)

## Context

Cherry's message history is a **DAG** (each message has at most one parent). When users edit-and-resend or regenerate, the affected message gets a sibling group. Users currently switch between siblings via `SiblingNavigator` (`< i/N >` arrows) — works fine when each sibling is a leaf (e.g. immediate post-multi-model selection) but breaks down semantically when each sibling has its own deep subtree (days of conversation, further regen forks).

In the deep-fork case `<2/3>` understates the action: clicking that arrow doesn't toggle a reply, it teleports the user into a parallel conversation timeline whose `created_at DESC` leaf may be hours/days old. The current code is correct (DAG invariant preserved, no context contradictions), but the UI doesn't communicate the magnitude of the switch.

V1 had a `ChatFlowHistory` modal (xyflow-based) for this purpose; it was deleted in the v2 cleanup pass because its data source (Redux `state.messages`) was never populated under v2. The feature need is alive; the V1 implementation isn't reusable.

## Goals

1. **Make branch context legible** — users should always know they're inside a branched conversation and how big each branch is.
2. **Two-tier navigation** — keep arrow-based switching for shallow cases (cheap, fast); offer a tree view for deep/many-branch cases.
3. **Reuse existing DataApi surface** — `MessageService.getTree(topicId, opts)` already returns `{nodes, siblingsGroups, activeNodeId}`. No new backend code beyond surfacing per-subtree metrics.
4. **Single source of truth for active branch** — `topic.activeNodeId`. Tree view click → `setActiveNode(target)` → message pane refreshes via existing path.

## UX layers (lightest → heaviest)

### Layer 1: subtree metadata on `SiblingNavigator`

Augment the existing `< i/N >` to expose the cost of switching:

```
< 2/3 · 47 msgs · 3d ago >    ← deep
< 2/3 >                        ← shallow / immediate
```

Trigger heuristic: render the extended form when the target branch has `subtreeSize > 5` OR `lastActivity > 1h ago`. Keep the bare form for fresh multi-model selection (the dominant case).

Hover tooltip (always available):

```
Branch 2 of 3
  ├─ 47 messages
  ├─ Last reply: 3 days ago (claude-sonnet-4)
  └─ Click to switch · Cmd+Click to preview tree
```

### Layer 2: breadcrumb on the active path

A compact strip above `Messages`:

```
Branch: edit-1/2 → regen-3/3 → edit-2/2
```

One segment per `siblingsGroupId !== 0` node on the active path. Clicking a segment opens that group's tree view scoped to its subtree.

Visible only when the active path crosses ≥1 sibling group. Hidden on linear single-branch topics (zero noise for the common case).

### Layer 3: tree view (resurrected ChatFlowHistory)

Full-page or large modal, on-demand. Triggered by:

- A small "tree" icon next to `SiblingNavigator`
- A keyboard shortcut (e.g. `Cmd+B`)
- Clicking a breadcrumb segment

**Differences from V1**:

| Aspect | V1 ChatFlowHistory (deleted) | V2 (this spec) |
|---|---|---|
| Data source | `selectMessagesForTopic` (Redux, never populated) | `dataApiService.get('/topics/:id/tree')` → `MessageService.getTree` (already returns full `TreeResponse`) |
| Render lib | `@xyflow/react` 12.4.4 — kept | `@xyflow/react` 12.4.4 — kept (dep already declared, drag/zoom/pan/MiniMap all built-in for "view DAG" use case). tldraw considered and rejected: it's a whiteboard runtime — annotation/freehand/multi-shape we don't need; ~5× the bundle. |
| Layout algorithm | Force-directed-ish, manual positioning | `@dagrejs/dagre` (NEW dep) for deterministic top-to-bottom hierarchical layout. xyflow nodes positioned by dagre output before mounting; user can pan/zoom but not re-layout. |
| Modes | Always full-page | Right-side drawer (default, ~480px) + "expand to full" toggle |
| Interaction | View only / click to scroll | Click node → `setActiveNode(nodeId)` → close drawer → message pane refreshes. xyflow's native node `onClick` + drag-to-pan + scroll-to-zoom. No editing handles, no edge drawing — read-only DAG. |
| Performance ceiling | All messages loaded, all rendered | xyflow native viewport culling handles 1k+ nodes fine. Tree query still supports `depth` param; default depth 3 + xyflow's "fitView" on open keeps initial paint cheap. |
| Persistence | None | Drawer-open state in `usePersistCache('chat.branch_tree.open.${topicId}')` so toggling between topics remembers preference per topic. xyflow viewport state (pan/zoom) NOT persisted — re-fits on every open so user always sees the active path centered. |

**Node visual**:

```
┌─────────────────────────────┐
│  user · "say hi"            │
│  ├─ 47 children · 3d ago    │
└─────────────────────────────┘
       │
       ├──── sibling group ───┐
       │                       │
   ┌───┴───┐              ┌────┴───┐
   │ A1    │              │ A2     │
   │ done  │              │ done   │
   └───┬───┘              └────────┘
       │
   ...
```

Each node card carries: role badge, model avatar (assistant only), preview (50 chars), subtree size if >1, last-activity time. Active path nodes drawn with a primary-color border. Sibling groups outlined.

**Tree state vs DataApi sync**: drawer mounts → fetch `getTree(topicId, {depth: 3, nodeId: activeNodeId})` once; subscribe to `useTopicMessagesV2`'s SWR cache so a stream completing or branch switching updates the tree without manual refetch.

## Implementation outline (deferred, not P0)

### NEW

- `src/renderer/src/pages/home/Messages/BranchTree/` — new directory
  - `BranchTreeDrawer.tsx` — drawer shell, opens via shortcut/icon
  - `BranchTreeView.tsx` — `<ReactFlow>` wrapper: receives `tree: TreeResponse`, runs dagre to get node positions, renders xyflow with custom node type
  - `BranchTreeNode.tsx` — custom xyflow node component (role badge, model avatar, preview, subtree size, last-activity)
  - `dagreLayout.ts` — pure helper: `(nodes, edges) → { node positions }` via `@dagrejs/dagre`
  - `useBranchTree.ts` — fetches and caches tree response per topic
- `src/renderer/src/pages/home/Messages/BranchBreadcrumb.tsx` — Layer 2

### NEW dependencies

- `@dagrejs/dagre` — pure JS hierarchical layout, ~30KB, no DOM. Pairs with xyflow per their docs' recommended pattern.

### MODIFIED

- `SiblingNavigator.tsx` — add subtree-aware extended form (Layer 1) + tree-icon button
- `useMessageSiblings` (`hooks/SiblingsContext.ts`) — return per-sibling subtree metadata (size, last-activity)
- `MessageService.getTree` — extend node response to include `subtreeSize` and `lastActivityAt` (keep optional, derive in the same recursive CTE that already fetches the tree)
- `Messages.tsx` — render `<BranchBreadcrumb />` above the message list

### NOT TOUCHED

- `getPathThrough` / `setActiveBranch` / `setActiveNode` — backend semantics stay as-is. Tree-click eventually calls `setActiveNode(targetLeafId)`; for non-leaf clicks resolve via `getPathThrough(targetId)` → leaf. (i.e. clicking an internal node in the tree means "jump to that branch's current tip", same as Layer 1.)
- DAG model — already correct, no schema changes.

## Open questions (defer to design review)

1. **Tree default depth**: 3 levels covers "current turn + 2 ancestors of branch points" — enough for most cases. Should we let users persist their preferred default depth?
2. **Multi-window**: opening the drawer in window A — does window B see it? Probably not (per-window UI state, persist cache scoped per window). Confirm with v2 cache convention.
3. **Performance ceiling**: xyflow's native viewport culling handles ~1k nodes. Beyond that we'd progressive-load via the existing `depth` param on `getTree` — uncommon enough to defer to P2.
4. **Mobile / narrow window**: drawer becomes full-screen below 800px breakpoint? Cherry's narrow-window behavior on other drawers should be matched.
5. **Reading vs editing semantics**: clicking a non-leaf internal node — does it pin you there (so the next user message hangs off that node, creating a new branch), or does it scroll to that node within its branch's leaf path? V1 was the latter; V2 should probably offer both via modifier keys.

## Relationship to other open work

- **Token estimator P0** (`token-estimator-p0.md`): independent, ship first. Once tree view exists, the estimator could optionally show "this branch's prompt would be X / Y" for hovered nodes — a nice-to-have not in P0.
- **`SiblingNavigator` arrow-only deep-fork bug claim**: NOT a bug. Current `created_at DESC` selection is consistent with "switching branches shows that branch's current tip", matching ChatGPT/Claude web. The UX layers above are the right fix for "users don't see the magnitude of the jump" — not memory-of-last-position logic.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-01 | Don't add per-branch "last visited leaf" memory to backend | Adds state for a perceived problem; current behavior matches dominant-product norms |
| 2026-05-01 | Resurrect ChatFlowHistory as `BranchTreeView`, NOT a port of V1 | V1's data source (Redux `selectMessagesForTopic`) was never populated under v2; V2's `getTree` API + DAG invariant give a cleaner foundation |
| 2026-05-01 | Keep `@xyflow/react` (already in deps); add `@dagrejs/dagre` for hierarchical layout | xyflow is purpose-built for view-DAG-with-pan/zoom/click; tldraw's whiteboard runtime is overkill (~5× bundle, persistence model wrong for derived view, no built-in tree layout). Use case is "view + select", not "annotate + draw". |
| 2026-05-01 | Three-layer UX (metadata → breadcrumb → tree view) | Lightest sufficient affordance for the common case; heavier tools available when complexity demands |
