# Browser Use — Implementation Plan

Turns [`browser-use-design.md`](./browser-use-design.md) (P0 + P1 of its roadmap) into files,
APIs, commits and tests. P2 (frames, vision, extract) and P3 (drive the visible pane, handoff)
are out of scope here; they build on the same engine and get their own plan once P1 has shipped.

Read the design doc first. This document does not repeat the rationale; it fixes the decisions.

## Delivery status

PR1 / PR A is implemented in [#20128](https://github.com/CherryHQ/cherry-studio/pull/20128)
(`browser-use-engine`, implementation commit `83fcf4b259`). It remains open. The documentation and
engine are in the same PR; there is no separate documentation prerequisite PR.

| Layer | Base | Status and scope |
|---|---|---|
| PR1 / A — `browser-use-engine` | `webview-agent-pane-browser` | Implemented: shared session ownership, snapshot/ref engine, annotation migration |
| PR2 / B — `browser-use-mcp` | `browser-use-engine` | Implemented on this branch: MCP migration, snapshot/action tools, dialog/download results |
| PR C | PR B | Planned: inspection, ref recovery, WebMCP, retained-tab freezing, WebContentsView |
| PR D | PR A | Planned independent branch: browser-data import (§10) |

PR B is implemented on `browser-use-mcp`; its publication is separate from #20128.
Sections below distinguish delivered PR A/B contracts from planned PR C/D work. `upload_file`
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
| WebMCP polyfill | Installed via `Page.addScriptToEvaluateOnNewDocument`, **not** via preload | Hidden MCP tabs have `preload: ''`; one mechanism covers both hidden tabs and `<webview>` guests. Preload injection stays a P3 option for guests the engine attaches to lazily |
| CDP surface | Explicit allow-list in `cdpAllowList.ts`; `GuestSession.send()` rejects anything else | Reviewable security boundary; `execute` stays the escape hatch |
| Session ownership | Registry keyed by `webContents.id`; every session is `managed` (engine-created hidden tab) or `borrowed` (someone else's page, debugger only); owners acquire/release; retention marks per managed tab | Per-connection controllers are the leak |
| Existing tools | `open`, `execute`, `screenshot`, `list_tabs`, `switch_tab`, `close_tab`, `reset` keep their names and input schemas; `snapshot` keeps its name but changes output | No prompt churn for the tools that already work |

## 2. Module layout

Layout through PR B, with PR C additions marked by their later commit groups. PR A contains
the service, main-only contracts, session and snapshot modules; PR B adds `actions/` and `mcp/`.
The WebMCP script, inspection tools and retained-tab freezing remain planned.

```
src/main/features/browser/browserUse.ts     main-only ref / snapshot / ownership / command types + zod schemas
src/main/features/browser/webMcpPolyfill.ts  planned injected `navigator.modelContext` script (string)

src/main/features/browser/
  index.ts                                  barrel: BrowserSessionService, GuestSession, types
  BrowserSessionService.ts                  lifecycle service: registry, budget, sweep timer, createMcpServer()
  session/
    GuestSession.ts                         one per webContents: debugger, refs, dialog, downloads, retention
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
| `find` | `{ role?: string, name?: string, tabId?, privateMode? }` | `Accessibility.queryAXTree`; returns refs |
| `console_messages` | `{ tabId?, privateMode?, level?: 'error'\|'warning'\|'all', clear?: boolean }` | ring buffer of 200 per tab |
| `network_requests` | `{ tabId?, privateMode?, clear?: boolean }` | ring buffer of 200 per tab: method, url, status, type |
| `list_web_tools` | `{ tabId?, privateMode? }` | WebMCP tools the page registered |
| `call_web_tool` | `{ name, args: unknown, tabId?, privateMode? }` | |
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
changes, PR B will use one `owner` value per MCP server instance (`mcp:<uuid>`) and call `endTurn` only when
that server closes. Consequently `temporary` means "reclaimed by idle timeout or budget", not "closed
at turn end". Real turn scoping needs an upstream change first: the agent runtime passes the session id
into MCP tool calls and emits a turn-ended event (the natural hook is
`AgentSessionRuntimeService.handleAutonomousGenerationFinished`). That is a separate decision and PR;
C4 does not pretend to deliver it. PR A exposes `endTurn` but has no MCP/runtime caller yet.

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
sweep, and — when P3 shows sessions in the UI — a Shared-cache projection
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

PR B adds download tracking and the Network events needed for settling. PR C adds console/network
buffers, `freeze`/`thaw`, and `listWebTools`/`callWebTool` with the new-document polyfill. These are
not PR A APIs. Download events must be attributed to their originating guest on the shared Electron
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

`resolveRef` → `DOM.scrollIntoViewIfNeeded({ backendNodeId })` → `DOM.getContentQuads` → centre of the largest quad → `DOM.getNodeForLocation({ x, y, includeUserAgentShadowDOM: true })`. If the hit node is the target or one of its descendants: `{ x, y, occluded: false }`. Otherwise `{ x, y, occluded: true }`; mouse actions then use the JS fallback (`DOM.resolveNode` → `Runtime.callFunctionOn(function(){ this.click() })`) and report `occluded` in the result so the model knows the click was synthetic.

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

### 5.7 WebMCP polyfill (`src/main/features/browser/webMcpPolyfill.ts`)

Main-world script, idempotent, installs `navigator.modelContext` when absent:
`registerTool({ name, description, inputSchema, execute })`, `unregisterTool(name)`, `provideContext({ tools })`, and a private `__cherryModelContext = { list(): descriptors, call(name, args): Promise }`. The engine reads the list with `Runtime.evaluate('__cherryModelContext.list()')` and calls with `Runtime.evaluate(…, { awaitPromise: true, timeout })`. Tool descriptions are page data and go out with the untrusted-data notice. When Electron 43 lands, `list()` is served by the native `WebMCP` CDP domain and the script becomes a fallback.

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
on A; C builds on B. PR D branches from A independently (§10). Future commit groups below are
planning units, not a claim that those commits or APIs already exist.

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

- 152 focused tests passed across 13 files covering the browser engine/actions, MCP adapter/factory,
  MCP runtime lifecycle and webview annotation integration.
- `pnpm lint` and `pnpm docs:check` passed. The full test suite was intentionally skipped under
  the workspace's local validation override.
- A real Electron instance and MCP SDK transport passed 29 interaction steps using
  `tests/fixtures/browser-use/interaction.html`: snapshot/diff, form and email input, selection,
  mouse/keyboard/scroll, screenshot, download completion, covered-click fallback, fetch settling,
  dialog interruption/resolution, submit navigation, stale refs, history/wait, popup readiness and
  background-tab snapshots. Synthetic protocol and download handlers existed only in the smoke harness.

### PR C — `feat(browser-mcp): P1 stability, inspection and WebMCP`

| # | Commit | Files | Tests |
|---|---|---|---|
| C1 | `feat(browser-mcp): recover re-rendered refs by role and name` | `GuestSession.resolveRef` fallback via `Accessibility.queryAXTree`, only when the ref's `documentId` equals the current one and its `backendNodeId` no longer resolves (SPA re-render); cross-document refs stay `stale_ref` | `GuestSession.test.ts`: same-document re-render recovers, cross-document with an identical role+name does not |
| C2 | `feat(browser-mcp): add find, console_messages and network_requests` | `tools/inspect.ts`, ring buffers in `GuestSession` | `inspect.test.ts` |
| C3 | `feat(browser-mcp): inject the WebMCP polyfill and expose page tools` | `features/browser/webMcpPolyfill.ts`, `tools/webMcp.ts` | `webMcpPolyfill.test.ts` (jsdom), `webMcp.test.ts` |
| C4 | `feat(browser-session): expose retention marks and freeze retained tabs` | Extend PR A's existing sweep with freeze/thaw + `mark_tab` tool; retention marks change eviction order and freeze eligibility only, no turn scoping (§4 "Turn boundary") | `BrowserSessionService.test.ts` freeze/evict cases |
| C5 | `refactor(browser-mcp): replace BrowserView tabs with WebContentsView` | `controller.ts`, `types.ts`, `tabbarHtml.ts` | existing controller tests; manual (§9) |

Deferred (tracked as follow-ups, not in these PRs): the upstream turn signal (agent session id on
MCP tool calls + a turn-ended event, §4 "Turn boundary") without which `temporary` cannot mean
per-turn; trusted runtime workdir context and `upload_file`; per-origin CDP policy; the `<webview>` pane as an engine target (P3).

## 8. Automated test plan

PR A/B results are recorded in §7. The following checklist also includes future coverage;
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
| `webmcp.html` — registers one tool via `navigator.modelContext` | polyfill |

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

### 8.4 Main-only contracts and jsdom

- `snapshot.test.ts`: engine ref/options schemas (PR A); adapter input schemas added in PR B.
- `webMcpPolyfill.test.ts` with `// @vitest-environment jsdom`: evaluating the script twice keeps one registry; `registerTool` + `__cherryModelContext.list()` round-trips descriptors; `call` rejects for an unknown name and propagates the tool's promise.

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
| 9 | Acquire a borrowed engine session for the annotation guest, export annotations while that session is held, then release it | export contains the AX path and does not detach the other owner; the hidden MCP tab and visible pane remain different guests until P3 |
| 10 | Open 5 tabs, wait 5 min | only marked tabs survive; `app.getAppMetrics()` logged before/after shows the freed renderer processes |
| 11 | `webmcp.html`: `list_web_tools`, `call_web_tool` | the page's tool is listed with the untrusted-data notice and returns its value |
| 12 | Perf: `open https://github.com/CherryHQ/cherry-studio/pulls`, `snapshot` ×3 | logged capture + serialise time < 1 s each, output ≤ 40 000 chars, diff #2 and #3 < 2 000 chars |

Record the numbers of #10 and #12 in the PR description; they are the acceptance criteria for the
session-management commit.

## 10. Importing external browser data

Browser use is only useful on sites the user is already signed in to. The hidden MCP tabs use
`persist:default`, which starts empty, so the user needs a way to bring login state over from
the browser they actually use. This is a **user action** (credentials move), never a tool the
model can call.

### 10.1 Scope

| Data | Import | Why |
|---|---|---|
| Cookies | yes | login state; what every site checks |
| `localStorage` per origin | yes, from storage-state files only | SPA tokens (JWT in `localStorage`) — not readable from browser profiles without the browser's own LevelDB, so file import only |
| Bookmarks | no (deferred) | Chrome `Bookmarks` is plain JSON and trivial to read, but no tool consumes it yet |
| History | no | same, plus privacy cost with no consumer |
| Passwords | never | Chrome `Login Data` / Firefox `key4.db`; an agent must not hold the user's password store |

Two import paths, in order of preference:

1. **Storage-state file** (portable, no decryption): Playwright `storageState` JSON
   (`{ cookies: [{ name, value, domain, path, expires, httpOnly, secure, sameSite }], origins: [{ origin, localStorage: [{ name, value }] }] }`)
   and Netscape `cookies.txt` (what curl, yt-dlp and the "Get cookies.txt" extensions emit). Works on every
   OS and every browser, including ones we cannot decrypt.
2. **Profile read** from a detected installed browser: Chromium family (Chrome, Edge, Brave, Chromium,
   Arc) and Firefox. Copy the cookie database to a temp path first (the live file is locked while the
   browser runs on Windows), open it read-only with the already installed `better-sqlite3`, decrypt
   where needed, apply.

### 10.2 Module layout and API

```
src/main/features/browser/import/
  formats.ts            parseStorageState(json) / parseNetscape(text) → ImportedCookie[] + ImportedOrigin[]
  chromiumProfile.ts    locate profiles, copy + read `Cookies`, decrypt `encrypted_value`
  firefoxProfile.ts     locate profiles via profiles.ini, read `cookies.sqlite`
  applyImport.ts        ImportedCookie[] → session.cookies.set, ImportedOrigin[] → DOMStorage via a GuestSession
  index.ts              barrel
src/shared/types/browserImport.ts        ImportedCookie, ImportSource, ImportResult (+ zod)
src/shared/ipc/schemas/browser.ts        `browser.list_import_sources`, `browser.import_data`
src/main/ipc/handlers/browser.ts         delegate to BrowserSessionService
src/renderer/pages/settings/McpSettings/BrowserImportDialog.tsx   entry from the `@cherry/browser` card in BuiltinMcpServerList
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
  browser: 'chrome' | 'edge' | 'brave' | 'chromium' | 'arc' | 'firefox' | 'file'
  profileName: string
  path: string
  supported: boolean    // false with `reason` when we know decryption cannot work (§10.4)
  reason?: 'app_bound_encryption' | 'locked' | 'keychain_denied'
}
export interface ImportResult { imported: number; skipped: number; origins: number; errors: string[] }
```

IpcApi routes (`defineRoute`, same style as `webview.ts`):

| Route | Input | Output |
|---|---|---|
| `browser.list_import_sources` | `{}` | `ImportSource[]` — detected profiles for the current OS plus the `file` pseudo-source |
| `browser.import_data` | `{ sourceId: string, filePath?: string, domains?: string[], partition?: 'persist:default' }` | `ImportResult` |

`domains` filters by suffix match (`github.com` matches `.github.com` and `api.github.com`); the
dialog offers "all" or a pasted list. Target partition is `persist:default` only; private mode never
receives imports and the annotation/agent-pane partitions are not targets until P3 decides they should be.

### 10.3 Readers

**Storage-state / Netscape** (`formats.ts`): pure parsers, no I/O. Netscape lines are
`domain \t includeSubdomains \t path \t secure \t expiry \t name \t value`; `#HttpOnly_` domain prefix
marks httpOnly. sameSite defaults to `unspecified`.

**Chromium family** (`chromiumProfile.ts`):

| OS | Profile root | Cookie file |
|---|---|---|
| macOS | `~/Library/Application Support/{Google/Chrome, Microsoft Edge, BraveSoftware/Brave-Browser, Chromium, Arc/User Data}/<Profile>` | `<Profile>/Network/Cookies` (older builds: `<Profile>/Cookies`) |
| Windows | `%LOCALAPPDATA%\{Google\Chrome, Microsoft\Edge, BraveSoftware\Brave-Browser, Chromium}\User Data\<Profile>` | same |
| Linux | `~/.config/{google-chrome, microsoft-edge, BraveSoftware/Brave-Browser, chromium}/<Profile>` | same |

Profiles come from `Local State` → `profile.info_cache` (name per directory). Table `cookies`:
`host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, has_expires`.
`expires_utc` is microseconds since 1601-01-01: `unix = expires_utc / 1e6 − 11644473600`.
`samesite`: −1 → `unspecified`, 0 → `no_restriction`, 1 → `lax`, 2 → `strict`.

Decryption of `encrypted_value` (prefix `v10`; `v11` on Linux keyrings):

| OS | Key | Cipher |
|---|---|---|
| macOS | Keychain item "`<Browser> Safe Storage`" via `security find-generic-password -w -s "<Browser> Safe Storage"` (the OS prompts the user, naming the browser) → `pbkdf2(password, 'saltysalt', 1003, 16, sha1)` | AES-128-CBC, IV = 16 spaces, PKCS7 |
| Linux | `v11`: libsecret / kwallet password, same PBKDF2 with 1 iteration; `v10`: literal `peanuts`, 1 iteration | same |
| Windows | `v10`: DPAPI-protected key in `Local State` → `os_crypt.encrypted_key`, unprotected with `CryptUnprotectData` via `powershell -c [Security.Cryptography.ProtectedData]::Unprotect` (Electron's `safeStorage` holds Cherry's key, not Chrome's) | AES-256-GCM, 12-byte nonce after the prefix, 16-byte tag |
| Windows, `v20` prefix | Chrome ≥ 127 app-bound encryption: the key is only released to Chrome's own elevated service | **not supported** → `reason: 'app_bound_encryption'`, the dialog points to the file path |

Recent Chrome builds prepend `SHA-256(host_key)` (32 bytes) to the plaintext value; strip it when the
first 32 bytes equal that hash. Cookies with an empty decrypted value are skipped and counted.

**Firefox** (`firefoxProfile.ts`): `profiles.ini` → `Path` per profile (`Default=1` first); roots
`~/Library/Application Support/Firefox/Profiles`, `%APPDATA%\Mozilla\Firefox\Profiles`, `~/.mozilla/firefox`.
Table `moz_cookies`: `host, name, value, path, expiry (unix seconds), isSecure, isHttpOnly, sameSite`
(0 → `no_restriction`, 1 → `lax`, 2 → `strict`). Values are plaintext.

Every reader copies the database file to `application.getPath(<temp namespace>)` before opening
(`readonly: true, fileMustExist: true`), deletes the copy in `finally`, and never logs a cookie value.

### 10.4 Apply

`applyImport.ts` maps each `ImportedCookie` to `session.fromPartition(partition).cookies.set({
url: (secure ? 'https://' : 'http://') + domain.replace(/^\./, '') + path, name, value, domain, path,
secure, httpOnly, expirationDate: expires, sameSite })`. Electron rejects `__Host-` / `__Secure-`
cookies that are not `secure` + https and cookies whose `domain` does not match `url`; those are
counted as `skipped` with the reason in `errors` (name and domain only). After the loop,
`session.cookies.flushStore()`.

`localStorage` entries (storage-state files only): for each origin, open a temporary hidden tab through
`BrowserSessionService` on `about:blank` under that origin (`Page.navigate` to `origin + '/favicon.ico'`
is enough to get a document), then `DOMStorage.setDOMStorageItem({ storageId: { securityOrigin, isLocalStorage: true }, key, value })`;
close the tab. `DOMStorage.enable` / `setDOMStorageItem` join the allow-list.

### 10.5 UI

One dialog from the `@cherry/browser` card in `BuiltinMcpServerList.tsx` ("Import browser data"):
a list of detected sources with their `supported` state and reason, a file picker for storage-state
/ `cookies.txt`, an optional domain filter, and the result summary. Strings under
`settings.mcp.browser_import.*` in `en-us.json`, synced with `pnpm i18n:sync`. No preference is
stored; the import is a one-shot action.

### 10.6 PR D — `feat(browser-import): import cookies and site storage from external browsers`

| # | Commit | Files | Tests |
|---|---|---|---|
| D1 | `feat(browser-import): parse storage-state and Netscape cookie files` | `import/formats.ts`, `shared/types/browserImport.ts` | `formats.test.ts`: fixture files → cookies; `#HttpOnly_` prefix; malformed line skipped with an error entry; storage-state `origins` round-trip |
| D2 | `feat(browser-import): apply imported cookies and storage to a partition` | `import/applyImport.ts`, allow-list | `applyImport.test.ts` with a fake `session.cookies`: url composition for leading-dot domains, `__Host-` on http skipped and reported, session cookie has no `expirationDate`, `flushStore` called once |
| D3 | `feat(browser-import): read Chromium-family profiles` | `import/chromiumProfile.ts` | `chromiumProfile.test.ts`: sqlite fixture built in the test with the real `cookies` schema; `expires_utc` conversion; samesite map; `v10` decrypt against a fixture encrypted with password `test` and the documented KDF; SHA-256 prefix stripped; `v20` → `unsupported` without touching the keychain |
| D4 | `feat(browser-import): read Firefox profiles` | `import/firefoxProfile.ts` | `firefoxProfile.test.ts`: `profiles.ini` parsing incl. `Default=1`; `moz_cookies` fixture |
| D5 | `feat(browser-import): expose import routes and the settings dialog` | `ipc/schemas/browser.ts`, `ipc/handlers/browser.ts`, `BrowserImportDialog.tsx`, i18n | `schemas/__tests__` input validation; renderer test: sources render with reason text, file path submitted, result summary shown |

Manual acceptance (add to §9): import from the local Chrome default profile with `domains: ['github.com']`,
`open https://github.com` in the MCP browser → the snapshot shows the signed-in header; repeat with a
`cookies.txt` exported from Firefox; on Windows with Chrome ≥ 127 the source shows the
app-bound-encryption reason and the file path succeeds.

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
- Imported cookies are credentials at rest in `persist:default`, shared by every MCP client
  (see the browser server README note). The dialog says so; the private partition never receives them.
