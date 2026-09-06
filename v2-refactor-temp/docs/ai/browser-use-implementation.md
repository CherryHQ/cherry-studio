# Browser Use — Implementation Plan

Turns [`browser-use-design.md`](./browser-use-design.md) (P0 + P1 of its roadmap) into files,
APIs, commits and tests. P2 (frames, vision, extract) and P3 (drive the visible pane, handoff)
are out of scope here; they build on the same engine and get their own plan once P1 has shipped.

Read the design doc first. This document does not repeat the rationale; it fixes the decisions.

## 1. Decisions fixed by this plan

| Decision | Choice | Why |
|---|---|---|
| Where the engine lives | `src/main/services/browser/` (new module, lifecycle service `BrowserSessionService`) | Same layer as `services/webview/`; the MCP server under `src/main/ai/mcp/servers/browser/` becomes a thin tool adapter |
| Single debugger session per guest | `GuestSession` is the only code that calls `webContents.debugger.attach()` | Electron allows one attach per `webContents`; `annotationExport.ts` and browser use must share it |
| Element addressing | `ref` = `e<n>`, allocated per **document generation**, mapped to `backendNodeId` in main | Stable within a document, cheap to resolve, never leaks across a main-frame navigation |
| Snapshot source | `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`, serialised in main | Replaces the guest-side JS walker in `tools/snapshot.ts`; works without a preload |
| Snapshot output | Diff against the previous snapshot of the same tab by default; `full: true` opts out | Cost is in the tokens, not the CDP call |
| Input execution | Real `Input.*` events with a JS fallback when the hit-test says the point is occluded | What every mature project converged on |
| WebMCP polyfill | Installed via `Page.addScriptToEvaluateOnNewDocument`, **not** via preload | Hidden MCP tabs have `preload: ''`; one mechanism covers both hidden tabs and `<webview>` guests. Preload injection stays a P3 option for guests the engine attaches to lazily |
| CDP surface | Explicit allow-list in `cdpAllowList.ts`; `GuestSession.send()` rejects anything else | Reviewable security boundary; `execute` stays the escape hatch |
| Session ownership | Registry keyed by `webContents.id`; owners (`mcp:<serverId>`, later `agent:<sessionId>`) acquire/release; retention marks per tab | Per-connection controllers are the leak |
| Existing tools | `open`, `execute`, `screenshot`, `list_tabs`, `switch_tab`, `close_tab`, `reset` keep their names and input schemas; `snapshot` keeps its name but changes output | No prompt churn for the tools that already work |

## 2. Module layout

```
src/shared/types/browserUse.ts              ref / snapshot / action result types + zod schemas
src/shared/utils/webMcpPolyfill.ts          the injected `navigator.modelContext` script (string)

src/main/services/browser/
  index.ts                                  barrel: BrowserSessionService, GuestSession, types
  BrowserSessionService.ts                  lifecycle service: registry, budget, sweep timer
  GuestSession.ts                           one per webContents: debugger, refs, dialog, downloads, retention
  cdpAllowList.ts                           Set<string> of permitted CDP methods
  snapshot/
    captureSnapshot.ts                      CDP calls → raw AX + DOM snapshot
    buildSnapshotTree.ts                    raw → SnapshotNode[] (visibility, interactivity, viewport filter)
    serializeSnapshot.ts                    SnapshotNode[] → text lines, 40 k cap
    diffSnapshot.ts                         previous lines vs current → diff text
  actions/
    resolveTarget.ts                        ref → backendNodeId → centre point + occlusion check
    mouse.ts                                click / hover / scroll via Input.dispatchMouseEvent
    keyboard.ts                             type / press_key via Input.dispatchKeyEvent + insertText, key table
    forms.ts                                select_option / upload_file
    settle.ts                               post-action wait (navigation or network-quiet)
  __tests__/                                see §8

src/main/ai/mcp/servers/browser/
  controller.ts                             keeps windows + tabs; CDP calls move to GuestSession
  tools/
    snapshot.ts                             rewritten on the engine
    interact.ts                             click, type, press_key, select_option, hover, scroll, upload_file
    navigate.ts                             go_back, go_forward, wait_for
    dialog.ts                               handle_dialog
    inspect.ts                              find, console_messages, network_requests
    webMcp.ts                               list_web_tools, call_web_tool
    tabs.ts                                 + mark_tab
    registry.ts                             tool lists extended
    result.ts                               shared result envelope
```

