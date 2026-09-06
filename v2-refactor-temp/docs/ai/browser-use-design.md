# Browser Use — Gap Analysis & Design

Where `@cherry/browser` (the built-in browser MCP server) stands against real
"browser use", what Chromium/Electron provide, what the open-source field and
OpenAI's Codex desktop converged on, and the roadmap to close the gap.
Research date 2026-09-08; source clones under `/tmp/bu-research/` (browser-use,
playwright monorepo, chrome-devtools-mcp, stagehand, nanobrowser, UI-TARS-desktop,
midscene, agent-browser, mcp-chrome, Chromium `chrome/browser/actor`, ChatGPT.app bundle).

Implementation detail (files, APIs, commit split, test plan) for P0/P1 is in
[`browser-use-implementation.md`](./browser-use-implementation.md).

## Delivery status

PR1 (PR A), [#20128](https://github.com/CherryHQ/cherry-studio/pull/20128), implements the
shared CDP engine and annotation export migration on `browser-use-engine`; it is open, not merged.
The engine now provides document-bound refs, bounded AX/DOM snapshots and diffs, dialog interruption,
and managed/borrowed ownership with resource budgets. The existing MCP controller still uses its old
implementation, so the tool table below remains the current user-facing surface.

The next stack layer is PR2 (PR B), `browser-use-mcp`, based on `browser-use-engine`: move the MCP
adapter into the browser feature, route its tabs through the service, and expose snapshot/action tools.
`upload_file` is deferred until MCP calls carry a trusted session working directory. Turn-scoped
retention likewise requires upstream session identity and a turn-ended signal; neither is available
from the current server-wide MCP client. See the implementation plan for delivery boundaries.

## Current state — `src/main/ai/mcp/servers/browser/`

| Dimension | Today |
|---|---|
| Tool surface | 8 tools: `open` / `execute` / `screenshot` / `snapshot` / `list_tabs` / `switch_tab` / `close_tab` / `reset` (`tools/registry.ts`) |
| Page representation | Hand-rolled in-page DOM walk (`tools/snapshot.ts`) emitting `[n] button: …`; **the numbers are decorative — no tool consumes them** |
| Actions | Only `execute` (`Runtime.evaluate` of arbitrary JS). Click = `.click()`, typing = assigning `value`; no real input events |
| CDP | `Page.enable` / `Runtime.enable` / `Runtime.evaluate` / `Page.captureScreenshot` only (`controller.ts:127-128, 702, 896`) |
| Host | Hidden `BrowserWindow` + `BrowserView` tabs (deprecated API) with a custom tab bar; `persist:default` / `private` partitions |
| Robustness | Waits only for `did-finish-load`/`dom-ready`; no dialog / file-chooser / download handling (a page `alert()` hangs `Runtime.evaluate`); no new-tab follow; no stale-element semantics |
| Frames / observability / vision | None (no OOPIF, no console/network tools, screenshot only, no coordinate actions) |

This is "fetch + arbitrary JS", not browser use.

## What "browser use" converged on (9 projects read from source)

| Consensus | Evidence |
|---|---|
| **Raw CDP is the end state** | browser-use and Stagehand v4 both dropped Playwright for raw CDP; agent-browser is raw CDP in Rust; Midscene's extension mode is raw CDP via `chrome.debugger`. Electron's `webContents.debugger` is exactly this transport |
| **Stable addressing = `backendNodeId`** | browser-use uses it directly as the index; chrome-devtools-mcp memoises `loaderId_backendNodeId`; agent-browser resolves `@eN → {backendNodeId, role, name, nth, frameId}` and re-queries the AX tree by role+name+nth when the id goes stale (`element.rs:342-360`) |
| **Real input events separate mature from immature** | browser-use / Stagehand / agent-browser: `DOM.scrollIntoViewIfNeeded → getContentQuads → Input.dispatchMouseEvent` with an occlusion hit-test and JS fallback; UI-TARS and mcp-chrome still `element.click()` — same tier as us |
| **Dialogs are routinely missed** | UI-TARS and Midscene have no dialog handling at all; playwright-mcp's `### Modal state` section + racing actions against modal state, and browser-use's watchdogs, are the templates |
| **Vision converges on 0–1000 normalised coordinates** | DPR/scale mapping is the recurring bug source; Midscene models it explicitly (`shrunkShotToLogicalRatio`). Midscene v1.12 went vision-only while Stagehand v4 deleted CUA — "AX/DOM tree first, vision optional" remains the stable combination |
| **Nobody drives an Electron `webContents`** | UI-TARS-desktop and Midscene studio (both Electron) launch an external system Chrome via puppeteer-core. Driving our own visible `WebviewBrowser` pane is a genuine differentiator: user-visible, annotatable, takeover-able, no external Chrome dependency |
| **Cost controls** | browser-use: viewport ±1000 px filter, 40 k-char cap, paint-order occlusion, `*` marks new elements; playwright-mcp: `browser_find`; Codex: AX **diff** output by default |

## What Chromium / Electron provide

Everything needed is CDP, reachable through `webContents.debugger.sendCommand(method, params, sessionId?)`
(Electron 41.8 = Chromium 146; `sessionId` support means OOPIF child sessions work):
`Accessibility.getFullAXTree`, `DOMSnapshot.captureSnapshot` (computed styles / paintOrder / DOMRects),
`DOM.*` (`getContentQuads`, `scrollIntoViewIfNeeded`, `setFileInputFiles`, `resolveNode`), `Input.*`,
`Page.handleJavaScriptDialog` / `setInterceptFileChooserDialog` / `setDownloadBehavior` / `startScreencast`,
`Target.setAutoAttach{flatten}`, `Network` / `Fetch`, `Emulation`, `Overlay.highlightNode`, `DOMDebugger.getEventListeners`,
`Autofill.trigger`. Electron adds `WebContentsView`, `WebFrameMain.executeJavaScript`, `will-download`,
permission handlers.

Not available to us: Chromium's built-in **Actor** framework (`chrome/browser/actor/`, the
Gemini-in-Chrome agent — `chrome/` layer, Glic-only, no extension API) and its
**AnnotatedPageContent** page representation (Blink code is present but has no CDP exposure);
Chrome extension APIs (`chrome.debugger`); the CDP **`WebMCP`** domain (lands in Chromium 150 =
Electron 43). Actor is still the best reference design: `PageTarget = variant<Point, DomNode{id, document token}>`,
three-stage validation (validate → time-of-use against the last observation → invoke, with a
renderer-side hit-test that must land inside the target), per-tool `ActionResultCode` ranges, a
page-settled observation state machine, and a handoff-button UI.

