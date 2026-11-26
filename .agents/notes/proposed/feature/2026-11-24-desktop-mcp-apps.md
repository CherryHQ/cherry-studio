# Agent Note: MCP Apps in desktop conversations

Status: proposed

English | [中文](2026-11-24-desktop-mcp-apps.zh.md)

## Problem

Desktop Agent sessions and Assistant topics can call MCP tools, but their tool results cannot display the interactive UI declared by the originating server. Cherry Studio mobile already offers an explicit launcher and a sandboxed host. Desktop needs an inline surface with its own tool execution, conversation history and Electron isolation boundaries. See [the product issue](https://github.com/CherryHQ/cherry-studio/issues/16159).

## Proposal

### Discover and open an App

Implement the [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) with the official `@modelcontextprotocol/ext-apps` schemas and `AppBridge` compatible with the installed MCP client. Advertise `io.modelcontextprotocol/ui` with the HTML profile on supported desktop MCP connections. Interpret `_meta.ui.resourceUri` and tool visibility at discovery. Keep App-only tools in the source catalog for policy and App calls, and exclude them from model-facing discovery and invocation, including deferred tools and forwarded Agent catalogs.

The same host supports Apps built with the standard bridge described in [OpenAI's plugin UI guide](https://developers.openai.com/plugins/build/chatgpt-ui) and [Claude's MCP Apps Quickstart](https://claude.com/docs/connectors/building/mcp-apps/quickstart). OpenAI Todo speaks JSON-RPC directly. Claude Dice uses the `ext-apps` 1.x View SDK, which shares the bridge wire protocol with the 2.x SDK used by the host. Accept valid standard metadata from older servers on the existing MCP connection path. Send the complete tool input before the result, including the result's `structuredContent` and View-facing `_meta`. Preserve the existing model output path and keep View-facing `_meta` out of model context.

After a successful call to a tool with a valid App declaration, the saved result prepares the App when visible, including after a restart. The App renders inline automatically when it declares no external origins. When it declares external origins, the result asks for confirmation before the App runs. Main binds the App to the original conversation, tool call, server identity, connection configuration and resource URI. Record the binding in host-owned tool-part metadata and retain the bounded input and result needed by the View. The binding comes from the actual invocation and catalog, including in native Agent runtimes where the displayed output may be a projection. Tool result JSON cannot declare an App or provide the binding. Previously stored results without this evidence retain their ordinary presentation.

Main resolves the referenced result, rechecks the current source and its conversation policy, and reads the declared UI via the original MCP server. Require the matching URI, the MCP Apps HTML MIME type and a bounded response before loading. The App slot exposes loading and failure states and keeps the ordinary tool result available. Opening or reopening loads the UI resource without repeating the original tool call.

### Renderer and view lifetime

Project the App reference from host-owned tool-part metadata. Mount one App slot per eligible call in the shared `MessagePartsRenderer` result area, keyed by message ID and the real tool call ID. The result area stays mounted across tool-group collapse and transition from streaming to completed history. `MessageMcpTool` continues to render the ordinary tool details. Page adapters supply the owning conversation and composer actions through the message-list provider. Read-only surfaces without the launch action render the ordinary result.

The chat renderer sends the conversation, message and call identifiers to main and receives an opaque, single-use attachment reference for a local guest shell. The result area shows confirmation when required, a loading state, and a retry action on failure. The guest moves and clips with the message row. Resize changes the reserved height and preserves the running instance. The message list keeps the row mounted while its App is open, including when it scrolls out of view. Switching conversations or unmounting the surface releases the guest and its pending work.

### Host and authorization

Use a sandboxed iframe with an opaque origin inside an isolated Electron host. Serve the UI with a restrictive CSP before executing its scripts. Permit only validated HTTPS network and asset origins declared by the App, show those origins before opening, and block nested frames, navigation, popups, downloads and browser device permissions. Keep the App separate from the conversation DOM, Cherry Studio storage, preload, Node and Mini App grants. Bind bridge traffic to the expected frame and open instance, with main-process operations restricted to that App and its owning window.

The current main window disables Electron's process sandbox and `webSecurity`. Use a dedicated inline `<webview>` guest with a non-persistent partition. Main's attachment gate validates and consumes the issued reference for the owning window, selects the packaged shell, and enforces sandboxing, context isolation and `webSecurity`. The guest shell hosts the View iframe and verifies `postMessage` against its live frame. A narrow, main-frame-only relay connects that shell to the main-owned `AppBridge`. The View receives only the standard JSON-RPC bridge. Main serves the resource to the guest separately from the chat renderer.

Validate `resourceDomains` for assets and `connectDomains` for direct network requests separately. Apply the declarations on the matched `resources/read` content item before the HTML executes. Claude Dice imports its View SDK from the declared `https://unpkg.com` asset origin. Allow the iframe to dispatch HTML form `submit` events so OpenAI Todo can handle the event and call an MCP tool. Enforce CSP `form-action 'none'` to block native form submissions.

Send the invocation's input and result after the App handshake, along with locale, size and theme. Register explicit `AppBridge` handlers for `tools/call` and supported resource listing and reads. Route them through the originating connection in `McpRuntimeService`, with the current conversation binding, server policy and relevant resource permissions checked for each request. A tool call requires App visibility, valid arguments and explicit consent for the exact tool and arguments through the host's tool approval path. Record the decision and outcome on the originating conversation. Recheck the source and policy after consent. This consent is independent of the model's auto-approval settings. Display and confirm external HTTPS links before opening them. Stage user-facing text in the initiating composer only after user confirmation. Advertise only the bridge capabilities that the host implements.

Keep the resource's URI, MIME type and reviewed network origins available to host UI before first render. The [MCP Security Inspector](https://github.com/CherryHQ/cherry-studio/issues/16128) can consume this information when it exists. The inspector's report and trust policy need their own implementation.

Close the bridge and cancel pending approvals or requests when the surface unmounts, the conversation changes, the owning window closes, or the source is revoked. Requests that may already have reached the server surface an uncertain outcome when appropriate and are never replayed by the App host.

### Presentation and additional capabilities

Report `inline` as the supported display mode. Bound the height of the View as it reports size changes and update host context when the container, theme or locale changes. Keep the result available when the View fails to initialize or needs a display mode or capability the host does not offer.

Treat full screen and picture-in-picture as separate standard display capabilities. [Claude's side panel](https://claude.com/docs/connectors/building/mcp-apps/display-modes), [tools registered by the live View](https://claude.com/docs/connectors/building/mcp-apps/app-tools), global entry points, nested websites, sandbox origins tied to vendor domains, and downloads require separate product and permission decisions. Exposing tools registered by the View to the model would require a live registry and separate lifecycle. Defer `ui/update-model-context`, automatic turns and persistent App state.

### Delivery

1. Wire tool discovery and provenance in `McpCatalogService`, the Assistant adapter and the Agent MCP forwarding and projection paths. Verify visibility at discovery and invocation and test durable source binding. Advertise Apps support with the working host.
2. Add the shared desktop App slot, isolated Electron View and `AppBridge`. Verify resource validation, CSP, exact input and result delivery, sizing, teardown and reopening.
3. Connect App calls, links and drafts to the desktop approval flow and conversation records. Run the Todo and Dice samples unchanged in Electron. Verify consent, revocation and cancellation with a real MCP fixture, then check isolation in a packaged build.

## Alternatives considered

- Reuse the desktop Mini App runtime for the whole feature. MCP Apps are bound to a conversation tool result and use a separate protocol. Reuse suitable Electron isolation primitives while keeping installed Mini App grants out of this path.
- Render App HTML inside the chat document or route bridge calls through a generic MCP client. A separate host and explicit routing keep third-party code isolated and make conversation and source policy enforceable for each request.
- Use the existing Mobile WebView shell directly. Its interaction and permission decisions are a reference. Electron owns frame identity, request policy and native capability handling on desktop.
- Emulate the legacy ChatGPT widget runtime. [Pizzaz](https://github.com/openai/openai-apps-sdk-examples/tree/main/pizzaz_server_node) uses the `openai/outputTemplate` alias and `text/html+skybridge`. The host accepts standard declarations and the standard HTML MIME type. It does not inject `window.openai` or recognize OpenAI-only launch metadata.

## Acceptance criteria

- AC1 — A real MCP server that gates UI on extension negotiation exposes its launch tool to the model and its App-only tool to the View. Existing non-App tools retain their ordinary behavior. (verification: unit | Electron)
- AC2 — An Assistant topic and Agent sessions on Claude Code, Pi and Pi Durable open the App inline from a completed tool result and display the original input and result. Reopening after restart fetches UI without a second invocation. (verification: Electron)
- AC3 — Invalid or missing UI HTML, a forged launch binding, and a removed, disabled or reconfigured source leave the ordinary tool result available and load no App. Identical URIs on different servers stay bound to their respective origins. (verification: unit | Electron)
- AC4 — The View cannot access Cherry Studio DOM, storage, preload or browser device permissions. Undeclared network destinations, navigation and messages from another frame or closed instance are rejected. (verification: packaged artifact)
- AC5 — An approved same-server App tool call receives its result in the View and leaves a record in the conversation. Denied, disabled, cross-server, model-only and post-revocation calls send no tool request. Leaving the conversation during consent clears the pending action. (verification: unit | Electron)
- AC6 — Links and composer messages require confirmation in the host. Confirmed text becomes a draft for the user to edit and send. (verification: renderer | Electron)
- AC7 — The same App launch contract works with stdio, Streamable HTTP and SSE. An unmodified upstream reference App completes its supported interaction in Electron. (verification: unit | Electron)
- AC8 — The unmodified [OpenAI Todo Quickstart](https://developers.openai.com/plugins/build/app-quickstart) renders its initial data, then adds and completes a task through approved MCP tool calls. Native form submissions send no network request. (verification: Electron)
- AC9 — The unmodified [Claude Dice Quickstart](https://claude.com/docs/connectors/building/mcp-apps/quickstart) loads its declared module, displays the initial dice, and rolls again with the original sides and count after approval. With the asset origin excluded, the module is blocked and the ordinary result stays visible. (verification: Electron)
- AC10 — Visible saved results render Apps without external origins automatically, including with tool details collapsed. Apps with external origins wait for confirmation. The open View preserves its state across tool-group collapse, resize, and scrolling out of view and back. (verification: renderer | Electron)
- AC11 — A legacy-only ChatGPT widget renders the ordinary tool result without a launcher, and a standard View has no injected `window.openai`. (verification: renderer | Electron)

## Risks

Current Assistant results retain more protocol data than some Agent projections. Verification must exercise the actual invocation and persisted part in each supported runtime, including after restart. App compatibility depends on the supported bridge capabilities and Electron CSP behavior. Use a real MCP fixture in development and a packaged Electron build to check the isolation boundary.
