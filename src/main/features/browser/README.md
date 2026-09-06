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

Annotation capture preserves the existing isolated-world selector resolution,
Shadow DOM traversal, request budgets, cancellation, and form-value suppression.

The MCP adapter and input tools live in `mcp/` and `actions/`. The factory calls
`BrowserSessionService.createMcpServer()`; it has no direct feature import.
See [Browser MCP server](./mcp/README.md) for tools, outputs and ownership limits.

Real agent-turn identity, uploads, retained-tab freezing, WebMCP and browser-data
import remain follow-ups.