## OpenAI Codex desktop (ChatGPT.app 26.825) — same architecture, one generation ahead

ChatGPT.app is Electron. Its in-app browser (`iab`) is a renderer `<webview>`; the main process
attaches `webContents.debugger('1.3')` and relays CDP over a native pipe to an out-of-process
Node runtime (`cua_node` + `@oai/browser-desktop`). That is structurally our `WebviewBrowser` +
`AnnotationSession`. Design points worth adopting:

- **Code mode**: one MCP tool (`node_repl.js`) plus a typed JS API — `tab.ax.write()` /
  `tab.ax.click(index)` / `setValue` / `pressKey` / `scroll` / `selectText` /
  `performSecondaryAction`, with a documented priority `ax > playwright > dom_cua > cua`;
  the model pulls docs on demand via `browser.documentation()`.
- **AX text + element index + revision diff** as the primary representation (a Rust→WASM
  "revision" engine; the same engine drives macOS native apps in `@oai/sky`).
- **WebMCP via preload polyfill** (`document.modelContext` shim relayed to main) — available today,
  without waiting for native Chromium support.
- **CDP allow-list**: `Target.*` blocked except `setAutoAttach`, `Page.navigate` intercepted for
  origin policy, `Fetch.enable` limited to non-Document patterns, `DOM.setFileInputFiles` blocked in
  favour of the file-chooser flow; per-origin `{access, downloads, uploads, full_cdp_access}` config.
