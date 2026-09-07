# Browser session engine

`BrowserSessionService` owns the registry and the debugger leases used by browser
consumers. Resolve it through `application.get('BrowserSessionService')`.

- `managed` guests are engine-created tabs. Their controller supplies the close
  callback. A five-minute idle sweep and per-owner/global budgets reclaim
  temporary tabs; retained tabs are protected according to their retention mark.
- `borrowed` guests belong to the user or another feature. Releasing the last
  lease detaches the debugger; the engine never closes or freezes these pages.
- Ownership is fixed when a guest enters the registry. Every acquisition needs a
  matching release. The service releases all resources on stop.

Controllers and guests are dynamic children of the lifecycle service. Server
and controller shutdown share a completion promise across repeated calls;
disconnected servers remain tracked until cleanup and active tool handlers settle.
Service shutdown awaits these children before releasing remaining guest leases.

`GuestSession` is the only debugger owner inside this module. It shares concurrent
initialization, bounds commands, interrupts blocked requests when dialogs open,
and rejects commands outside the CDP allow-list. External debugger attachments
are left alone. `send()` infers method-specific inputs and results from the official
`devtools-protocol` types, restricted to the runtime allow-list. Parameterless commands
can omit their arguments; pass `undefined` to provide command options. Protocol types
describe the response envelope, not arbitrary JavaScript values returned by a page.
Consumed events likewise use the official `ProtocolMapping.Events` discriminated union;
unhandled events and child debugger sessions do not enter the main-frame event stream.

Actions and snapshots use separate `async-mutex` locks so an action can capture a
snapshot without locking itself out. Synchronous guest disposal cancels queued
work and interrupts pending commands; it does not await arbitrary running callbacks
or promise that Chromium has cancelled an already-dispatched command.

Snapshots combine main-frame AX and DOM data. References remain stable within a
live document and are never reused during a session, including after navigation
or debugger detachment. Navigation during capture discards the result. Large AX
trees omit DOM capture and all control values. Output is capped at 40,000
characters and includes an untrusted-data notice. Scoped snapshots do not change
the full-page diff baseline.

Element actions check that a resolved node is still connected before performing effects.
If it is gone, `recoverRef()` makes one main-document AX query using the full role/name
recorded during observation. Recovery requires uniqueness both then and now. Ambiguous,
unnamed, cross-document or already-referenced replacement targets remain `stale_ref`.
The synchronous `resolveRef()` lookup stays side-effect-free; failed actions are never replayed.

`find()` queries exact accessible role/name and returns at most 100 refs, including offscreen
elements, without replacing the snapshot diff baseline. Managed queries use the same focus
emulation as actions to let hidden-page AX updates complete. Managed sessions record console output,
uncaught exceptions and network request summaries in owned `BrowserInspection` buffers.
Each buffer holds 200 entries; page text fields cap at 2,000 characters and returned entry arrays
at 40,000 serialized characters. Navigation preserves recent history; detach/disposal clears it.
Reads can clear matching console levels or all requests without affecting network settling.
Request headers, bodies and console remote-object handles are never retained in these buffers.

Annotation capture preserves the existing isolated-world selector resolution,
Shadow DOM traversal, request budgets, cancellation, and form-value suppression.

The MCP adapter and input tools live in `mcp/` and `actions/`. The factory calls
`BrowserSessionService.createMcpServer()`; it has no direct feature import.
See [Browser MCP server](./mcp/README.md) for tools, outputs and ownership limits.

`AgentBrowserRegistry` binds verified renderer guests to their actual Agent Sessions. Pane MCP
controllers borrow those guests and share actions with the standalone controller. Browser settings
controls Agent access; bindings and manual browsing survive control-off. The Agent built-in tool catalog
exposes a browser group opt-out. Old browser MCP bindings are excluded from the Agent server set;
Browser settings owns per-tool ask/allow/deny permissions. Runtime approval gates enforce these
permissions, and dispatch rechecks denial before executing queued actions. Ordinary pages use
`persist:agent-browser` and permit public/LAN/loopback HTTP(S); preview/artifact profiles stay separate.
The session service owns ordinary guests' popup handlers across all host windows. HTTP(S) popup
links navigate an Agent-bound guest in place or open a standalone browser tab. Agent attachment and
control revocation do not replace this handler; shutdown removes the routing along with history tracking.
History is SQLite-backed through `BrowserHistoryService`. The session service tracks ordinary webview
lifetimes independently of Agent bindings; history entries reopen in browser tabs sharing the same partition. Import readers live in `import/` and
run as tracked, cancellable operations of this lifecycle service. Cookie decryption uses per-import
keys from macOS Keychain, Windows current-user DPAPI or Linux Secret Service/KWallet. Helpers are
bounded, cancelled and awaited; keys are not persisted. Windows app-bound cookies and partitioned
cookies remain unsupported, with per-reason counts. See the
[import support matrix](../../../../v2-refactor-temp/docs/ai/browser-use-implementation.md#127-delivered-import-support-and-validation).
Uploads, retained-tab freezing and WebMCP remain follow-ups.

Debugger initialization is shared by its waiting callers. When the last caller aborts or
times out, initialization stops and detaches; cancellation by one caller leaves other
callers running. Annotation captures reuse their document's isolated context and drop
it on navigation, context destruction or detach. Snapshot link destinations use the
same credential/data-URL sanitization as page URLs. Same-document navigation preserves
the document identity and refs.
