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

`GuestSession` is the only debugger owner inside this module. It shares concurrent
initialization, bounds commands, interrupts blocked requests when dialogs open,
and rejects commands outside the CDP allow-list. External debugger attachments
are left alone.

Snapshots combine main-frame AX and DOM data. References remain stable within a
live document and are never reused during a session, including after navigation
or debugger detachment. Navigation during capture discards the result. Large AX
trees omit DOM capture and all control values. Output is capped at 40,000
characters and includes an untrusted-data notice. Scoped snapshots do not change
the full-page diff baseline.

Annotation capture preserves the existing isolated-world selector resolution,
Shadow DOM traversal, request budgets, cancellation, and form-value suppression.

The MCP controller adapter, input tools, real agent-turn identity, retained-tab
freezing, WebMCP, and browser-data import belong to subsequent PRs. This module
does not expose tool schemas for those future consumers.
