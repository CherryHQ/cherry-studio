# Browser Use — Implementation Plan

Turns [`browser-use-design.md`](./browser-use-design.md) into files, APIs, commits and tests.
Sections 1–9 cover the P0/P1 engine; §10 and §12 plan the next integrated PR for the existing
Agent browser, history and import. P2 (frames, vision, extract) and a full handoff protocol remain deferred.

Read the design doc first. This document does not repeat the rationale; it fixes the decisions.

## Delivery status

PR1 / PR A is implemented in [#20128](https://github.com/CherryHQ/cherry-studio/pull/20128)
(`browser-use-engine`, implementation commit `83fcf4b259`). It remains open. The documentation and
engine are in the same PR; there is no separate documentation prerequisite PR.

| Layer | Base | Status and scope |
|---|---|---|
| PR1 / A — `browser-use-engine` | `webview-agent-pane-browser` | Implemented: shared session ownership, snapshot/ref engine, annotation migration |
| PR2 / B — `browser-use-mcp` | `browser-use-engine` | Implemented on this branch: MCP migration, snapshot/action tools, dialog/download results |
| PR3 / C1–C2 — `browser-use-inspection` | PR B | Open in [#20139](https://github.com/CherryHQ/cherry-studio/pull/20139): inspection and same-document ref recovery |
| Existing Agent browser integration — `agent-browser-integration` | PR3 | Open in [#20166](https://github.com/CherryHQ/cherry-studio/pull/20166): visible-page control, ordinary browsing, history/import, settings and skill (§12) |
| PR7 — `webview-shared-host` | `agent-browser-integration` | Shared renderer guest host and navigation state for MiniApp and Browser (§14) |
| C3–C5 follow-ups | PR3 | WebMCP deferred while Electron stays at 41.8.0; retained-tab freezing and WebContentsView remain independent |
| D work packages | Integrated browser PR | Import work (§10) now ships with its visible-page consumer and history; no independent PR D |

PR B is published as [#20134](https://github.com/CherryHQ/cherry-studio/pull/20134) on
`browser-use-mcp`, stacked on #20128.
Sections below distinguish delivered PR A/B/C1–C2 contracts from planned C3–C5/D and §12 work. `upload_file`
is excluded from PR B until MCP calls carry trusted session/workdir context (§4); true per-turn
retention has the same upstream identity dependency. P0/P1 are roadmap milestones, not PR numbers.

## 1. Decisions fixed by this plan

| Decision | Choice | Why |
|---|---|---|
| Where the engine lives | `src/main/features/browser/` — one domain holding the session engine, snapshot, actions, import **and** the MCP tool adapter (moved out of `src/main/ai/mcp/servers/browser/`) | It is the browser feature's business logic, feature-sized from day one (five sub-modules, three consumers). `ai/` must not import a feature ([main-process.md §3](../../../docs/references/architecture/main-process.md)), so the MCP factory obtains the server through `application.get('BrowserSessionService').createMcpServer()` — ambient DI access, not a module edge |
| Single debugger session per guest | `GuestSession` owns shared-engine attach; PR B removes the legacy MCP attach path | Electron allows one attach per `webContents`; `annotationExport.ts` and browser use must share it |
| Element addressing | `ref` = `e<n>`, allocated monotonically per **GuestSession**, mapped to `backendNodeId` in main for the current document | Stable within a document, cheap to resolve, never leaks across a main-frame navigation |
| Snapshot source | `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`, serialised in main | Replaces the guest-side JS walker in `tools/snapshot.ts`; works without a preload |
| Snapshot output | Diff against the previous snapshot of the same tab by default; `full: true` opts out | Cost is in the tokens, not the CDP call |
| Input execution | Real `Input.*` events with a JS fallback when the hit-test says the point is occluded | What every mature project converged on |
| WebMCP integration | Capability-selected adapter: native CDP first, compatible existing page API second, otherwise unsupported (§5.7) | Protocol types do not prove runtime support; do not replace a page API or bundle an unverified polyfill |
| CDP surface | Explicit allow-list in `cdpAllowList.ts`; `GuestSession.send()` rejects anything else | Reviewable security boundary; `execute` stays the escape hatch |
| Session ownership | Registry keyed by `webContents.id`; every session is `managed` (engine-created hidden tab) or `borrowed` (someone else's page, debugger only); owners acquire/release; retention marks per managed tab | Per-connection controllers are the leak |
| Existing tools | `open`, `execute`, `screenshot`, `list_tabs`, `switch_tab`, `close_tab`, `reset` keep their names and input schemas; `snapshot` keeps its name but changes output | No prompt churn for the tools that already work |

## 2. Module layout

Layout through PR3, with later additions marked by their work packages. PR A contains
the service, main-only contracts, session and snapshot modules; PR B adds `actions/` and `mcp/`.
PR3 adds inspection; the WebMCP adapter and retained-tab freezing remain planned.

```
src/main/features/browser/browserUse.ts     main-only ref / snapshot / ownership / command types + zod schemas

src/main/features/browser/
  index.ts                                  barrel: BrowserSessionService, GuestSession, types
  BrowserSessionService.ts                  lifecycle service: registry, budget, sweep timer, createMcpServer()
  session/
    GuestSession.ts                         one per webContents: debugger, refs, dialog, downloads, retention
    WebMcpSession.ts                        planned C3: capability, tool registry, pending invocations
    BrowserInspection.ts                   PR3: bounded console/exception and network summaries
    BrowserSessionError.ts                  typed command/session failures
    cdpAllowList.ts                         Typed CDP method whitelist and argument tuples
  snapshot/
    captureSnapshot.ts                      CDP calls → raw AX + DOM snapshot
    buildSnapshotTree.ts                    raw → SnapshotNode[] (visibility, interactivity, viewport filter)
    serializeSnapshot.ts                    SnapshotNode[] → text lines, 40 k cap
    diffSnapshot.ts                         previous lines vs current → diff text
    describeElement.ts                      existing annotation AX path/subtree capture
    accessibilityTypes.ts                   annotation capture budgets and result types
  actions/
    resolveTarget.ts                        ref → backendNodeId → centre point + occlusion check
    mouse.ts                                click / hover / scroll via Input.dispatchMouseEvent
    keyboard.ts                             type / press_key via Input.dispatchKeyEvent + insertText, key table
    forms.ts                                select_option; upload_file deferred
    settle.ts                               post-action wait (navigation or network-quiet)
  mcp/                                      moved from src/main/ai/mcp/servers/browser/ (git mv, history kept)
    server.ts                               BrowserServer; constructed by BrowserSessionService.createMcpServer()
    controller.ts                           keeps windows + tabs; CDP calls move to GuestSession
    tabbarHtml.ts, types.ts, README.md      unchanged
    tools/
      snapshot.ts                           rewritten on the engine
      interact.ts                           click, type, press_key, select_option, hover, scroll
      navigate.ts                           go_back, go_forward, wait_for
      dialog.ts                             handle_dialog
      inspect.ts                            find, console_messages, network_requests
      webMcp.ts                             list_web_tools, call_web_tool
      tabs.ts                               + mark_tab
      registry.ts                           tool lists extended
      result.ts                             shared result envelope
  __tests__/                                see §8

src/main/ai/mcp/servers/factory.ts          browser entry becomes application.get('BrowserSessionService').createMcpServer()
```

Dependency edges after the move: `ai/mcp` → feature: none (DI only); `services/webview` → feature:
`application.get` plus type imports through the barrel; `ipc/handlers/browser.ts` → feature: DI. The
feature imports down to `data/`, `core/`, `utils/` and `@shared` only.

PR A migrated `src/main/services/webview/annotationExport.ts` from its own attach/detach cycle to
`GuestSession.describeElement()` (§6).

## 3. Engine contracts (`src/main/features/browser/browserUse.ts`)

These types currently have main-process consumers only, so they stay in the feature. Move only
contracts with actual cross-process consumers to `src/shared/` when that boundary is introduced.

```ts
export const browserRefSchema = z.string().regex(/^e[1-9]\d*$/)
export type BrowserRef = z.infer<typeof browserRefSchema>

export interface SnapshotNode {
  ref?: BrowserRef                 // only interactive nodes get a ref
  backendNodeId: number
  role: string                     // AX role, lower-cased ("button", "link", "textbox", "heading", "text")
  name: string                     // AX name, trimmed, ≤ 200 chars
  value?: string                   // textbox / combobox current value
  props: string[]                  // "disabled" | "checked" | "expanded" | "required" | "level=2" | "href=…"
  depth: number
  inViewport: boolean
}

export interface BrowserSnapshot {
  documentId: string               // loaderId of the main frame; ref namespace
  url: string
  title: string
  nodes: SnapshotNode[]
  omittedNodes: number
  truncated: boolean
}

// Planned PR B adapter result; not part of the PR A API.
export interface BrowserActionResult {
  ok: boolean
  error?: 'stale_ref' | 'not_found' | 'dialog_open' | 'occluded' | 'timeout' | 'debugger_unavailable' | 'not_allowed'
  url: string
  title: string
  navigated: boolean               // main-frame navigation happened during settle
  dialog?: { type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'; message: string }
  downloads?: Array<{ filename: string; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' }>
  newTabId?: string                // a popup/new tab opened; auto-switched
  snapshot?: string                // diff (default) or full text, appended to every action result
}

export type TabRetention = 'temporary' | 'deliverable' | 'handoff'
```

Tool input schemas in the MCP adapter's `tools/*.ts` are Zod schemas passed to
`McpServer.registerTool()`. The SDK generates the advertised JSON schemas and validates
arguments from the same definitions. PR B checks the adapter through an in-memory MCP transport. PR A exports only `browserRefSchema` and `snapshotOptionsSchema`
(`full`, `scope`, integer `maxChars` from 256 to 40 000; unknown fields rejected). The table below
is the planned tool surface, with C-only tools and deferred uploads delivered separately.

| Tool | Input | Notes |
|---|---|---|
| `snapshot` | `{ tabId?, privateMode?, full?: boolean, scope?: BrowserRef, maxChars?: number }` | `scope` replaces the old CSS `selector` |
| `click` | `{ ref, tabId?, privateMode?, button?: 'left'\|'right'\|'middle', clickCount?: 1\|2 }` | |
| `type` | `{ ref, text, tabId?, privateMode?, clear?: boolean, submit?: boolean }` | `submit` presses Enter after read-back succeeds |
| `press_key` | `{ key: string, tabId?, privateMode? }` | `"Enter"`, `"Control+a"`, `"Shift+Tab"` |
| `select_option` | `{ ref, values: string[], tabId?, privateMode? }` | matches option `value` then label |
| `hover` | `{ ref, tabId?, privateMode? }` | |
| `scroll` | `{ ref?, pages?: number, tabId?, privateMode? }` | `pages` default 1, negative scrolls up; no `ref` = viewport |
| `upload_file` | `{ ref, paths: string[], tabId?, privateMode? }` | **Deferred**: requires trusted session/workdir context from the runtime; never accept allowed roots from tool arguments |
| `go_back` / `go_forward` | `{ tabId?, privateMode? }` | `Page.getNavigationHistory` + `navigateToHistoryEntry` |
| `wait_for` | `{ text?: string, ref?: BrowserRef, gone?: boolean, timeoutMs?: number }` | polls the snapshot tree at 250 ms; max 30 s |
| `handle_dialog` | `{ accept: boolean, promptText?: string, tabId?, privateMode? }` | |
| `find` | `{ role?: string, name?: string, tabId?, privateMode? }` | PR3: at least one exact AX filter; up to 100 refs including offscreen elements; does not change the diff baseline |
| `console_messages` | `{ tabId?, privateMode?, level?: 'error'\|'warning'\|'all', clear?: boolean }` | PR3: 200 recent entries per managed tab; clear removes matching levels after reading |
| `network_requests` | `{ tabId?, privateMode?, clear?: boolean }` | PR3: 200 recent request/redirect entries per managed tab: method, URL, status, type, completion/failure; clear after reading |
| `list_web_tools` | `{ tabId?, privateMode? }` | C3: capability (`cdp` / `page-api` / `unsupported`) and bounded descriptors with document-bound `toolId` |
| `call_web_tool` | `{ toolId: string, args: Record<string, unknown>, tabId?, privateMode? }` | C3: use an ID returned by listing; reject stale IDs rather than resolve a name in a later document |
| `mark_tab` | `{ tabId, retention: TabRetention, privateMode? }` | |

## 4. `BrowserSessionService` and `GuestSession`

```ts
@Injectable('BrowserSessionService')
@ServicePhase(Phase.WhenReady)
export class BrowserSessionService extends BaseService {
  acquire(guest: WebContents, owner: string, opts: { ownership: 'managed'; close: () => void } | { ownership: 'borrowed' }): GuestSession
                                                              // creates or refcounts; a guest keeps the ownership it was created with; managed acquire throws when over budget
  get(webContentsId: number): GuestSession | undefined
  release(guest: WebContents, owner: string): void            // managed: refcount → 0 keeps the session until sweep; borrowed: refcount → 0 detaches the debugger and drops the session
  endTurn(owner: string): void                                // closes that owner's `temporary` managed tabs, clears marks; see "Turn boundary" below
  onInit(): registerInterval(sweep, 60_000)
  onStop(): dispose every session, close managed guests only
}
```

**Ownership contract.** `managed` sessions are hidden tabs the engine created (the MCP controller
passes its close callback). `borrowed` sessions wrap a `webContents` someone else owns: the agent
browser pane, an annotated `<webview>`, later a user tab. For a borrowed session the registry may
only attach and detach the debugger. It never closes, freezes, evicts or budget-counts the page, has
no `close` callback to call, and `retention` is not applicable. `annotationExport` (§6) always acquires
as `borrowed`. If the same `webContents` is acquired with a different ownership than it was created
with, `acquire` throws — ownership is a property of the page, not of the caller.

**Turn boundary.** The MCP runtime caches one client per server configuration for the app lifetime
(`McpRuntimeService.clients`) and `callToolById(toolId, params, callId)` carries no agent-session
identity, so today the engine cannot tell which session or turn a tool call belongs to. Until that
changes, PR B uses one `owner` value per MCP server instance (`mcp:<uuid>`) and closes all of its
managed tabs when that server closes. Consequently `temporary` means "reclaimed by idle timeout or budget", not "closed
at turn end". Real turn scoping needs an upstream change first: the agent runtime passes the session id
into MCP tool calls and emits a turn-ended event (the natural hook is
`AgentSessionRuntimeService.handleAutonomousGenerationFinished`). That is a separate decision and PR;
C4 does not pretend to deliver it. The engine exposes `endTurn` for future runtime integration; disconnect uses controller disposal.

**Upload boundary.** The same `callToolById` contract supplies no trusted agent working directory.
`upload_file` therefore stays out of PR B, including its tool registration and CDP allow-list entry.
An upstream runtime contract must supply session identity and authorized roots before adding it;
validation must resolve symlinks and reject paths outside those roots. Neither a model-supplied root
nor the application's process cwd establishes permission to read and upload a file.

**Why not `CacheService` or `lru-cache`.** The registry holds resources that must be released
(`WebContents`, debugger handles, in-flight promises, close callbacks, refcounts), not losable data.
`CacheService` deep-compares values with `isEqual` on every `set`, never fires main subscribers on
eviction ([cache invariant 3](../../../docs/references/data/cache-overview.md#design-invariants)), and
only knows absolute `expireAt` — it cannot run `close` / `freeze` / `detach` on eviction, protect
`deliverable`, or exclude `borrowed`. A session silently dropped from a cache is a leaked debugger.
`lru-cache` (already installed) has `max` + `ttl` + `dispose`, but evicts strictly by recency, so the
retention order would need two containers, and its TTL ignores Vitest fake timers. Every peer in the
repo (`WebviewService.annotationSessions`, `McpRuntimeService.clients`, `CdpBrowserController`) is a
`Map` plus a timer; so is this. What the registry does reuse: `BaseService.registerInterval` for the
sweep, and — for the visible integration in §12 — a Shared-cache projection
(`setShared('browser.sessions.<owner>', summary)`) instead of a new IPC event. The per-tab last
snapshot stays inside `GuestSession`; it is main-only and diffed in place.

Budget constants (in `BrowserSessionService.ts`, not configurable; managed sessions only):

| Constant | Value | Applies to |
|---|---|---|
| `MAX_GUESTS_PER_OWNER` | 4 | `acquire` throws `budget_exceeded` after evicting that owner's oldest `temporary` tab |
| `MAX_GUESTS_GLOBAL` | 8 | same, across owners, `temporary` before `handoff`, never `deliverable` |
| `TEMPORARY_IDLE_MS` | 5 min | sweep calls the managed session's `close` callback |
| `RETAINED_IDLE_MS` (planned C4) | 2 min | future sweep freezes managed `deliverable` / `handoff` sessions: `setBackgroundThrottling(true)`, `Page.setWebLifecycleState({state:'frozen'})`, `debugger.detach()` |

`GuestSession` (implemented PR A surface, one per `webContents.id`):

```ts
export class GuestSession {
  readonly guest: WebContents
  readonly ownership: 'managed' | 'borrowed'
  retention: TabRetention = 'temporary'                     // managed only
  lastActive: number

  // debugger
  send<M extends CdpMethod>(method: M, ...args: CdpCommandArgs<NoInfer<M>>): Promise<ProtocolMapping.Commands[M]['returnType']>
  isAvailable(): boolean                                  // false while DevTools is open or attach failed

  // document + refs
  readonly documentId: string                             // main-frame loaderId; regenerated on Page.frameNavigated
  resolveRef(ref: BrowserRef): number                     // backendNodeId; throws `stale_ref` when the ref's documentId ≠ current or the ref is unknown
  snapshot(opts): Promise<{ text: string; snapshot: BrowserSnapshot }>
  describeElement(annotation: WebviewAnnotation, budget: AccessibilityCaptureBudget, options?: CommandOptions): Promise<AccessibilityCapture>

  pendingDialog?: BrowserDialog

  dispose(): void
}
```

`CommandOptions` carries an absolute `deadline` and optional `AbortSignal`. Detach/disposal
rejects pending operations; snapshots are serialized and discarded if the document changes mid-capture.
Scoped snapshots do not replace the full-page diff baseline.

PR A attach sequence (`GuestSession.ensureAttached`): `attach('1.3')` → `Page.enable`,
`Runtime.enable`, `DOM.enable`, `Accessibility.enable` → `Page.getFrameTree`. Concurrent callers
share initialization. Main-frame navigation and debugger detach invalidate refs and the previous
snapshot; the ref counter never resets within the session. Dialog open/closed events update state.

PR B adds download tracking and the Network events needed for settling. PR3 adds console/network
inspection and typed consumed events via `ProtocolMapping.Events`. `BrowserInspection` belongs to
the guest, records only managed sessions, retains recent history across navigation and clears on
detach/disposal. Text fields cap at 2,000 characters; entry-array output caps at 40,000 serialized
characters, returning the newest entries with `truncated` when needed. `clear` removes all selected
entries, including ones omitted by the output cap, without touching the separate settling state.
`freeze`/`thaw` and WebMCP (§5.7) remain follow-ups. Download events must be attributed to their originating guest on the shared Electron
session; unrelated guests' downloads must never enter a tab's result.

`cdpAllowList.ts` permits the delivered capture, action and dialog methods. Its literal list is checked
against `ProtocolMapping.Commands` from the pinned, type-only `devtools-protocol` dependency.
`GuestSession.send()` uses that mapping for required/optional inputs and inferred results, while
retaining the runtime whitelist check. Each subsequent PR adds
only the commands its implementation consumes; action, Network, WebMCP and import commands are
not pre-authorized.

**Dialog contract.** Two cases, both handled in `send()`:

1. A dialog is already pending: every method except `Page.handleJavaScriptDialog` returns
   `dialog_open` immediately.
2. The in-flight command itself opens the dialog (`execute` running `alert()`, a `click` whose handler
   calls `confirm()`, a navigation hitting `beforeunload`): the renderer's JS thread is blocked and the
   CDP reply will never arrive. `send()` therefore races every in-flight command against
   `Page.javascriptDialogOpening`; when the event fires, the command settles right away with
   `BrowserSessionError('dialog_open', dialog)`. PR B maps that failure to the tool result envelope
   so control returns to the model. The underlying CDP
   promise stays pending in the background and its eventual result is discarded. The settle loop
   (§5.6) is interrupted by the same event. After `handle_dialog`, the blocked command completes inside
   the renderer on its own; nothing is replayed.

A **managed** guest dialog left pending for `DIALOG_TIMEOUT_MS` (60 s) is dismissed by the
watchdog. Borrowed guests are never auto-dismissed. PR B adds once-only reporting in the next tool
result, so a hidden window cannot silently sit behind an invisible modal. §9 case 4 must also confirm
that no native sheet appears on the hidden window while a dialog is pending; if one does, the timeout
becomes the primary policy and the model only sees the reported dialog.

## 5. Algorithms

### 5.1 Snapshot (`snapshot/`)

1. `captureSnapshot`: `Accessibility.getFullAXTree()` and `DOMSnapshot.captureSnapshot({ computedStyles: ['cursor','display','visibility','opacity','pointer-events'], includeDOMRects: true })`, plus viewport metrics via `Runtime.evaluate`. Above 20 000 AX nodes, skip DOM capture and omit values;
   retain a bounded AX-only representation.
2. `buildSnapshotTree`:
   - index DOM snapshot nodes by `backendNodeId` → `{ rect, cursor, display, visibility, opacity, attributes }`;
   - visible = has a rect with area > 0, `display !== 'none'`, `visibility !== 'hidden'`, `opacity > 0`;
   - interactive = AX role ∈ {button, link, textbox, checkbox, radio, combobox, listbox, option, menuitem, menuitemcheckbox, menuitemradio, slider, spinbutton, switch, tab, searchbox} ∨ `cursor === 'pointer'` ∨ attribute `onclick` ∨ `tabindex >= 0` ∨ `contenteditable`;
   - keep a node if interactive, or role ∈ {heading, text, StaticText, img, listitem, cell, row} with a non-empty name;
   - drop `ignored` AX nodes and generic containers with exactly one kept child (re-parent);
   - viewport filter: keep when `rect.y ∈ [scrollY − 1000, scrollY + h + 1000]`, mark `inViewport` when inside the actual viewport; nodes outside the band are counted, not emitted;
   - refs: interactive nodes get `e<n>` from the session's ref map. The counter is per `GuestSession` and never resets, not even on navigation, so a ref from an earlier document can never name an element in a later one. Each entry records `{ backendNodeId, documentId }`; a re-snapshot of the same document keeps existing refs, a new document allocates fresh numbers. `resolveRef` returns `stale_ref` when the entry's `documentId` differs from the current one or the ref is unknown; it never re-resolves across documents.
3. `serializeSnapshot`: one node per line, two spaces per depth:
   `[e12] button "Submit" (disabled)` / `heading "Pricing" (level=2)` / `[e13] link "Docs" (href=/docs)`; textbox values as `value="…"` truncated at 80 chars. Header line `url · title · N interactive / M total`. Cap 40 000 chars, closing with `… (K more nodes below; use scroll, scope, or find)`.
4. `diffSnapshot`: key each line by `backendNodeId`. Output = header + lines that are new (prefixed `*`) or whose text changed, plus `- N nodes removed`. Fall back to the full text when more than 60 % of the lines changed or the `documentId` differs. Unchanged snapshot → `(no change)`.

PR B implements §5.2–§5.6; the WebMCP algorithm in §5.7 remains planned for PR C. PR A also suppresses password
values/descendants and sanitizes data URLs and URL credentials in snapshot text and metadata.

### 5.2 Target resolution (`actions/resolveTarget.ts`)

PR3 keeps `resolveRef()` synchronous. Before any element callback, `withElement()` resolves the
node and checks `isConnected`. Only a missing/disconnected node triggers one `recoverRef()` query
using the full role/name saved during observation. The pair must have been unique then and still
match exactly one unignored node now; unnamed, oversized-name and ambiguous targets require a new
snapshot. Main-document navigation or detach invalidates all recovery metadata. A replacement
already assigned another ref is rejected rather than silently merging identities. No callback or
input event is replayed after it starts, and cancellation/protocol failures retain their errors.
Managed queries enable the existing focus emulation before querying AX: on Electron 41.8,
the hidden-page query otherwise timed out in real acceptance. `find` shares this path.

`resolveRef` → `DOM.scrollIntoViewIfNeeded({ backendNodeId })` → `DOM.getContentQuads` → centre of the largest quad → `DOM.getNodeForLocation`. PR3 adds `Page.getLayoutMetrics().cssLayoutViewport.pageX/pageY` to the hit-test point because this command takes document coordinates; quads and mouse input stay in viewport coordinates. This fixes actions on offscreen `find` results. If the hit node is the target or one of its descendants: `{ x, y, occluded: false }`. Otherwise `{ x, y, occluded: true }`; mouse actions then use the JS fallback (`DOM.resolveNode` → `Runtime.callFunctionOn(function(){ this.click() })`) and report `occluded` in the result so the model knows the click was synthetic.

The coordinate conversion is verified against [Chromium's DOM agent](https://chromium.googlesource.com/chromium/src/+/6ea845148338bfc8456133393818f6df93c82c0e/third_party/blink/renderer/core/inspector/inspector_dom_agent.cc)
and the scrolled-page Electron acceptance case.

### 5.3 Mouse (`actions/mouse.ts`)

- click: `Input.dispatchMouseEvent` ×3 (`mouseMoved`, `mousePressed`, `mouseReleased`) with `button`, `clickCount`; right button also dispatches `contextmenu` naturally.
- hover: `mouseMoved` only; result snapshot diff shows what appeared.
- scroll: `mouseWheel` at the target centre (or viewport centre) with `deltaY = pages × innerHeight`.

### 5.4 Keyboard (`actions/keyboard.ts`)

- `type`: `DOM.focus({ backendNodeId })`; `clear` → `Control/Meta+a` then `Delete` via key events; then `Input.insertText({ text })`; read back `value ?? textContent` via `Runtime.callFunctionOn`; mismatch → retry once with per-character `dispatchKeyEvent` (`keyDown` with `text`, `keyUp`), still mismatched → `ok: false`, `error: 'not_found'` with the observed value in the text.
- `press_key`: parse `Modifier+Key`; key table maps names → `{ key, code, windowsVirtualKeyCode }` (Enter 13, Tab 9, Escape 27, Backspace 8, Delete 46, arrows 37–40, Home/End/PageUp/PageDown, F1–F12, printable characters). Modifiers bitmask: Alt 1, Control 2, Meta 4, Shift 8. Enter additionally sends `char` with `text: '\r'` so forms submit.

### 5.5 Forms (`actions/forms.ts`)

- `select_option`: `Runtime.callFunctionOn` on the `<select>` node: for each option set `selected` when `value ∈ values` or `label ∈ values`; dispatch `input` and `change` (bubbles). Unknown value → `not_found` listing available options.
- `upload_file` is deferred (§4). Add `DOM.setFileInputFiles` only after trusted root containment,
  including symlink resolution, can be enforced by the runtime/tool boundary.

### 5.6 Settle (`actions/settle.ts`)

After every action: wait 100 ms for `Page.frameStartedNavigation` on the main frame; if it fires, wait for `Page.loadEventFired` (max 10 s) and set `navigated: true`; otherwise wait until no `Network.requestWillBeSent` / `loadingFinished` for 300 ms (max 5 s). Then take the diff snapshot for the result. `wait_for` reuses the same loop with a predicate over `buildSnapshotTree`.

### 5.7 WebMCP adapter

C3 is a separate follow-up to PR3's inspection/ref-recovery work. Nothing in this section is
implemented by PR A/B. Initial scope is the managed tab's main document; iframe/OOPIF discovery,
cross-origin exposure, declarative-form support and borrowed visible-pane integration are deferred.

**Compatibility baseline (checked 2026-09-07)**

- The [Community Group draft](https://webmachinelearning.github.io/webmcp/) is evolving, not a
  W3C Standard. Its entry point is `document.modelContext`, with the contract below.
- The [experimental CDP domain](https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/)
  is a separate browser-agent transport. It has event-based discovery and completion, not `list()`.
- `package.json` pins Electron `41.8.0` and `devtools-protocol` `0.0.1692173`. The latter includes
  WebMCP command/event types, while the running Electron / Chromium `146.0.7680.216` instance's
  `/json/protocol` has no WebMCP domain. Page API compatibility has not been runtime-verified.
  Remove the old assumption that Electron 43 necessarily unlocks native support.

| Draft page API | Contract the adapter must respect |
|---|---|
| `registerTool(tool, { signal? })` | Async registration; aborting the registration signal removes the tool |
| `getTools(options?)` | Async descriptors; retain only tools whose `window` is the current main window |
| `executeTool(tool, inputObject?, { signal? })` | Takes a returned descriptor, not just a name; resolves to a serialized result string |
| `toolchange` | Invalidate previously observed descriptors and refresh before another call |

The old `navigator.modelContext`, `provideContext` and `unregisterTool` sketch is not this contract.
Do not infer API compatibility from property presence alone or alias old APIs silently.

**Capability selection**

Probe through `GuestSession` when WebMCP is first requested. Install event listeners before trying
`WebMCP.enable`; a missing/unsupported domain permits the page-API path. Debugger loss, navigation,
permission failures and deadlines retain their actual errors rather than triggering a fallback.
Re-evaluate after document replacement or debugger reattachment; never switch transports and
retry a tool after invocation has begun, since that could repeat side effects.

For native CDP, `toolsAdded` / `toolsRemoved` maintain the main-frame registry; enabling also
announces existing tools. `invokeTool({ frameId, toolName, input })` returns an `invocationId`;
wait for the matching `toolResponded` and interpret `Completed` / `Canceled` / `Error` separately.
Bound initial discovery and test event ordering on the selected runtime. Reuse
`ProtocolMapping.Commands` and `ProtocolMapping.Events` from the pinned official dependency,
and add only consumed commands to `cdpAllowList.ts`.

When CDP is unavailable, a compatible existing `document.modelContext` may be called in the
current main-world execution context. Keep returned descriptors in that document and pass tool
arguments as structured `Runtime.callFunctionOn` arguments, never interpolate them into JS.
Serialize only metadata to main; never serialize a descriptor's `Window`. API shape checks plus
a real fixture test establish compatibility; a page-provided implementation remains untrusted.
With neither transport, `list_web_tools` reports `unsupported` with a reason, distinct from an
available API with zero tools. `call_web_tool` returns an MCP tool error without executing JS.

Bundling a polyfill is deferred. First compare maintained implementations with the chosen draft
and record gaps before selecting a dependency or proposing custom code. If injection is later
approved, it must precede site registration scripts on newly managed documents, avoid overwriting
existing APIs, and track/remove its CDP script registration during cleanup. Late attachment cannot
recover registrations a page skipped before the API existed. A private `__cherryModelContext`
registry alone is not standards conformance or a security boundary.

**Identity, results and ownership**

`GuestSession` owns one dynamic `WebMcpSession`; `BrowserSessionService` retains lifecycle ownership
through the guest. The child tracks subscriptions, document-local handles, deadlines and pending
invocations, rather than becoming an application singleton. Each MCP call still belongs to its
controller: disconnect cancels that controller's calls without disposing another owner's guest.

Listing returns bounded, untrusted descriptors with opaque `toolId` values tied to the guest,
document and observed registry revision. Navigation, context destruction, detach and observed
registry changes invalidate them; calls reject stale IDs and require a fresh list. Recheck the
descriptor before dispatch. Native invocation ultimately addresses a name, so this does not
guarantee atomic registration identity if a page replaces a tool during dispatch.

Accept a JSON object for input. Validate it against the advertised schema with an existing
compatible JSON Schema validator; unsupported schemas fail explicitly, never trigger remote
schema fetching or AI argument repair. Bound descriptor count, metadata/schema sizes and result
text. Preserve the page API's serialized result without double encoding; normalize native output
to MCP content and report truncation. Tool annotations are hints, never authorization or a reason
to omit the untrusted-data notice.

Abort/deadline/disconnect requests `WebMCP.cancelInvocation` or aborts the page call's controller,
settles Cherry's pending result once, and ignores late completion. Cancellation is cooperative:
`Runtime.evaluate.timeout` does not guarantee an async tool stops or its effects are undone.
Disposal reuses one close Promise, cancels pending work, releases remote handles/listeners and
disables the domain before guest detach where possible. Navigation/context loss also rejects
pending calls. Service shutdown must await this cleanup; it must never wait indefinitely for a
page's uncooperative Promise.

## 6. Annotation export migration

PR A extracted the existing isolated-world selector resolution and AX path/subtree walk into
`snapshot/describeElement.ts`. Export holds one borrowed session across all annotations, preserving
per-document/request budgets, deadlines, cancellation, shadow-root selectors and form-value redaction:

```ts
const service = application.get('BrowserSessionService')
const owner = `annotation:${guest.id}`
const session = service.acquire(guest, owner, { ownership: 'borrowed' })
try {
  return await session.describeElement(annotation, budget, { deadline, signal })
} finally {
  service.release(guest, owner)
}
```

`describeElement` returns the existing `AccessibilityCapture` shape; `annotationMarkdown.ts`
keeps its format. `WebviewService` now declares `@DependsOn(['BrowserSessionService'])`.
`debugger_unavailable` covers DevTools, an external debugger, a destroyed guest or attach failure;
another owner of the same borrowed session no longer blocks export.

Saved annotation locators are unchanged. Optional `backendNodeId` / `documentId` fields and their
validity/handoff contract belong to the P3 consumer; no speculative persisted fields were added.

## 7. Commit and PR split

PR A combines the original design documents and the implemented engine in #20128. PR B builds
on A; PR3 implements C1–C2 on B. The next integrated browser PR builds on PR3 and includes the
import work packages (§10) plus the existing-pane integration (§12). Future commit groups below
are planning units, not a claim that those commits or APIs already exist.

### PR A / PR1 — completed in #20128 (open)

Implementation commit: `83fcf4b259` — `feat(browser-session): add shared CDP engine and annotation capture`.

| Component | Delivered files | Validation |
|---|---|---|
| Main-only contracts | `features/browser/browserUse.ts` | Ref/options validation in `snapshot.test.ts` |
| Shared debugger and command lifecycle | `session/{GuestSession,BrowserSessionError,cdpAllowList}.ts` | `GuestSession.test.ts`: sharing, navigation/detach, deadlines, cancellation, dialogs |
| Resource registry | `BrowserSessionService.ts`, `serviceRegistry.ts` | `BrowserSessionService.test.ts`: ownership, budget, idle sweep, shutdown |
| Snapshot and diff | `snapshot/{captureSnapshot,buildSnapshotTree,serializeSnapshot,diffSnapshot}.ts` | `snapshot.test.ts`: recorded form, visibility, redaction, truncation, stable refs and diffs |
| Annotation migration | `snapshot/{describeElement,accessibilityTypes}.ts`, `annotationExport.ts`, `annotationTypes.ts`, `WebviewService.ts` | Existing annotation export/markdown and webview service suites |

Validation at that commit: **59 tests across 6 files passed**, `pnpm lint` and `pnpm docs:check-links`
passed. An isolated Electron smoke run captured the form snapshot in 28 ms, returned `(no change)`
on the second capture, rejected an old ref after navigation, interrupted a confirm-blocked command,
and exported annotation AX context while sharing the guest session. This validates the engine;
it does not validate the future MCP adapter, action tools, or large-page performance targets.

### PR B / PR2 — `feat(browser-mcp): P0 tools on the shared engine`

| # | Commit | Files | Tests |
|---|---|---|---|
| B0 | `refactor(browser-mcp): move the MCP server into features/browser` | `git mv src/main/ai/mcp/servers/browser src/main/features/browser/mcp`; `factory.ts` → `application.get('BrowserSessionService').createMcpServer()`; `BrowserSessionService.createMcpServer()` | `features/browser/__tests__/mcp/browser.test.ts` exercises the real service, factory and MCP transport |
| B1 | `refactor(browser-mcp): route controller CDP calls through BrowserSessionService` | `mcp/controller.ts` (drop `ensureDebuggerAttached`, `dbg.sendCommand`), `mcp/server.ts` (owner = `mcp:<uuid>`; `onclose` → `endTurn` + release) | the moved controller test adapted: the fake debugger is now reached via the service |
| B2 | `feat(browser-mcp): serve snapshot from the accessibility engine with diff by default` | `tools/snapshot.ts`, `tools/result.ts` | `__tests__/mcp/browser.test.ts` plus the shared snapshot tests: envelopes, diff, stale refs, options and caps |
| B3 | `feat(browser-mcp): add click, hover and scroll` | `actions/{resolveTarget,mouse}.ts`, `tools/interact.ts` | `__tests__/actions.test.ts`: geometry, descendant hit testing, real and synthetic clicks, covered hover |
| B4 | `feat(browser-mcp): add type and press_key` | `actions/keyboard.ts` | `__tests__/actions.test.ts`: input retry, email append, newline handling and key chords |
| B5 | `feat(browser-mcp): add select_option` | `actions/forms.ts` | `__tests__/actions.test.ts`: atomic selection and input/change events |
| B6 | `feat(browser-mcp): add go_back, go_forward, wait_for and action settling` | `actions/settle.ts`, `tools/navigate.ts` | `__tests__/actions.test.ts` and `__tests__/mcp/browser.test.ts`; real Electron history/wait/popup smoke |
| B7 | `feat(browser-mcp): surface dialogs and downloads, add handle_dialog` | `GuestSession.ts` listeners, `tools/dialog.ts` | `__tests__/GuestSession.test.ts`, `__tests__/downloads.test.ts`; real Electron dialog/download smoke |
| B8 | `docs(browser-mcp): document the browser-use tool set` | `features/browser/mcp/README.md`, `settings.mcp.builtinServersDescriptions.browser` in `en-us.json` + `pnpm i18n:sync` + translations | `pnpm lint` (i18n check) |

PR B implementation notes:

- `BrowserSessionService.createMcpServer()` owns server cleanup; shutdown dependencies order
  MCP runtime → browser service → WindowManager. Per-tab operations are serialized and new
  BrowserViews load `about:blank` before CDP initialization. Concurrent window creation is coalesced.
- Dynamic servers/controllers share an idempotent close promise. Disconnect starts cleanup;
  the service retains the server until transport, controller and tool handlers settle. Stop
  releases remaining guest leases before reporting close failures. Guest disposal is synchronous:
  it cancels queued work and pending waits, without promising cancellation inside Chromium.
- Actions and snapshots use separate `async-mutex` locks; delays use Node's cancellable timers.
  CDP-specific deadlines, dialog interruption, detach handling and reference epochs stay in `GuestSession`.
- All background tabs stay attached behind the active view and receive viewport bounds. Explicit missing tab IDs fail without creating
  a replacement window; budget eviction closes the guest and the final host/tab-bar resources.
- New tool schemas are generated from Zod. Snapshot/action envelopes carry bounded snapshot text,
  typed errors, dialog/download updates and popup `newTabId`; legacy open/execute/image outputs remain.
- Download reporting preserves Electron's existing save flow. No automatic download directory or
  upload capability is added. A stopped download navigation settles without claiming a new document.
- Annotation tests retain the real event emitter while substituting lifecycle/container ownership.

PR B validation:

- The latest shutdown changes passed 127 focused tests across 8 files covering the browser engine/actions, MCP adapter,
  MCP runtime lifecycle and webview annotation integration.
- `pnpm lint` and `pnpm docs:check` passed. The full test suite was intentionally skipped under
  the workspace's local validation override.
- A real Electron instance and MCP SDK transport passed 37 interaction steps using
  `tests/fixtures/browser-use/interaction.html`: snapshot/diff, form and email input, selection,
  mouse/keyboard/scroll, screenshot, download completion, covered-click fallback, fetch settling,
  dialog interruption/resolution, submit navigation, stale refs, history/wait, popup readiness and
  background-tab snapshots, and disconnect during a pending command with native destruction awaited.
  Synthetic protocol and download handlers existed only in the smoke harness.

### PR C work packages — stability, inspection and follow-ups

PR3 ([#20139](https://github.com/CherryHQ/cherry-studio/pull/20139)) implements C1–C2 on `browser-use-inspection`.
The next delivery is §12. C3 is deferred while Electron remains at 41.8.0; its eventual delivery still
requires the runtime compatibility gate (§5.7). C4–C5 remain separately scoped work. These labels
identify work packages, not one required PR; C5 does not mean an assigned PR5.

| # | Commit | Files | Tests |
|---|---|---|---|
| C1 | `feat(browser-mcp): recover re-rendered refs by role and name` | `withElement` validates before effects; `GuestSession.recoverRef` queries a unique same-document replacement; `resolveRef` remains synchronous | `refRecovery.test.ts`: replacement, ambiguity, full names, navigation/detach, cancellation, no action replay |
| C2 | `feat(browser-mcp): add find, console_messages and network_requests` | `tools/inspect.ts`, guest-owned `BrowserInspection`, official event types | `inspection.test.ts`: bounds, filtering/clear, redirect/failure, ownership and independent settling; MCP transport tests |
| C3 | `feat(browser-mcp): expose page tools through a capability-selected WebMCP adapter` | `session/WebMcpSession.ts`, `GuestSession` ownership, typed CDP events/allow-list, `tools/webMcp.ts` | `WebMcpSession.test.ts`, `webMcp.test.ts`, real Electron capability and invocation acceptance (§8.4 / §9); bundled polyfill deferred |
| C4 | `feat(browser-session): expose retention marks and freeze retained tabs` | Extend PR A's existing sweep with freeze/thaw + `mark_tab` tool; retention marks change eviction order and freeze eligibility only, no turn scoping (§4 "Turn boundary") | `BrowserSessionService.test.ts` freeze/evict cases |
| C5 | `refactor(browser-mcp): replace BrowserView tabs with WebContentsView` | `controller.ts`, `types.ts`, `tabbarHtml.ts` | existing controller tests; manual (§9) |

PR3 validation:

- 143 focused tests passed across browser engine/actions/inspection/MCP, annotation export and
  MCP runtime suites. `pnpm lint`, `pnpm test:lint` and `pnpm docs:check` passed; the full test suite
  was intentionally skipped under the workspace's local validation override.
- Electron 41.8.0 with Chromium 146 passed 26 real MCP interaction steps against
  `tests/fixtures/browser-use/inspection.html`, with HTTP responses supplied by the smoke harness.
- Verified 21-tool discovery, offscreen `find` and click, unchanged snapshot diff baseline, one
  recovered click after node replacement, ambiguity rejection without effects, cross-document
  staleness, console warnings/exceptions and filtered clear, slow-request settling, redirect hops,
  failed requests, guest isolation and tracked server cleanup.
- Runtime verification exposed two issues fixed in this layer: hidden AX queries need focus
  emulation, and DOM hit testing needs document coordinates after scrolling (§5.2).

Deferred (tracked as follow-ups, not in these PRs): the upstream turn signal (agent session id on
MCP tool calls + a turn-ended event, §4 "Turn boundary") without which `temporary` cannot mean
per-turn; trusted runtime workdir context and `upload_file`; configurable per-origin CDP policy.
The `<webview>` pane as an engine target moves into the next integrated PR (§12).

## 8. Automated test plan

PR A/B/PR3 results are recorded in §7. The following checklist also includes future coverage;
planned fixtures and test files are not evidence that those checks have run.

Projects come from `vitest.config.*`: `main` (node), `shared`, `preload`, `renderer` (jsdom).
Run with `pnpm exec vitest run <path>`; never `pnpm test <path>`.

### 8.1 Fixtures (`src/main/features/browser/__tests__/fixtures/`)

Recorded once from the dev app with the existing `execute` tool replaced by a one-off debugger
call (`getFullAXTree` + `captureSnapshot` JSON). PR A commits `form.json` with both raw captures
and `tests/fixtures/browser-use/form.html`; the other fixtures below are planned for B/C:

| Fixture | Exercises |
|---|---|
| `form.html` (`tests/fixtures/browser-use/`) — text, password, select, checkbox, file input, submit | interactivity rules, `value` rendering, refs |
| `overlap.html` — two absolutely positioned cards, the top one covering the button of the bottom one | occlusion → JS fallback path |
| `long.html` — 400 list items | viewport band, cap, `(K more nodes)` |
| `dialogs.html` — buttons that call `alert` / `confirm` / `prompt`, a `beforeunload` handler | dialog watchdog |
| `spa.html` — `pushState` navigation and a fetch that resolves after 800 ms | settle: in-document navigation keeps refs, network-quiet wait |
| `inspection.html` — rebuild/duplicate a button, emit console/exception data, make slow/redirect/failed requests, offscreen target | PR3: real Electron ref recovery and inspection; smoke harness supplies HTTP responses |
| `webmcp.html` — awaits `document.modelContext.registerTool`; includes a delayed abort-aware tool and registration removal | C3: API compatibility, discovery, result/error/cancellation and registry invalidation; explicitly report unsupported API |

The HTML files double as the manual acceptance pages (§9).

### 8.2 `main` project — engine

`GuestSession.test.ts` (fake `webContents` with `debugger.{attach,detach,sendCommand,on,isAttached}`,
same pattern as today's `servers/__tests__/browser.test.ts`):

- attaches once across many `send` calls; `attach` throwing → `isAvailable() === false` and `send` rejects `debugger_unavailable`;
- `send('Target.createTarget')` rejects `not_allowed` without touching the debugger;
- `Page.frameNavigated` for the main frame changes `documentId`, `resolveRef` of an old ref throws `stale_ref`; a sub-frame navigation does not; after navigation the next allocated ref is numerically higher than every ref of the previous document (no reuse);
- `Page.javascriptDialogOpening` sets `pendingDialog`; the next `send('Runtime.evaluate', { expression: '1' })` rejects `dialog_open`; `Page.handleJavaScriptDialog` clears it;
- an in-flight `send('Runtime.evaluate', { expression: '1' })` whose fake never replies settles with `dialog_open` as soon as `Page.javascriptDialogOpening` fires; the late reply is ignored; a pending dialog is dismissed after `DIALOG_TIMEOUT_MS` (fake timers) (managed only); once-only reporting is a PR B test;
- a `borrowed` session with refcount 0 is detached, never closed or frozen, and `acquire` with the other ownership throws;
- `will-download` items appear once in `takeDownloads()` and are then gone;
- `debugger` `detach` event (DevTools opened) flips `isAvailable()`; the next `send` re-attaches when possible.

`snapshot.test.ts` (fixtures):

- `form.html`: every input gets a ref, the label text does not; the password textbox shows no value; the disabled button carries `(disabled)`;
- `overlap.html`: both buttons are emitted (occlusion is resolved at action time, not snapshot time);
- `long.html`: nodes beyond the band are counted in the footer, output ≤ 40 000 chars, header counts match;
- refs are stable across two builds of the same document, and re-allocated after `documentId` changes.

`snapshot.test.ts` (diff cases): new node gets `*`; removed nodes summarised; changed value line re-emitted; >60 % churn → full; identical → `(no change)`.

`resolveTarget.test.ts`: centre from the largest quad; `getNodeForLocation` returning a descendant → not occluded; a sibling → occluded.

`mouse.test.ts` / `keyboard.test.ts` / `forms.test.ts`: assert the CDP command sequence and parameters the guest receives (the contract of "real input events"): three mouse events at the resolved point, `insertText` after `focus`, `Control+a`/`Delete` before typing when `clear`, read-back mismatch → per-character retry → error; `press_key('Control+a')` → modifiers 2 with `windowsVirtualKeyCode` 65. Deferred upload tests must cover traversal and symlink escape once the trusted-context prerequisite exists.

`settle.test.ts` (fake timers): navigation started within 100 ms → waits for `loadEventFired`, `navigated: true`; no navigation → resolves after 300 ms quiet; a request every 200 ms → resolves at the 5 s cap.

`BrowserSessionService.test.ts` (use `tests/__mocks__` `application` mock, `registerInterval` from `BaseService`):

- `acquire` returns the same session for the same `webContents.id`; refcount survives one `release`; a `borrowed` session is not counted against either budget and is skipped by the sweep;
- fifth `acquire` for one owner evicts that owner's oldest `temporary` session first and never a `deliverable` one; ninth global `acquire` with only `deliverable` sessions throws `budget_exceeded`;
- sweep after `TEMPORARY_IDLE_MS` closes temporary sessions, after `RETAINED_IDLE_MS` freezes retained ones (`setBackgroundThrottling(true)`, `Page.setWebLifecycleState`, `detach` in that order) and `thaw` on the next `send`;
- `endTurn(owner)` closes only that owner's temporary managed tabs and resets marks; borrowed sessions of the same owner are untouched.

`annotationExport.test.ts` (existing): add the case "engine already attached → export still returns AX context"; retain rejection coverage for an externally attached debugger.

### 8.3 `main` project — MCP adapter

The moved controller test keeps its window/tab coverage. New `__tests__/mcp/tools/*.test.ts`
use a fake `GuestSession` and assert the result envelope: `dialog` present when pending, `snapshot`
appended after actions, `stale_ref` text includes the hint to re-snapshot, unknown tool name rejected
by the registry.

### 8.4 Main-only contracts and WebMCP adapter

- `snapshot.test.ts`: engine ref/options schemas (PR A); adapter input schemas added in PR B.
- C3 `WebMcpSession.test.ts`: native unavailable selects a compatible page API; neither available
  reports unsupported rather than an empty success. Permission/debugger failures do not masquerade
  as capability absence; an invocation failure never retries through another transport.
- Discovery tests: initial and later registrations appear; removals invalidate handles; child-frame
  tools are excluded; replacing a document with an identically named tool cannot execute an old ID.
  Exercise events arriving during enable and immediately after invocation acknowledgement.
- Execution tests: match concurrent results by invocation ID, preserve serialized page results,
  reject invalid inputs and unsupported schemas, bound oversized output, and return tool failures
  as MCP errors. Missing/changed descriptors cannot dispatch a name-only fallback.
- Lifecycle tests: timeout, caller abort, controller disconnect, navigation and guest disposal settle
  pending calls once; late results cannot resurrect them. Disconnect affects only that owner's work,
  repeated close callers await the same cleanup, and shutdown completes even if page work ignores abort.
- Real Electron acceptance is required for every claimed transport. Record Electron/Chromium and
  draft/protocol versions, capability outcome, event ordering and fixture results. Mock/jsdom tests
  alone cannot establish native WebMCP support or polyfill conformance. On the current runtime,
  verify unsupported behavior; successful invocation needs a separately verified compatible API.

### 8.5 Gates per commit

`pnpm exec vitest run <changed test files>`, `pnpm lint`, `pnpm format`; `pnpm docs:check-links`
for code commits that update docs. Docs-only updates run `pnpm docs:check`. CI owns the full
suite; local full-suite execution is intentionally skipped under this workspace's override.

## 9. Manual acceptance (dev app)

The engine-only smoke results are recorded in §7. The MCP scripts below are acceptance targets
for B/C, not completed PR A checks. Use an isolated dev instance so the shared dev database is untouched. Enable `@cherry/browser` in
Settings → MCP, start an agent session with the server active, and run each script; expected results
are what the tool text must contain.

| # | Script | Expected |
|---|---|---|
| 1 | `open` `tests/fixtures/browser-use/form.html` → `snapshot` | refs for every field; second `snapshot` returns `(no change)` |
| 2 | `type` the name field with `clear: true`, `select_option`, `click` submit | result `navigated: true`, diff shows the confirmation heading with `*` |
| 3 | `overlap.html`: `click` the covered button | result reports `occluded`, the page shows the button's handler ran |
| 4 | `dialogs.html`: `click` the confirm button, then `execute('1+1')` | first result has `dialog`; `execute` returns `dialog_open` immediately (no hang); `handle_dialog({accept:true})` clears it |
| 5 | `long.html`: `snapshot`, `scroll` 3 pages, `snapshot` | footer count drops, new refs appear with `*`, old refs still resolve |
| 6 | `spa.html`: `click` the pushState link, `click` the fetch button | refs survive the first click; the second returns only after the delayed fetch settles |
| 7 (deferred) | After trusted runtime context exists: `upload_file` with a path outside the workdir | `not_allowed`, no CDP `setFileInputFiles` in the debug log |
| 8 | Open DevTools on the hidden window's tab, run `snapshot` | `debugger_unavailable`; close DevTools, `snapshot` works again |
| 9 | Acquire a borrowed engine session for the annotation guest, export annotations while that session is held, then release it | export contains the AX path and does not detach the other owner; PR1–3 use separate MCP/pane guests, while §12 adds same-pane acceptance |
| 10 | Open 5 tabs, wait 5 min | only marked tabs survive; `app.getAppMetrics()` logged before/after shows the freed renderer processes |
| 11 | C3 `webmcp.html`: list/call, abort, remove registration, navigate, disconnect | record capability and runtime versions; supported paths list untrusted metadata and return the expected result; unsupported is explicit; stale IDs cannot run a later document's tool; pending calls settle on cancellation/cleanup |
| 12 | Perf: `open https://github.com/CherryHQ/cherry-studio/pulls`, `snapshot` ×3 | logged capture + serialise time < 1 s each, output ≤ 40 000 chars, diff #2 and #3 < 2 000 chars |

Record the numbers of #10 and #12 in the PR description; they are the acceptance criteria for the
session-management commit.

## 10. Importing external browser data

Import is part of the existing Agent browser integration (§12), not a separate hidden-MCP feature.
The destination is the ordinary visible browser's persistent profile, selected by main; neither
the renderer nor the model chooses an Electron partition. Import is a **user action**, never a model
tool. The previous `persist:default` destination and MCP-settings entry are superseded by this plan.

### 10.1 Scope

| Data | Import | Why |
|---|---|---|
| Cookies | yes | login state; what every site checks |
| `localStorage` per origin | yes, from storage-state files only | SPA tokens (JWT in `localStorage`) — not readable from browser profiles without the browser's own LevelDB, so file import only |
| Bookmarks | deferred | requires a bookmark browsing/management consumer; not needed for the agreed history/login scope |
| History | yes, from supported profiles | consumed by the Browser history UI (§12.4); preserve visit timestamps and deduplicate repeated imports |
| Passwords, extensions, browser settings | no | outside this PR; no password-vault import or model tool |

Two import paths (the settings dialog defaults to the detected browser):

1. **Storage-state file** (portable, no decryption): Playwright `storageState` JSON
   (`{ cookies: [{ name, value, domain, path, expires, httpOnly, secure, sameSite }], origins: [{ origin, localStorage: [{ name, value }] }] }`)
   and Netscape `cookies.txt` (what curl, yt-dlp and the "Get cookies.txt" extensions emit). Works on every
   OS and every browser, including ones we cannot decrypt.
2. **Profile read** from a detected installed browser: Chromium family (Chrome, Edge, Brave, Chromium,
   Vivaldi, Opera, Dia, Comet) and Firefox. Detect support separately for history and cookies: encrypted cookies must not
   disable an otherwise readable history source. Use a consistent read-only SQLite snapshot (including
   WAL state), or report that the browser must be closed; copying only the main database can omit visits.
   Decrypt cookies only through a supported, user-authorized path, then apply.

### 10.2 Module layout and API

```
src/main/features/browser/import/
  formats.ts            parseStorageState(json) / parseNetscape(text) → ImportedCookie[] + ImportedOrigin[]
  chromiumProfile.ts    locate profiles; read consistent Cookies/History snapshots; supported cookie decryption
  firefoxProfile.ts     locate profiles via profiles.ini; read cookies.sqlite/places.sqlite snapshots
  applyImport.ts        ImportedCookie[] → session.cookies.set, ImportedOrigin[] → DOMStorage via a GuestSession
  index.ts              barrel
src/shared/types/browserImport.ts        ImportedCookie, ImportSource, ImportResult (+ zod)
src/shared/ipc/schemas/browser.ts        `browser.list_import_sources`, `browser.import_data`
src/main/ipc/handlers/browser.ts         delegate to BrowserSessionService
src/renderer/components/BrowserImportDialog.tsx   shared by Browser settings and the browser import banner
```

```ts
export interface ImportedCookie {
  domain: string        // as stored, leading dot preserved
  name: string; value: string; path: string
  expires?: number      // unix seconds; absent = session cookie
  secure: boolean; httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'   // Electron's vocabulary
}
export interface ImportSource {
  id: string            // "chrome:Default", "firefox:abcd.default-release", "file"
  browser: 'chrome' | 'edge' | 'brave' | 'chromium' | 'vivaldi' | 'opera' | 'dia' | 'comet' | 'firefox' | 'file'
  profileName: string
  capabilities: Partial<Record<'cookies' | 'localStorage' | 'history', {
    supported: boolean
    reason?: 'app_bound_encryption' | 'locked' | 'keychain_denied' | 'unsupported_format'
  }>>
}
export interface ImportResult {
  categories: Partial<Record<'cookies' | 'localStorage' | 'history', {
    imported: number; skipped: number; failed: number
  }>>
  errors: string[]      // bounded, sanitized reasons; no cookie/storage values
}
```

IpcApi routes (`defineRoute`, same style as `webview.ts`):

| Route | Input | Output |
|---|---|---|
| `browser.list_import_sources` | `{}` | `ImportSource[]` — detected profiles for the current OS plus the `file` pseudo-source |
| `browser.import_data` | `{ sourceId: string, filePath?: string, categories: ('cookies' \| 'localStorage' \| 'history')[], domains?: string[] }` | `ImportResult` |

`domains` uses exact-domain or dot-boundary subdomain matching (`github.com` matches `.github.com`
and `api.github.com`, not `evilgithub.com`). Main resolves a detected source ID to its stored source
path; a file path must come through the app's user-selected file flow. Import targets only the ordinary
Agent browser profile; private, development-preview and artifact partitions never receive login data.

### 10.3 Readers

**Storage-state / Netscape** (`formats.ts`): pure parsers, no I/O. Netscape lines are
`domain \t includeSubdomains \t path \t secure \t expiry \t name \t value`; `#HttpOnly_` domain prefix
marks httpOnly. sameSite defaults to `unspecified`.

**Chromium family** (`chromiumProfile.ts`):

| OS | Profile root | Cookie file |
|---|---|---|
| macOS | `~/Library/Application Support/{Google/Chrome, Microsoft Edge, BraveSoftware/Brave-Browser, Chromium, Vivaldi, Dia/User Data, Comet}/<Profile>` | `<Profile>/Network/Cookies` (older builds: `<Profile>/Cookies`) |
| Windows | `%LOCALAPPDATA%\{Google\Chrome, Microsoft\Edge, BraveSoftware\Brave-Browser, Chromium}\User Data\<Profile>` | same |
| Linux | `~/.config/{google-chrome, microsoft-edge, BraveSoftware/Brave-Browser, chromium}/<Profile>` | same |

The current reader discovers `Default` and `Profile N` directories. Table `cookies`:
`host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, has_expires`.
`expires_utc` is microseconds since 1601-01-01: `unix = expires_utc / 1e6 − 11644473600`.
`samesite`: −1 → `unspecified`, 0 → `no_restriction`, 1 → `lax`, 2 → `strict`.

Decryption of `encrypted_value` (prefix `v10`; `v11` on Linux keyrings):

| OS | Key | Cipher |
|---|---|---|
| macOS | Keychain item "`<Browser> Safe Storage`" via `security find-generic-password -w -a "<Browser>" -s "<Browser> Safe Storage"` (the OS may request access) → `pbkdf2(password, 'saltysalt', 1003, 16, sha1)` | AES-128-CBC, IV = 16 spaces, PKCS7 |
| Linux | `v11`: libsecret / kwallet password, same PBKDF2 with 1 iteration; `v10`: literal `peanuts`, 1 iteration | same |
| Windows | `v10`: DPAPI-protected key in `Local State` → `os_crypt.encrypted_key`, unprotected with `CryptUnprotectData` via `powershell -c [Security.Cryptography.ProtectedData]::Unprotect` (Electron's `safeStorage` holds Cherry's key, not Chrome's) | AES-256-GCM, 12-byte nonce after the prefix, 16-byte tag |
| Windows, `v20` prefix | Chrome ≥ 127 app-bound encryption: the key is only released to Chrome's own elevated service | **not supported** → `reason: 'app_bound'`; sign in again in the built-in browser |

Cookie database `meta.version >= 24` requires a `SHA-256(host_key)` prefix (32 bytes). Verify the
exact stored host, including its leading dot, before stripping the prefix; a mismatch fails the item.
Older versions have no prefix. Preserve valid empty cookie values. Unknown metadata or encryption
formats never fall back to guessed plaintext.

**Firefox** (`firefoxProfile.ts`): `profiles.ini` → `Path` per profile (`Default=1` first); roots
`~/Library/Application Support/Firefox/Profiles`, `%APPDATA%\Mozilla\Firefox\Profiles`, `~/.mozilla/firefox`.
Table `moz_cookies`: `host, name, value, path, expiry, isSecure, isHttpOnly, sameSite`. Expiry is Unix
seconds before `user_version = 16`, milliseconds from version 16 onward
(0 → `no_restriction`, 1 → `lax`, 2 → `strict`). Values are plaintext.

These browser-specific layouts and crypto recipes are research notes, not a compatibility guarantee.
Before implementing each adapter, verify its actual browser version/schema and check existing library
support. History uses the source's visit records, not just each URL's last-visited summary.
Acquire consistent read-only snapshots under a registered `application.getPath()` temp namespace,
clean them in `finally`, and never log cookie/storage values. History application uses the production
data service and appended migrations described in §12.4; foreign-profile fixtures stay separate.

### 10.4 Apply

`applyImport.ts` maps each `ImportedCookie` to `session.fromPartition(partition).cookies.set({
url: (secure ? 'https://' : 'http://') + domain.replace(/^\./, '') + path, name, value, domain, path,
secure, httpOnly, expirationDate: expires, sameSite })`. Electron rejects `__Host-` / `__Secure-`
cookies that are not `secure` + https and cookies whose `domain` does not match `url`; those are
counted as `skipped` with the reason in `errors` (name and domain only). After the loop,
`session.cookies.flushStore()`.

`localStorage` entries (storage-state files only) use a temporary import-owned guest in the destination
profile and the official CDP `DOMStorage` commands. Validate the exact destination origin/storage key
before writing; do not assume `about:blank` or navigation to a site's favicon establishes that origin
(redirects can change it). Reject unsupported origin setup and report partial results. Register only
the required typed commands, suppress import-generated visits, and always release temporary guests.
Cookies/storage and SQLite visits cannot form one atomic transaction: report results per category.

### 10.5 UI

Browser settings owns the import dialog, history management and separate clearing controls (§12.5).
Show detected sources/profiles, selectable supported categories with reason text, a storage-state /
`cookies.txt` picker, a domain filter and per-category results. Explain which shared browser profile
receives login data. Strings belong under `settings.browser.*`, synced and translated through the
existing i18n workflow. Import itself is a one-shot IpcApi action, not a Preference or model tool.

### 10.6 D work packages — part of the integrated browser PR

| # | Commit | Files | Tests |
|---|---|---|---|
| D1 | `feat(browser-import): parse storage-state and Netscape cookie files` | `import/formats.ts`, `shared/types/browserImport.ts` | `formats.test.ts`: fixture files → cookies; `#HttpOnly_` prefix; malformed line skipped with an error entry; storage-state `origins` round-trip |
| D2 | `feat(browser-import): apply imported cookies and storage to a partition` | `import/applyImport.ts`, allow-list | `applyImport.test.ts` with a fake `session.cookies`: url composition for leading-dot domains, `__Host-` on http skipped and reported, session cookie has no `expirationDate`, `flushStore` called once |
| D3 | `feat(browser-import): read Chromium-family profiles` | `import/chromiumProfile.ts` | `chromiumProfile.test.ts`: sqlite fixture built in the test with the real `cookies` schema; `expires_utc` conversion; samesite map; `v10` decrypt against a fixture encrypted with password `test` and the documented KDF; SHA-256 prefix stripped; `v20` → `unsupported` without touching the keychain |
| D4 | `feat(browser-import): read Firefox profiles` | `import/firefoxProfile.ts` | `firefoxProfile.test.ts`: `profiles.ini` parsing incl. `Default=1`; `moz_cookies` fixture |
| D5 | `feat(browser-import): expose import routes and the settings dialog` | `ipc/schemas/browser.ts`, `ipc/handlers/browser.ts`, `BrowserImportDialog.tsx`, i18n | `schemas/__tests__` input validation; renderer test: sources render with reason text, file path submitted, result summary shown |
| D6 | `feat(browser-history): import external visits` | Chromium/Firefox visit readers and the history data service (§12.4) | source timestamps, WAL snapshot completeness, repeat-import deduplication, and history import when cookie decryption is unsupported |

Manual acceptance: import a user-selected supported profile or cookie file, open the site in the
existing right pane, and verify that a model snapshot observes the same signed-in page. Record tested
OS/browser versions; unsupported cookie decryption must still permit history import when supported.
Use disposable test accounts/fixtures and never include actual login values in acceptance artifacts.

Gotcha for the sqlite tests: `better-sqlite3` is rebuilt for Electron's ABI when the dev app runs,
which breaks bare `vitest run`; rebuild for Node before running D3/D4 tests.

## 11. Risks

- `DOMSnapshot.captureSnapshot` on very large pages can exceed 50 MB; the capture is bounded by the
  band filter only after the fact. Implemented in PR A: request `includeDOMRects` only, no text boxes,
  and drop the DOM snapshot entirely (interactivity from AX roles only) above 20 000 nodes.
- `Input.dispatchMouseEvent` on a hidden, unfocused window: Chromium still dispatches, but some
  pages check `document.hasFocus()`. PR B should add `Emulation.setFocusEmulationEnabled` when implementing
  this focus policy; PR A does not authorize it.
- Freezing via `Page.setWebLifecycleState` while a download is in progress cancels it: the sweep
  must skip sessions with `progressing` downloads in C4.
- `BrowserView` is deprecated but not removed in Electron 41; C5 is isolated so it can slip without
  blocking P0/P1.
- Cookie decryption depends on browser internals that change without notice (app-bound encryption
  on Windows, the SHA-256 value prefix). The readers fail closed to `unsupported` + the file path;
  the file import is the contract, profile reading is best effort.
- The current standalone MCP uses `persist:default`, shared by its clients. The integrated browser
  uses a dedicated ordinary profile (§12.2); imported login state is shared across its ordinary pages,
  not copied into legacy MCP, private or preview partitions. The import dialog explains this scope.

## 12. Existing Agent browser integration

**Status: implemented on `agent-browser-integration`, pending PR publication.** This product layer
is based on PR3 and combines this section with the supported import paths in §10.
Keep Electron 41.8.0. No new browser shell, visible multi-tab UI, WebMCP, upload tool, freeze/thaw,
full handoff protocol or `WebContentsView` migration is required to complete this scope.

### 12.1 Reuse and first vertical slice

Reuse `AgentBrowserRightPanel` in `AgentRightPane.tsx`, `WebviewBrowser`, `WebviewHost`, navigation,
search, annotations and the shared CDP engine. First prove that a snapshot and one click from an
Agent Session affect the very guest shown in its right pane; do this before history/import work.
Keep one visible browser page per Agent Session in this delivery.

Extend `BrowserSessionService` with a main-owned binding from Agent Session to the attached guest:
`{ agentId, sessionId, tabId, guest, windowId, abort }`. The guest determines its validated profile,
and each fresh opaque `tabId` is the binding generation. It changes when the UI replaces or resumes
the guest. Activity suspension revokes control while retaining the page as a history destination
until native guest destruction. History reopening uses the existing conversation navigation service
to focus the owning session before revealing and navigating its browser. This is runtime state,
not a SQLite record.
The owning app renderer registers/unregisters via typed IpcApi. Main validates the sender, guest's
host window, security profile and actual session ownership; renderer-supplied IDs alone grant nothing.
Only non-authoritative display summaries belong in Shared Cache.

The MCP instance receives trusted `agentId`/`sessionId` from the runtime and resolves the binding on
each call. Never accept a raw `webContentsId`, profile or owner from model arguments. Missing, stale
or foreign targets fail; do not fall back to another session or create a hidden MCP tab. Opening a
browser may request that the owning renderer reveal/mount its pane, then wait with cancellation and
a deadline for the verified binding. A headless/unavailable host returns an explicit unavailable result.

### 12.2 Ordinary browsing and profile boundaries

Add an ordinary-browsing security profile alongside `AgentDevPreview` and `AgentHtmlArtifact`, using
a dedicated persistent partition (`persist:agent-browser`). The settings import and
visible ordinary pages resolve the same partition centrally. Do not merge the existing preview,
artifact, MiniApp or legacy `persist:default` partitions, or silently migrate their data.

Ordinary pages share login state across Agent Sessions; control authority does not cross sessions.
Local preview URLs and explicitly opened HTML artifacts continue through their existing policies.
Mode changes replace the guest and invalidate its binding/refs, so an ordinary website cannot gain
artifact-file access by navigating to `file:`. Preserve sandboxing and annotation preload boundaries.
The current `WebviewBrowser` guest key includes the entry origin: ordinary cross-origin navigation
must preserve its guest, while changes of session or security mode must revoke the previous binding.

Ordinary HTTP(S) navigation permits public websites, LAN addresses and loopback, as explicitly
authorized for this delivery. It uses a separate policy from restricted local previews. URL validation
limits schemes and credentials; it is not an SSRF or DNS-rebinding boundary. Preview/file restrictions
remain scoped to their existing profiles.

### 12.3 Ownership, runtime mounting and tool behavior

The UI owns visible guests; the engine acquires them as `borrowed`, including annotation leases.
Disconnect releases only the caller's lease, and idle sweeps never close/freeze visible pages.
Guest destruction revokes the binding and cancels pending work. Returning to a session may attach a
new guest, but old refs/generations can never target it. Do not promise page persistence on pane
unmount: preserve the guest when merely hiding it; handle actual unmount through explicit revocation.

`GuestSession` currently gates Network/inspection, download observation, dialog timers and focus
emulation on `managed`. Separate the requested browser-observation lifetime from destruction ownership
so an authorized visible control lease can observe console/network/downloads without making the page
evictable. Annotation-only leases keep their current lightweight behavior. Do not copy hidden-page
focus emulation or automatic dialog dismissal to user-visible pages; reuse native dialog UI and
explicit `handle_dialog`. A remaining annotation lease must survive browser-controller disposal.

Extract the target lookup/page-host boundary currently embedded in `CdpBrowserController`; keep
actions and snapshots shared. The standalone host retains its existing behavior. The pane host
supports only its actual capabilities: `open` navigates/reveals its one page, `list_tabs` returns that
session's page, and explicit tab targets must match it. `newTab`/private-window requests and multi-tab
operations are rejected until supported, rather than silently opening hidden windows. Popup attempts
must be reported as unsupported; no fabricated `newTabId`. Closing/resetting the visible page requires
an explicit host operation, never direct destruction by borrowed-session disposal.

Mount the pane-backed MCP through `buildAgentMcpServers` and `resolveMountedMcpServers`, using the
shared path consumed by Claude Code, Pi and Dsh. Runtime connection signatures include effective
browser enablement so cached sessions refresh their tool surface. Preserve existing per-tool approval
rules; adding a first-party server must not wildcard auto-approve every browser action. When this
capability is mounted, exclude a duplicate bridge to the legacy `@cherry/browser` preset for that
session; do not alter the user's stored MCP configuration or unrelated clients.

The Browser setting controls Agent access, not the ability to browse manually. Default off until the
user enables it; follow agent tool restrictions as well. Turning it off immediately rejects new calls,
cancels queued work and releases control leases while preserving the visible page and login state.
Already-dispatched page effects cannot be undone; report interruption without replay. Enabling control
starts from a fresh observation of the current document. The skill toggle is not an authorization gate.

### 12.4 Persistent history and imported visits

Use SQLite + DataApi for visits, not a Cache history list or an IPC CRUD surface. Proposed visit fields
are `id`, sanitized `url`, bounded `title`, `visitedAt` and a source (`local` or imported browser/profile).
Imported visits retain a stable source identity for idempotency; repeat imports do not create duplicate
visits, and ordinary revisits remain distinct. Index time and the chosen pagination/search access path.
Add schemas under `src/main/data/db/schemas/`, generate an appended migration, and test migrate-forward
against populated production tables. Do not rewrite shipped migrations or hand-edit generated schemas.

Record committed main-frame navigation for bound ordinary browser guests, regardless of whether user
or model initiated it. Handle same-document URL changes; deduplicate overlapping Electron notifications
for a single visit. Skip failed/aborted loads, redirect intermediates, subframes, `about:blank`, local
previews, HTML artifacts, private guests and import helper pages. Late title changes update the visit
for that document only. Do not store URL credentials or data URLs; review query/fragment redaction
before persistence, rather than relying only on MCP-output sanitization.

Provide paginated search by URL/title, reopen in a regular browser tab, delete and
clear. History is user-facing browser data, not a new model history-search tool. Domain imports apply
the same URL/title normalization and use synchronous, bounded DB transactions through the data service.
Cookie/storage import stays an IpcApi command because it affects Electron state; its history portion
delegates to that same data service. Per-category results describe partial completion truthfully.

### 12.5 Browser settings and bundled skill

Add a Browser settings entry with Agent control, history management, data import and separate actions
for clearing history versus cookies/site storage/cache. Clearing history must not log the user out;
site-data clearing must explain and apply the shared ordinary-profile scope. Persistent toggles use
Preference (edit classification sources and regenerate), runtime bindings use main-owned resources,
and commands use IpcApi. Build UI with existing Shadcn/Tailwind components and translated strings.

Keep the settings landing page to one Agent-control toggle and three management rows: import,
history and clearing. Open each task in a focused dialog. Import discovers browsers on entry,
selects the first detected source, and shows a profile selector only when that browser has multiple
profiles. Default to readable history and website data; Chromium sources explain that the system
may request key-store access and some sign-ins may need to be repeated. Keep category choices under a disclosure, combine cookies and
localStorage as website data, and offer file import as a secondary path. The UI imports all domains;
the lower-level importer retains domain filtering for callers that need it. File-picker cancellation
returns to the form; partial results never claim complete success.

History loads only when opened and reopens pages in new browser tabs without requiring an Agent
conversation or pane. These tabs share the ordinary browser partition with Agent panes; history
tracking follows webContents lifetime independently of Agent bindings. Ordinary browser address bars
show recent visits on focus and search titles/URLs while typing, with debounced queries and up to eight
unique URL suggestions. Arrow keys and Enter select a result; Escape dismisses suggestions. Direct URL
submission remains available. Preview and artifact surfaces do not expose ordinary browser history. Clearing uses one confirmation dialog with independently
selectable history, website data and cache; only cache is selected initially. After partial failure,
uncheck completed categories so retry affects only the remaining selection.

Add `resources/skills/cherry-browser/SKILL.md` through the existing built-in skill installer; update
`cherry-tool-guide/SKILL.md` and its `references/web.md` to route interaction to it. Keep the skill
focused on live tool discovery, observe → act → verify, explicit page identity, stale-ref recovery,
dialogs and login, untrusted page content, and no automatic replay of uncertain effects. Explain that
imports/history management are user settings, and that the visible host may expose fewer tools than
the standalone MCP. No separate installer, bundled automation runtime or duplicated tool schemas.

### 12.6 Commit order and acceptance

| Step | Implementation boundary | Contract to verify |
|---|---|---|
| 1. Bind the existing pane | BrowserSessionService, browser IpcApi, AgentRightPane/WebviewHost | Session A can snapshot/click its visible page; forged, destroyed and session B targets fail |
| 2. Mount shared tools | runtime server resolution/signatures, MCP target lookup, GuestSession observation | Same page for user, annotations and model; no duplicate MCP; disconnect preserves page/annotation lease; observation works on borrowed guests |
| 3. Add ordinary mode | shared security profile, main navigation policy, WebviewBrowser identity | Cross-origin browsing keeps the guest; mode/session replacement invalidates refs; preview/artifact restrictions hold; restart retains ordinary login |
| 4. Persist visits | data schemas/migration/service/DataApi and owned navigation listeners | Recorded visits survive restart; main-frame deduplication, source timestamps, search/delete/clear and exclusions hold |
| 5. Import data | §10 readers/apply/IpcApi and Browser settings | Same visible page sees imported login; history available in UI; repeat import, unsupported cookies, partial failures and temp cleanup |
| 6. Expose the feature | preference, settings UI, skill and guide routing | Skill is installed/discoverable, missing tools are explained, control-off blocks model calls while manual browsing remains usable |

Keep these as focused commits in one product PR. Start with the same-page slice; a skill draft may
be authored early, but its end-to-end acceptance requires real mounted tools. Run the affected main,
runtime, database, shared and renderer tests plus `pnpm lint`, `pnpm test:lint` and `pnpm docs:check`.
Use the unified mocks and `setupTestDatabase()` for production history tests. Run Electron acceptance
on the existing version: same-page interaction, session switching, annotation concurrency, disconnect,
toggle-off during a pending call, login persistence/import, history after restart and clearing scope.
Record evidence and untested OS/profile combinations. Full `pnpm test` / `pnpm build:check` remain
intentionally excluded under this workspace's local validation override.


### 12.7 Delivered import support and validation

The implementation discovers standard Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Firefox profile directories on the
current platform. Profile history uses SQLite's online backup API, including committed WAL data,
and bounded 500-visit transactions. Source databases are opened read-only and private temporary
snapshots are removed on success, failure and cancellation. Search uses literal URL/title matching
with a time/id pagination index; it does not add an FTS engine.

| Source | History | Login state |
|---|---|---|
| Chrome / Edge / Brave / Vivaldi / Opera / Chromium standard profiles; Dia on macOS and Comet on macOS/Windows | Visit timestamps and stable source-key deduplication | Plaintext cookies and the encrypted formats below; partitioned cookies are skipped |
| Firefox standard profiles | Places visit timestamps and stable source-key deduplication | Ordinary cookies; container/partitioned origin attributes are skipped |
| JSON storage state | Not supported | Cookies and selected origins' localStorage; partitioned cookies are skipped |
| Netscape cookies file | Not supported | Host-only/domain scope, secure/HTTP-only flags and expiry preserved |

The importer implements these platform adapters without upgrading Electron:

| Platform | Supported encryption | System access |
|---|---|---|
| macOS | `v10` AES-128-CBC, PBKDF2-SHA1 with 1003 iterations | Browser-specific Safe Storage account/service through `security`; access denial is reported |
| Windows | `v10` AES-256-GCM using the DPAPI-wrapped Local State key; legacy DPAPI blobs | Current-user `ProtectedData.Unprotect` through PowerShell; ciphertext goes through stdin, never command arguments |
| Linux | `v10` with Chromium's `peanuts` key; `v11` AES-128-CBC with a system key | `secret-tool` (libsecret-tools), or KWallet 5/6 via `dbus-send` and `kwallet-query`; the configured network wallet is queried |

Linux selects the desktop's key store first and tries the other if no key is available. An explicit
access denial stops lookup. Browser-specific Secret Service application attributes and KWallet
folder/item names are fixed in `browserCookieKey.ts`; users do not configure encryption backends.
Missing helpers, unavailable keys and denied access are separate result reasons. Profiles created
under a different desktop, custom password-store override or browser variant may still require login.
Windows `v20` app-bound encryption is deliberately unsupported: no elevation, process injection or
changes to the source browser's security policy. The result asks the user to sign in in the pane.

`ChromiumCookieDecryptor` belongs to one import operation. Key retrieval is lazy and successful or
failed lookups are cached for that operation; owned password/key buffers are erased when finished.
No keys are persisted by Cherry. Helpers have a 30-second timeout, bounded output, cancellation and
exit tracking. Raw helper errors/output never cross IPC or enter logs. Filtering and expiry checks
precede key access; skipped items yield every 500 rows. Database metadata controls host-hash checking.
Cancellation preserves applied data and still closes helpers and removes snapshots.

A failed or unsupported cookie category does not block history. Passwords, extensions, browser settings,
bookmarks, IndexedDB and sessionStorage are outside this delivery. LocalStorage import uses a
short-lived sandboxed guest with page JavaScript disabled, verifies the final origin, writes via
CDP DOMStorage and closes the guest. It never binds the helper to an Agent or records its visits.
Reload guidance appears only after website data was applied. Category counts and typed reason counts
describe imported, expired, partitioned, unsupported, unavailable and failed entries;
cancellation preserves committed changes and reports available partial counts.

Validation uses synthetic browser databases, cookies and a local fixture website. The Electron 41.8.0
acceptance verifies same-guest snapshot/click, native input readback, cross-origin guest retention,
storage-state cookies/localStorage visible in the pane, and control-off cancellation while an
annotation lease stays alive. Restart preserves imported login/storage, history and existing Agent
rows. Cache clearing retains history/login; site-data clearing signs out the fixture while retaining
history. No live personal browser credentials were imported. Windows/Linux
native key-store interactions and profile discovery have not been exercised on this macOS host.
Focused tests cover independent CBC/GCM known answers, Linux v10/v11, host binding, empty values,
key refusal, helper cancellation/exit, DPAPI stdin framing, source preservation and Firefox expiry.
A synthetic native DPAPI round-trip test runs only on Windows. These tests do not prove every
installed browser/OS combination; unsupported input is reported without claiming complete migration.

Dia and Comet retain separate browser/source IDs even when their profile names are identical to
Chrome's. Chromium profile choices use the display name and available account identifier from
`Local State` → `profile.info_cache`; missing or malformed metadata falls back to the directory name.
Identical labels include the profile directory to distinguish them. Source IDs remain directory-based
so renaming a profile does not break selection or history deduplication. Dia reads `~/Library/Application Support/Dia/User Data`; Comet reads
`~/Library/Application Support/Comet` on macOS and `%LOCALAPPDATA%/Perplexity/Comet/User Data` on
Windows. macOS uses `Dia Safe Storage` / account `Dia` and `Comet Safe Storage` / account `Comet`;
Windows reads Comet's own `Local State` for DPAPI keys. No Chrome-key fallback is attempted.
Dia Windows and both Linux sources are not advertised until native layouts and key storage are verified.
The macOS catalog agrees with [SweetCookieKit's browser metadata](https://github.com/steipete/SweetCookieKit/blob/main/Sources/SweetCookieKit/BrowserCatalog.swift).
Comet's installed macOS bundle and profile layout were inspected without reading cookie values or keys.
Synthetic tests cover source separation, history import, per-browser Keychain selection and Windows key
selection; native Dia import and Windows Comet import have not been exercised on this Mac.

Vivaldi, Opera and Chromium use separate source identities on macOS, Windows and Linux, with the
same profile display-name/account presentation. Opera discovery checks both its root-level data
(`opera:root`) and `Default`/`Profile N` subdirectories; arbitrary cache directories are not profiles.
Windows Opera uses `%APPDATA%/Opera Software/Opera Stable`, while Vivaldi and Chromium use their
respective `%LOCALAPPDATA%/<browser>/User Data` directories. Linux uses the XDG config directory.
macOS key names are Vivaldi, Opera and Chromium; Linux Vivaldi uses Chrome/chrome and Opera uses
Chromium/chromium for KWallet/Secret Service. These native layouts and key identities agree with
[yt-dlp's browser settings](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/cookies.py) and
[browser_cookie3's adapters](https://github.com/borisbabic/browser_cookie3/blob/master/browser_cookie3/__init__.py).
Tests use synthetic profiles and key helpers; these three browsers are not installed on the validation
Mac. Arc is intentionally excluded. Custom, portable, Snap and Flatpak profile roots remain outside
automatic discovery; portable file import is still available.

Format references: [Chromium macOS OSCrypt](https://raw.githubusercontent.com/chromium/chromium/131.0.6778.85/components/os_crypt/sync/os_crypt_mac.mm),
[Linux OSCrypt](https://raw.githubusercontent.com/chromium/chromium/131.0.6778.85/components/os_crypt/sync/os_crypt_linux.cc),
[Windows OSCrypt](https://raw.githubusercontent.com/chromium/chromium/131.0.6778.85/components/os_crypt/sync/os_crypt_win.cc),
[Chrome app-bound encryption](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html),
[KWallet query](https://github.com/KDE/kwallet/tree/master/src/runtime/kwallet-query) and
[Firefox expiry migration](https://github.com/mozilla-firefox/firefox/commit/5869af852cd20425165837f6c2d9971f3efba83d).


## 13. Browser feature settings

Browser is an Agent built-in capability rather than a selectable third-party MCP server. Its per-Agent
group switch uses the existing `disabledTools` opt-out (`mcp__browser`). The runtime excludes legacy
in-memory browser bindings from the Agent MCP set, including when browser control is off.

Browser settings owns `app.browser.tool_permissions`: each visible-host tool can ask, allow or deny.
The default is ask; Full Access skips approval but does not enable disabled tools. Existing runtime approval UIs present requests in other modes. Claude
and Pi re-evaluate approval at call time. DSH’s host guard tightens approval live; relaxing to allow is
included in its next connection snapshot. Tool dispatch also rechecks denied tools and the Agent switch
before queued work executes. Disabling Agent control leaves manual browsing available.

`app.browser.open_links_in_browser` defaults false. When enabled, ordinary HTTP(S) clicks in Agent
message links open the current session's right browser pane through the message action provider;
other website links open `/app/browser` tabs through main-window navigation, sharing the browser profile and history. Shell link
IPC, host-window link interception, app menu links and external mini-app popups use that policy. Explicit
external-browser buttons use a separate IPC command; OAuth authorization and non-HTTP schemes retain
their existing handling.

Standalone browser tabs synchronize page titles and favicons from Electron WebView events into the
tab model. Main-frame document navigation clears the previous site's icon; missing or failed favicon
images fall back to a globe. Subframe navigation does not change the tab metadata.
Address bars show `host / page title` (including non-default ports) while unfocused, falling back to
the host when no title is available. Focusing reveals and selects the complete URL. Blur or Escape
discards unsubmitted edits and restores the compact display. Page title events keep this display current.


Ordinary WebView popup policy is installed once by `BrowserSessionService` at guest creation,
including guests in detached windows. HTTP(S) GET links with `target="_blank"` or `window.open`
navigate the owning Agent pane in place, or open an internal browser tab for standalone guests.
The global external-link preference does not redirect links originating inside the browser.
Agent bindings supply ownership without replacing the native handler; manual browsing remains
available after control is disabled or detached. POST popups, unsupported URL schemes and isolated
preview/artifact popups remain blocked. Service shutdown replaces the routing with deny-only cleanup.

Main-renderer readiness is revoked only for main-document navigation, renderer crashes and window
destruction. Child-frame/WebView loading and same-document navigation keep the existing IPC receivers
ready, so browser tabs and protocol requests do not remain queued behind an unrelated page load.

## 14. MiniApp and Browser infrastructure boundary

PR7 (`webview-shared-host`, based on `agent-browser-integration`) consolidates the renderer
guest host and navigation state. Both products compose `WebviewHost`; MiniApp retains a
`WebviewContainer` adapter for runtime preparation and product callbacks.

| Layer | MiniApp | Browser | Current relationship |
|---|---|---|---|
| Guest host | [WebviewContainer](../../../src/renderer/components/MiniApp/WebviewContainer.tsx) | [WebviewHost](../../../src/renderer/components/WebviewHost.tsx), composed by `WebviewBrowser` | Shared element creation, event cleanup, focus/keyboard forwarding and preference application |
| Navigation toolbar | `MinimalToolbar` | `WebviewNavigation` | Separate product controls; shared `useWebviewNavigation` for guest-bound navigation and address drafts |
| Page lifetime | `MiniAppTabsPool` owns keep-alive and split-pane placement | Browser tab or Agent pane owns the guest | Separate product ownership |
| Page search | `WebviewSearch` | `WebviewSearch` | Shared |
| Annotation controls | Hidden | `WebviewAnnotationControls` in Agent panes only; hidden in standalone tabs | Requires a conversation receiver (`onAnnotationSaved`) |
| Annotation accessibility capture | [annotationExport](../../../src/main/services/webview/annotationExport.ts) borrows a guest lease | `BrowserSessionService` / `GuestSession` | Shared debugger ownership and capture engine |
| Runtime and security | `MiniAppRuntimeService`, app preparation and MiniApp host policies | Browser session/control and profile policies | Separate authorities; sharing capture does not grant Agent control over MiniApps |

Storage remains isolated:

| Surface | Electron partition |
|---|---|
| Ordinary Browser tabs and Agent browser panes | `persist:agent-browser` |
| Website MiniApps (`kind: site`) | `persist:webview` |
| Local MiniApps (`kind: app`) | `persist:miniapp:${appid}` |

Browser imports write website data to the ordinary Browser partition. Browser history tracking and
the import banner also target ordinary Browser pages. They do not automatically apply to MiniApps,
and importing a login into Browser does not log the user into a MiniApp.

The shared host accepts an explicit partition selected by its consumer. Browser maps its security
profile at the composition boundary; MiniApp supplies its existing website or per-app partition.
Main remains the authority for guest attachment, preload and permissions. Omitting
`openLinksExternal` leaves the runtime popup policy untouched, so local MiniApps never install the
ordinary website popup handler.

Host event subscriptions follow the concrete guest, while React Effect Events read current
callbacks without replaying readiness on preference or callback changes. The MiniApp adapter waits
for runtime preparation and remounts that preparation state when app identity changes. Its loaded
callback timer is cancelled on a new full navigation or eviction. The pool still owns placement,
keep-alive, visibility reporting and focused-pane context.

`useWebviewNavigation` binds navigation state to the concrete guest and revision. It shares back /
forward state, main-frame URL tracking and address draft preservation across both toolbars. Guest
replacement removes listeners and pending updates before subscribing to the new guest; no polling
is required. URL validation, navigation submission, history suggestions and product actions remain
with the respective toolbar.

Acceptance covers both consumers: switching tabs and split layouts preserves the intended guest,
listeners do not duplicate, late events from retired guests cannot overwrite the current toolbar,
local apps wait for runtime preparation, and profile/permission isolation remains intact. Website
MiniApp login sharing is a separate product decision; this refactor does not change partitions or
migrate cookies/storage. Ordered batch actions and a generic Chat/Agent side pane remain outside PR7.

PR7 validation: 91 focused renderer tests cover the host, both toolbars, Browser, MiniApp
preparation, pool retention/split behavior and guest replacement. An isolated Electron 41.8.0
component harness exercised real website MiniApp and Browser guests: address navigation/back,
layout toggles without guest replacement, separate localStorage, preference updates without
readiness replay, and one trusted keyboard relay. Local packaged-app preparation and popup
policy preservation are covered by component tests; the native packaged-app path was not rerun.
The temporary runtime was closed after both guests were released. The full test suite is
intentionally skipped under the local validation override.