`src/main/services/webview/annotationExport.ts` loses its own attach/detach cycle and calls
`GuestSession.describeElement()` instead (§6).

## 3. Shared types (`src/shared/types/browserUse.ts`)

```ts
export const browserRefSchema = z.string().regex(/^e\d+$/)
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
  truncated: boolean
}

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

Tool input schemas follow the existing convention in `servers/browser/tools/*.ts`: a hand-written
MCP `inputSchema` JSON next to the zod schema that parses `args`. The zod schemas live in
`browserUse.ts`; a schema test (A1) keeps the two in step.

| Tool | Input | Notes |
|---|---|---|
| `snapshot` | `{ tabId?, privateMode?, full?: boolean, scope?: BrowserRef, maxChars?: number }` | `scope` replaces the old CSS `selector` |
| `click` | `{ ref, tabId?, privateMode?, button?: 'left'\|'right'\|'middle', clickCount?: 1\|2 }` | |
| `type` | `{ ref, text, tabId?, privateMode?, clear?: boolean, submit?: boolean }` | `submit` presses Enter after read-back succeeds |
| `press_key` | `{ key: string, tabId?, privateMode? }` | `"Enter"`, `"Control+a"`, `"Shift+Tab"` |
| `select_option` | `{ ref, values: string[], tabId?, privateMode? }` | matches option `value` then label |
| `hover` | `{ ref, tabId?, privateMode? }` | |
| `scroll` | `{ ref?, pages?: number, tabId?, privateMode? }` | `pages` default 1, negative scrolls up; no `ref` = viewport |
| `upload_file` | `{ ref, paths: string[], tabId?, privateMode? }` | paths must resolve inside the agent session's working directory (the root its file tools already use); else `not_allowed` |
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
  acquire(guest: WebContents, owner: string): GuestSession   // creates or refcounts; throws when over budget
  get(webContentsId: number): GuestSession | undefined
  release(guest: WebContents, owner: string): void            // refcount → 0 keeps the session until sweep
  endTurn(owner: string): void                                // closes `temporary` tabs of that owner, clears marks
  onStart(): registerInterval(sweep, 60_000)
  onStop(): dispose every session
}
```

Budget constants (in `BrowserSessionService.ts`, not configurable):

| Constant | Value | Applies to |
|---|---|---|
| `MAX_GUESTS_PER_OWNER` | 4 | `acquire` throws `budget_exceeded` after evicting that owner's oldest `temporary` tab |
| `MAX_GUESTS_GLOBAL` | 8 | same, across owners, `temporary` before `handoff`, never `deliverable` |
| `TEMPORARY_IDLE_MS` | 5 min | sweep closes the tab (`webContents.close()` via the owning controller callback) |
| `RETAINED_IDLE_MS` | 2 min | sweep freezes: `setBackgroundThrottling(true)`, `Page.setWebLifecycleState({state:'frozen'})`, `debugger.detach()` |

`GuestSession` (one per `webContents.id`):

```ts
export class GuestSession {
  readonly guest: WebContents
  retention: TabRetention = 'temporary'
  lastActive: number

  // debugger
  send<T>(method: string, params?: object): Promise<T>   // attaches lazily; rejects `not_allowed` if not in cdpAllowList
  isAvailable(): boolean                                  // false while DevTools is open or attach failed
  freeze(): Promise<void>; thaw(): Promise<void>

  // document + refs
  readonly documentId: string                             // main-frame loaderId; regenerated on Page.frameNavigated
  resolveRef(ref: BrowserRef): number                     // backendNodeId or throws `stale_ref` when documentId changed
  snapshot(opts): Promise<{ text: string; snapshot: BrowserSnapshot }>
  describeElement(selector: string): Promise<AccessibilityCapture>   // used by annotationExport (§6)

  // events buffered for tool results
  pendingDialog?: BrowserActionResult['dialog']
  takeDownloads(): BrowserActionResult['downloads']
  console: RingBuffer<ConsoleEntry>; network: RingBuffer<NetworkEntry>

  // WebMCP
  listWebTools(): Promise<WebToolDescriptor[]>
  callWebTool(name: string, args: unknown): Promise<unknown>

  dispose(): void
}
```

Attach sequence (`GuestSession.ensureAttached`): `attach('1.3')` → `Page.enable`, `Runtime.enable`,
`DOM.enable`, `Network.enable`, `Log.enable`, `Accessibility.enable` → `Page.addScriptToEvaluateOnNewDocument`
with the WebMCP polyfill. Listeners: `Page.frameNavigated` (main frame → new `documentId`, clear refs
and the last snapshot), `Page.javascriptDialogOpening` (→ `pendingDialog`), `Runtime.consoleAPICalled` /
`Log.entryAdded`, `Network.responseReceived`, `debugger` `detach` event (→ `isAvailable() === false`
until the next `send`). Downloads: `guest.session.on('will-download')` filtered by `item.getWebContents?.() === guest`.

`cdpAllowList.ts` enumerates exactly the methods named in §4–§5 plus `Emulation.setFocusEmulationEnabled`
(§10); adding a method is a reviewed one-line change.

`send()` while `pendingDialog` is set returns `dialog_open` for every method except
`Page.handleJavaScriptDialog`; this is what stops `execute` from hanging.

## 5. Algorithms

### 5.1 Snapshot (`snapshot/`)

1. `captureSnapshot`: `Accessibility.getFullAXTree()` and `DOMSnapshot.captureSnapshot({ computedStyles: ['cursor','display','visibility','opacity','pointer-events'], includeDOMRects: true, includePaintOrder: true })`, plus `Runtime.evaluate('({w:innerWidth,h:innerHeight,y:scrollY})')`.
2. `buildSnapshotTree`:
   - index DOM snapshot nodes by `backendNodeId` → `{ rect, cursor, display, visibility, opacity, attributes, paintOrder }`;
   - visible = has a rect with area > 0, `display !== 'none'`, `visibility !== 'hidden'`, `opacity > 0`;
   - interactive = AX role ∈ {button, link, textbox, checkbox, radio, combobox, listbox, option, menuitem, menuitemcheckbox, menuitemradio, slider, spinbutton, switch, tab, searchbox} ∨ `cursor === 'pointer'` ∨ attribute `onclick` ∨ `tabindex >= 0` ∨ `contenteditable`;
   - keep a node if interactive, or role ∈ {heading, text, StaticText, img, listitem, cell, row} with a non-empty name;
   - drop `ignored` AX nodes and generic containers with exactly one kept child (re-parent);
   - viewport filter: keep when `rect.y ∈ [scrollY − 1000, scrollY + h + 1000]`, mark `inViewport` when inside the actual viewport; nodes outside the band are counted, not emitted;
   - refs: interactive nodes get `e<n>` from the session's ref map (`backendNodeId → ref`, per `documentId`, monotonic so a re-snapshot keeps existing refs).
3. `serializeSnapshot`: one node per line, two spaces per depth:
   `[e12] button "Submit" (disabled)` / `heading "Pricing" (level=2)` / `[e13] link "Docs" (href=/docs)`; textbox values as `value="…"` truncated at 80 chars. Header line `url · title · N interactive / M total`. Cap 40 000 chars, closing with `… (K more nodes below; use scroll, scope, or find)`.
4. `diffSnapshot`: key each line by `backendNodeId`. Output = header + lines that are new (prefixed `*`) or whose text changed, plus `- N nodes removed`. Fall back to the full text when more than 60 % of the lines changed or the `documentId` differs. Unchanged snapshot → `(no change)`.

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
- `upload_file`: validate every path with `path.resolve` against the allowed roots, then `DOM.setFileInputFiles({ backendNodeId, files })`.

### 5.6 Settle (`actions/settle.ts`)

After every action: wait 100 ms for `Page.frameStartedNavigation` on the main frame; if it fires, wait for `Page.loadEventFired` (max 10 s) and set `navigated: true`; otherwise wait until no `Network.requestWillBeSent` / `loadingFinished` for 300 ms (max 5 s). Then take the diff snapshot for the result. `wait_for` reuses the same loop with a predicate over `buildSnapshotTree`.

### 5.7 WebMCP polyfill (`src/shared/utils/webMcpPolyfill.ts`)

Main-world script, idempotent, installs `navigator.modelContext` when absent:
`registerTool({ name, description, inputSchema, execute })`, `unregisterTool(name)`, `provideContext({ tools })`, and a private `__cherryModelContext = { list(): descriptors, call(name, args): Promise }`. The engine reads the list with `Runtime.evaluate('__cherryModelContext.list()')` and calls with `Runtime.evaluate(…, { awaitPromise: true, timeout })`. Tool descriptions are page data and go out with the untrusted-data notice. When Electron 43 lands, `list()` is served by the native `WebMCP` CDP domain and the script becomes a fallback.

## 6. Annotation export migration

`annotationExport.ts` currently attaches, walks, detaches (`captureDocumentAccessibility`, guard at the
`isAttached()` check). Replace with:

```ts
const session = application.get('BrowserSessionService').acquire(guest, `annotation:${webviewId}`)
try {
  return await session.describeElement(annotation.locator.selector)   // Runtime.evaluate → DOM.describeNode → Accessibility.getAXNodeAndAncestors / getChildAXNodes
} finally {
  application.get('BrowserSessionService').release(guest, `annotation:${webviewId}`)
}
```

`describeElement` returns the same `AccessibilityCapture` shape the markdown formatter consumes,
so `annotationMarkdown.ts` and its tests do not change. `debugger_unavailable` now only means
DevTools is open. `WebviewService` gains `@DependsOn('BrowserSessionService')`.

The `webviewAnnotation` locator gets an optional `backendNodeId?: number` and `documentId?: string`
filled by `describeElement`, so a saved annotation can be turned into a `ref` later without a
second selector resolution (P3 consumer; the fields are cheap to fill now).

## 7. Commit and PR split

Implementation lands as three stacked PRs on top of this documentation PR. Every commit builds,
lints and passes the listed tests on its own; conventional-commit scopes are the kebab-case module.

### PR A — `feat(browser-session): shared CDP session + snapshot engine` (no user-visible change)

| # | Commit | Files | Tests |
|---|---|---|---|
| A1 | `feat(browser-use): add shared browser-use types and tool input schemas` | `src/shared/types/browserUse.ts` | `src/shared/types/__tests__/browserUse.test.ts`: ref regex, every tool schema accepts its documented input and rejects a wrong shape |
| A2 | `feat(browser-session): add GuestSession with allow-listed debugger access` | `services/browser/{GuestSession,cdpAllowList,index}.ts` | `GuestSession.test.ts` (§8.2) |
| A3 | `feat(browser-session): register BrowserSessionService with budget and sweep` | `BrowserSessionService.ts`, `serviceRegistry.ts` | `BrowserSessionService.test.ts` (§8.3) |
| A4 | `feat(browser-session): capture and serialise CDP accessibility snapshots` | `snapshot/{captureSnapshot,buildSnapshotTree,serializeSnapshot}.ts` | `snapshot.test.ts` with recorded fixtures (§8.1) |
| A5 | `feat(browser-session): diff consecutive snapshots` | `snapshot/diffSnapshot.ts` | `diffSnapshot.test.ts` |
| A6 | `refactor(webview-annotation): capture accessibility through GuestSession` | `annotationExport.ts`, `WebviewService.ts`, locator type + `webviewAnnotation.ts` schema | update `annotationExport.test.ts`: export succeeds while another consumer holds the session (the regression this migration exists for); `WebviewService.test.ts` mock gains the service |

### PR B — `feat(browser-mcp): P0 tools on the shared engine`

| # | Commit | Files | Tests |
|---|---|---|---|
| B1 | `refactor(browser-mcp): route controller CDP calls through BrowserSessionService` | `controller.ts` (drop `ensureDebuggerAttached`, `dbg.sendCommand`), `server.ts` (owner = `mcp:<uuid>`; `onclose` → `endTurn` + release) | existing `servers/__tests__/browser.test.ts` adapted: the fake debugger is now reached via the service mock |
| B2 | `feat(browser-mcp): serve snapshot from the accessibility engine with diff by default` | `tools/snapshot.ts`, `tools/result.ts` | `tools/__tests__/snapshot.test.ts`: `full`, `scope`, `(no change)`, cap |
| B3 | `feat(browser-mcp): add click, hover and scroll` | `actions/{resolveTarget,mouse}.ts`, `tools/interact.ts` | `resolveTarget.test.ts`, `mouse.test.ts` (§8.2) |
| B4 | `feat(browser-mcp): add type and press_key` | `actions/keyboard.ts` | `keyboard.test.ts` |
| B5 | `feat(browser-mcp): add select_option and upload_file` | `actions/forms.ts` | `forms.test.ts` incl. path-escape rejection |
| B6 | `feat(browser-mcp): add go_back, go_forward, wait_for and action settling` | `actions/settle.ts`, `tools/navigate.ts` | `settle.test.ts` with fake timers |
| B7 | `feat(browser-mcp): surface dialogs and downloads, add handle_dialog` | `GuestSession.ts` listeners, `tools/dialog.ts` | `GuestSession.test.ts` dialog cases; `dialog.test.ts` |
| B8 | `docs(browser-mcp): document the browser-use tool set` | `servers/browser/README.md`, `settings.mcp.builtinServersDescriptions.browser` in `en-us.json` + `pnpm i18n:sync` + translations | `pnpm lint` (i18n check) |

### PR C — `feat(browser-mcp): P1 stability, inspection and WebMCP`

| # | Commit | Files | Tests |
|---|---|---|---|
| C1 | `feat(browser-mcp): recover stale refs by role and name` | `GuestSession.resolveRef` fallback via `Accessibility.queryAXTree` | `GuestSession.test.ts` stale-ref cases |
| C2 | `feat(browser-mcp): add find, console_messages and network_requests` | `tools/inspect.ts`, ring buffers in `GuestSession` | `inspect.test.ts` |
| C3 | `feat(browser-mcp): inject the WebMCP polyfill and expose page tools` | `src/shared/utils/webMcpPolyfill.ts`, `tools/webMcp.ts` | `webMcpPolyfill.test.ts` (jsdom), `webMcp.test.ts` |
| C4 | `feat(browser-session): retain tabs per turn and freeze idle sessions` | `BrowserSessionService` sweep + `mark_tab` tool | `BrowserSessionService.test.ts` freeze/evict cases |
| C5 | `refactor(browser-mcp): replace BrowserView tabs with WebContentsView` | `controller.ts`, `types.ts`, `tabbarHtml.ts` | existing controller tests; manual (§9) |

Deferred (tracked as follow-ups, not in these PRs): explicit `endTurn` from the agent runtime
(today it fires on MCP disconnect only), per-origin CDP policy, the `<webview>` pane as an engine
target (P3).

## 8. Automated test plan

Projects come from `vitest.config.*`: `main` (node), `shared`, `preload`, `renderer` (jsdom).
Run with `pnpm exec vitest run <path>`; never `pnpm test <path>`.

### 8.1 Fixtures (`src/main/services/browser/__tests__/fixtures/`)

Recorded once from the dev app with the existing `execute` tool replaced by a one-off debugger
call (`getFullAXTree` + `captureSnapshot` JSON), committed as `<page>.ax.json` / `<page>.dom.json`:

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
same pattern as `servers/__tests__/browser.test.ts`):

- attaches once across many `send` calls; `attach` throwing → `isAvailable() === false` and `send` rejects `debugger_unavailable`;
- `send('Target.createTarget')` rejects `not_allowed` without touching the debugger;
- `Page.frameNavigated` for the main frame changes `documentId`, `resolveRef` of an old ref throws `stale_ref`; a sub-frame navigation does not;
- `Page.javascriptDialogOpening` sets `pendingDialog`; the next `send('Runtime.evaluate')` rejects `dialog_open`; `Page.handleJavaScriptDialog` clears it;
- `will-download` items appear once in `takeDownloads()` and are then gone;
- `debugger` `detach` event (DevTools opened) flips `isAvailable()`; the next `send` re-attaches when possible.

`snapshot.test.ts` (fixtures):

- `form.html`: every input gets a ref, the label text does not; the password textbox shows no value; the disabled button carries `(disabled)`;
- `overlap.html`: both buttons are emitted (occlusion is resolved at action time, not snapshot time);
- `long.html`: nodes beyond the band are counted in the footer, output ≤ 40 000 chars, header counts match;
- refs are stable across two builds of the same document, and re-allocated after `documentId` changes.

`diffSnapshot.test.ts`: new node gets `*`; removed nodes summarised; changed value line re-emitted; >60 % churn → full; identical → `(no change)`.

`resolveTarget.test.ts`: centre from the largest quad; `getNodeForLocation` returning a descendant → not occluded; a sibling → occluded.

`mouse.test.ts` / `keyboard.test.ts` / `forms.test.ts`: assert the CDP command sequence and parameters the guest receives (the contract of "real input events"): three mouse events at the resolved point, `insertText` after `focus`, `Control+a`/`Delete` before typing when `clear`, read-back mismatch → per-character retry → error; `press_key('Control+a')` → modifiers 2 with `windowsVirtualKeyCode` 65; `upload_file` with `../` escaping the allowed root → `not_allowed` and no `setFileInputFiles`.

`settle.test.ts` (fake timers): navigation started within 100 ms → waits for `loadEventFired`, `navigated: true`; no navigation → resolves after 300 ms quiet; a request every 200 ms → resolves at the 5 s cap.

`BrowserSessionService.test.ts` (use `tests/__mocks__` `application` mock, `registerInterval` from `BaseService`):

- `acquire` returns the same session for the same `webContents.id`; refcount survives one `release`;
- fifth `acquire` for one owner evicts that owner's oldest `temporary` session first and never a `deliverable` one; ninth global `acquire` with only `deliverable` sessions throws `budget_exceeded`;
- sweep after `TEMPORARY_IDLE_MS` closes temporary sessions, after `RETAINED_IDLE_MS` freezes retained ones (`setBackgroundThrottling(true)`, `Page.setWebLifecycleState`, `detach` in that order) and `thaw` on the next `send`;
- `endTurn(owner)` closes only that owner's temporary tabs and resets marks.

`annotationExport.test.ts` (existing): add the case "engine already attached → export still returns AX context"; delete the case that asserted `debugger_unavailable` on a pre-attached debugger.

### 8.3 `main` project — MCP adapter

`servers/__tests__/browser.test.ts` keeps its window/tab coverage. New `tools/__tests__/*.test.ts`
use a fake `GuestSession` and assert the result envelope: `dialog` present when pending, `snapshot`
appended after actions, `stale_ref` text includes the hint to re-snapshot, unknown tool name rejected
by the registry.

### 8.4 `shared` and jsdom

- `browserUse.test.ts`: schemas (A1).
- `webMcpPolyfill.test.ts` with `// @vitest-environment jsdom`: evaluating the script twice keeps one registry; `registerTool` + `__cherryModelContext.list()` round-trips descriptors; `call` rejects for an unknown name and propagates the tool's promise.

### 8.5 Gates per commit

`pnpm exec vitest run <changed test files>`, `pnpm lint`, `pnpm format`; `pnpm docs:check-links`
for B8. CI runs the full suite.

## 9. Manual acceptance (dev app)

Use an isolated dev instance so the shared dev database is untouched. Enable `@cherry/browser` in
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
| 7 | `upload_file` with a path outside the workdir | `not_allowed`, no CDP `setFileInputFiles` in the debug log |
| 8 | Open DevTools on the hidden window's tab, run `snapshot` | `debugger_unavailable`; close DevTools, `snapshot` works again |
| 9 | With the agent tab open, add an annotation in the agent browser pane and export it | export contains the AX path (A6 regression) |
| 10 | Open 5 tabs, wait 5 min | only marked tabs survive; `app.getAppMetrics()` logged before/after shows the freed renderer processes |
| 11 | `webmcp.html`: `list_web_tools`, `call_web_tool` | the page's tool is listed with the untrusted-data notice and returns its value |
| 12 | Perf: `open https://github.com/CherryHQ/cherry-studio/pulls`, `snapshot` ×3 | logged capture + serialise time < 1 s each, output ≤ 40 000 chars, diff #2 and #3 < 2 000 chars |

Record the numbers of #10 and #12 in the PR description; they are the acceptance criteria for the
session-management commit.

## 10. Risks

- `DOMSnapshot.captureSnapshot` on very large pages can exceed 50 MB; the capture is bounded by the
  band filter only after the fact. Mitigation in A4: request `includeDOMRects` only, no text boxes,
  and drop the DOM snapshot entirely (interactivity from AX roles only) above 20 000 nodes.
- `Input.dispatchMouseEvent` on a hidden, unfocused window: Chromium still dispatches, but some
  pages check `document.hasFocus()`. `Emulation.setFocusEmulationEnabled` is on the allow-list for
  that reason.
- Freezing via `Page.setWebLifecycleState` while a download is in progress cancels it: the sweep
  skips sessions with `progressing` downloads.
- `BrowserView` is deprecated but not removed in Electron 41; C5 is isolated so it can slip without
  blocking P0/P1.