- **Governance**: three-tier confirmation policy (hand-off required / confirm at action time /
  transmission boundary for sensitive data), untrusted-content rule, `browserAuth` credential
  isolation (model never sees secrets), fail-closed user-tab claiming (title+url snapshot),
  management audit trail, background-by-default visibility.

## Relationship to the existing annotation feature

The WebView annotation stack (PRs #17842 / #17872) is not a sibling of browser use — it is the
first half of the same engine. Both sides observe and address elements in a guest page through
the same three seams; browser use adds the *act* half.

**Shared infrastructure already in place**

| Seam | Annotations today | What browser use reuses |
|---|---|---|
| Guest preload (`src/preload/webview.ts`, `WebviewAnnotationController.ts`) | Selection overlay (hover / click / marquee), pins, `selection_pending` → host editor, key replay to the host, session-scoped bridge protocol | Same injection point and bridge for highlight-on-action, "which element did the agent touch" pins, and future human handoff UI; WebMCP injection uses CDP in PR C |
| Element locator (`WebviewElementLocator`) | `selector` (unique CSS through open shadow roots), `tagName`, `text`, `ariaLabel`, `role`, `styles`, optional `region { rect, elements[] }` | Becomes the human-authored **target**: an annotation is a `PageTarget` the agent can act on without re-discovering it. `styles` (position / z-index / offsets) is exactly the context an agent needs for layout fixes |
| Main-side AX capture (`services/webview/annotationExport.ts`) | Acquires a borrowed `GuestSession` and calls `describeElement(annotation, budget, options)`; release detaches only after the last owner leaves | Shares debugger ownership and command cancellation with whole-page AX/DOM snapshots; annotation path/subtree formatting stays intact |
| Host surface (`WebviewBrowser`, `AgentBrowserRightPanel`) | Composer-kernel editor popover, `onAnnotationSaved` → `webviewAnnotation` composer token (`formatAgentWebviewAnnotationPrompt`) | The pane the agent drives is the pane the user annotates; the token is the human → agent hand-off, browser use is the agent → page hand-off |
| Export / read tool (`webview.export_annotations`, `read_webview_annotations`) | Markdown with the untrusted-data notice, AX path/subtree, region element list | Same formatter vocabulary and the same trust boundary for snapshot output |

**One hard constraint: a single debugger session per guest**

PR1 moves annotation capture into `features/browser/snapshot/describeElement.ts` and makes
`GuestSession` own the attach/detach lifecycle for both capture paths. Multiple consumers of the
same borrowed guest share one debugger; releasing an annotation export cannot detach another
consumer's session. DevTools or an externally attached debugger still produces `debugger_unavailable`.
The legacy MCP controller is migrated in PR2 before it starts using the shared snapshots and actions.

**Two addressing schemes to reconcile**

Annotations address elements by CSS selector (stable across page reloads, human-readable, resolvable
in the guest); browser use addresses by `backendNodeId` (stable within a document lifetime, what CDP
input and AX APIs take). Keep both, map between them at the boundary: a locator gains an optional
`backendNodeId` (valid for the current document identifier, cf. Chromium Actor's
`DomNode{node_id, document_identifier}`), and the snapshot engine resolves a selector → node id
on demand. These locator additions belong to P3; PR1 preserves the saved annotation schema and resolves
selectors through the existing isolated-world capture. Region annotations would map to
`{ ancestor backendNodeId, contained backendNodeIds[] }` the same way.

**What each side gains**

- Annotations → browser use: a precise, user-vetted target and intent ("make these two overlapping
  cards not overlap") with layout styles attached — the agent starts from a `click(ref)`-quality
  reference instead of a page-wide search, and the composer token already carries it into the run.
- Browser use → annotations: the agent can *act* and then *verify* on the same pane (re-snapshot, diff,
  screenshot); pins double as the "what the agent touched" trail; the handoff protocol (pause → user
  annotates or acts → resume) is the human-in-the-loop UI annotations already half-built.
- Both: one session registry, shared CDP command handling and the same untrusted-data boundary;
  full-page snapshots and annotation path/subtree exports keep their respective formatters.

**Ordering consequence for the roadmap**

PR1 has completed the shared engine and annotation migration. PR2 can now replace the MCP
controller's direct debugger ownership with `GuestSession` without creating a second attach path.

## Browser session management (performance)

Session management is needed, but as **ownership + retention rules + a resource budget**, not
as heavy infrastructure. Idle tabs are the smaller cost; snapshot capture is the larger one.

**Problems today**

- `CdpBrowserController` is instantiated **per MCP connection** (`server.ts:10`, disposed on
  disconnect); `maxWindows = 5` and `idleTimeoutMs = 5 min` are per controller. Two agent sessions
  = two hidden-window sets, no global budget.
- Reclamation is **lazy**: `sweepIdle` only runs on the next window create/access. After a task ends,
  hidden `BrowserView`s (one renderer process each, tens to hundreds of MB) and their attached
  debuggers survive until someone touches the browser again.
- No ownership/retention semantics: agent scratch tabs, pages the user should see, and pages needed
  next turn all share one `lastActive`.

**What the field does**

- Codex desktop: a main-process `BrowserSessionRegistry` routes backends per conversation
  (`ensureBackendForSession` / `disposeBackendForSession` / `disposeAfterSessionActivity`);
  agent-created tabs **close when the turn ends** unless explicitly `tab.markDeliverable()` (user-facing
  output) or `tab.markHandoff()` (continue next turn); marks are turn-scoped, latest wins; claimed user
  tabs are released by default; "prefer claiming an existing tab over opening a duplicate".
- browser-use keeps exactly one `about:blank` (AboutBlankWatchdog) and closes the browser when the
  agent ends; UI-TARS shares one Chrome and closes unresponsive pages during active-page election;
  playwright-mcp appends `### Open tabs` to every response so the model sees what it holds.
- In-repo precedent: the mini-app webview pool (per-app partition + LRU eviction).

**Target design and current boundary**

PR1 implements a registry keyed by `webContents.id`, ownership/refcounts, a 60-second sweep,
4 managed guests per creator and 8 globally, and a 5-minute temporary idle timeout. Busy guests
and deliverables are protected; borrowed pages are never closed, frozen or budget-counted. These
budgets begin governing MCP tabs only after PR2 migrates the controller. The table below describes
the longer-term design: true turn boundaries, retained-tab freezing and memory-based policy are
not delivered by PR1.

| Layer | Rule | Source |
|---|---|---|
| Ownership | One main-process `BrowserSessionService` keyed by `webContents.id`, with managed/borrowed ownership and owner refcounts; route MCP connections through it in PR2 and add trusted agent-session identity upstream | Codex registry; per-connection controllers are the leak |
| Retention | Tab tri-state: `temporary` (closed at turn end) / `deliverable` (kept, user-visible) / `handoff` (kept for the next turn); claimed user tabs return to the user; reuse an existing tab before opening a new one | Codex `markDeliverable` / `markHandoff` |
| Budget | ≤3–4 live guests per session, ≤8–10 globally; LRU-evict **temporary** tabs first; a real timer, not lazy sweeping; consult `app.getAppMetrics()` process memory before evicting | current `maxWindows` counts windows, not guests |
| Degrade before destroy | Idle-but-retained tabs: `webContents.setBackgroundThrottling(true)` + CDP `Page.setWebLifecycleState('frozen')` + `debugger.detach()` (an attached debugger keeps Accessibility/Network event traffic alive); re-attach on next use | Electron 41 / Chromium 146 |
| Snapshot cost (the real hot path) | `getFullAXTree + DOMSnapshot` costs 100 ms–1 s and MBs on large pages: cache the last revision per tab and emit **diffs by default**, viewport ±1000 px filter, 40 k-char cap, screenshots on demand rather than per step | browser-use cap, Codex diff, agent-browser `-i/-c` |

Out of scope: cross-restart persistence of tab state (cookies already persist in the partition) and
pre-warmed pools (unlike mini apps, agent tabs should be released when done).

## Roadmap

**P0 — make the numbers actionable (minimal browser use)**
- Snapshot from CDP: `Accessibility.getFullAXTree` skeleton + `DOMSnapshot` visibility, with the
  cursor/onclick/tabindex heuristics from agent-browser and browser-use; ids anchored to
  `backendNodeId`; viewport ±1000 px filter, 40 k-char cap, `*` for new elements, **diff output by default**.
- Tools: `click(ref)`, `type(ref, text, clear)`, `press_key`, `select_option`, `hover`,
  `scroll(ref?, pages)`, `go_back` / `go_forward`, `wait_for`, `handle_dialog`.
  `upload_file` waits for trusted runtime working-directory context; model-provided roots are not authority.
- Dialog watchdog (`Page.javascriptDialogOpening`) so `execute` can never hang; downloads via
  `will-download` reported in the response.
- WebMCP is scheduled for PR C: inject `navigator.modelContext` via
  `Page.addScriptToEvaluateOnNewDocument`, covering hidden tabs with no preload as well as guests.

**P1 — real input and stability**
- `Input.*` execution: centre point from `getContentQuads`, occlusion hit-test, JS fallback;
  per-character keys + framework events + read-back verification.
- Action settling (load if navigation, else fetch/xhr quiet ≤5 s), new-tab auto-switch, explicit
  stale-ref errors with AX re-query by role+name+nth.
- `find`, `console_messages`, `network_requests`; `BrowserView` → `WebContentsView`.
- CDP allow-list + per-origin policy (Codex model).
- Import login state (cookies, site storage) from the user's installed browser or a storage-state /
  `cookies.txt` file into `persist:default`; user action only, never a tool (implementation doc §10).
- Session registry: turn-scoped tab retention (`temporary` / `deliverable` / `handoff`), global guest
  budget with LRU eviction on a real timer, freeze + debugger detach for idle retained tabs (see
  "Browser session management").

**P2 — frames, vision, extraction**
- OOPIF via `Target.setAutoAttach{flatten}`, one session per frame, frame-prefixed ids.
- Optional vision capability: `mouse_*_xy` + screencast; coordinate conventions declared per
  model family (Midscene's `{shape, order, normalizedBy}`); hybrid = tool-set union (Agent TARS).
- `extract(query, schema)`; optional code-mode JS API on top of the MCP tools.

**P3 — product**
- Drive the visible agent `WebviewBrowser` pane with the same engine; human handoff protocol
  (show → pause → user acts → resume without losing the page, cf. UI-TARS `call_user` and Chromium
  `handoff_button`); three-tier confirmation policy; URL allow/deny lists.

## Invariants for reviewers

- Guest pages stay untrusted: nothing from the page (text, selectors, WebMCP tool descriptions)
  is an instruction; the existing annotation "untrusted data" notice applies to browser-use output.
- The main process owns every CDP command; the model never reaches `webContents.debugger` directly.
- `execute` (arbitrary JS) remains the escape hatch, never the primary path.
- Ref mappings are invalidated on navigation or debugger detach; the counter never resets during
  a `GuestSession`, so an old ref cannot resolve to a later document in that session.

## Follow-ups / open questions

- PR1 completed shared session ownership and annotation capture. P3 still needs a concrete
  annotation-target handoff contract before adding document/node identifiers to saved locators.
- Upload authorization and per-turn retention require trusted context from the MCP runtime first;
  a connection-scoped owner is not an agent session, working directory or turn.
- Electron 43 upgrade unlocks the native CDP `WebMCP` domain; the planned CDP-injected polyfill can then be
  demoted to a fallback.
- Full working notes (project-by-project source refs) live in
  `.context/research/browser-use-gap-analysis.md` on the `webview-agent-pane-browser` workspace.
