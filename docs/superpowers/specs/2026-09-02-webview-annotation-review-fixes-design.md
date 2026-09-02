# Webview Annotation Review Fixes

## Context

PR #17842 adds browser element annotations. Review identified two correctness issues introduced by the PR and one missing contract test:

1. Accessibility capture resolves selectors with `Runtime.evaluate` in the inspected page's default execution context. A page can replace DOM APIs such as `querySelector` and redirect the lookup.
2. `WebviewAnnotationControls` reattaches its guest bridge when presentation-only target data changes. Effect cleanup disables annotation mode and closes the guest editor, discarding an unsaved draft.
3. Markdown escaping is implemented but lacks a focused test that would fail if escaping regressed.

The reported pooled-WebView navigation-listener issue is not part of this work because the existing pool and React Activity lifecycles already re-create those effects when a background WebView is restored.

## Goals

- Resolve accessibility targets without using page-overridable DOM methods.
- Preserve an open annotation editor across locale, label, and theme updates.
- Add contract-focused regression coverage for both fixes and Markdown escaping.
- Keep the existing IPC schemas, persisted data shape, and component API unchanged.

## Non-goals

- Replacing the selector format or annotation storage model.
- Reworking pooled WebView lifecycle management.
- Adding new annotation features or public component configuration.

## Design

### Isolated accessibility selector resolution

`WebviewService.captureDocumentAccessibility` will obtain the main frame through `Page.getFrameTree`, create a named isolated world for that frame with `Page.createIsolatedWorld`, and retain the returned execution-context ID for the capture operation.

Each annotation lookup will continue to use the existing selector and shadow-root traversal expression, but `Runtime.evaluate` will receive that isolated context ID. The isolated world shares the inspected document while keeping JavaScript globals and DOM prototypes separate from the page's main world, so page scripts cannot replace the resolver's `document.querySelector` or `ShadowRoot.querySelector` implementations.

Context creation belongs to the same bounded capture setup as enabling the Runtime and Accessibility domains. A missing frame, missing execution context, navigation invalidation, debugger failure, or deadline expiry will keep using the existing `capture_failed` or `timeout` result paths. Existing object-group release, domain disable, debugger detach, URL validation, and timestamp validation remain unchanged.

The alternative is a resolver composed entirely from CDP DOM commands. That would provide a similarly page-independent lookup for ordinary DOM nodes, but preserving the current selector semantics across nested shadow roots would require substantially more traversal and node-lifetime bookkeeping. An isolated world is the smaller change and directly addresses the reviewed trust-boundary defect.

### Stable annotation bridge attachment

`WebviewAnnotationControls` will separate bridge ownership from changing target presentation data:

- The latest target object will be stored in a ref and read when replacing the main-process snapshot.
- The bridge attachment effect will depend only on WebView identity/readiness, host activity, and stable callbacks tied to the target identity.
- Locale and theme will continue to flow through the existing configuration effect without detaching the bridge.
- Changing only a target label or locale will therefore update subsequent messages without sending `set_enabled: false`.
- A real ownership transition, such as changing the target ID, deactivating the host, or unmounting the WebView, will still run cleanup and disable annotation mode.

This preserves state ownership at the current component boundary and avoids a new global channel or public API.

### Markdown escaping coverage

A focused formatter test will use annotation fields containing Markdown metacharacters and assert the promised escaped Markdown output. The assertion will describe the output contract rather than mirror the implementation algorithm.

## Test Strategy

Tests will be written before the corresponding implementation changes:

1. Main-process service test: simulate CDP responses and assert that capture creates an isolated world for the main frame and passes its execution-context ID to selector evaluation.
2. Renderer component test: enable annotation mode, rerender the same target ID with changed label and locale data, and assert that no disable command is emitted during the presentation update.
3. Formatter test: format annotation content containing Markdown control characters and assert that headings, target text, selected text, and accessibility fields remain literal.

After targeted tests pass, run repository lint and the CI-equivalent lint gate. Broader full-suite execution is unnecessary because the changes stay within the existing Webview service, one renderer bridge component, and a pure formatter.

## Risks and Mitigations

- An isolated execution context can be invalidated by navigation during capture. Existing post-capture URL checks and per-annotation failure mapping prevent stale accessibility data from being persisted.
- Stabilizing the attachment effect could expose stale target metadata. Reading the current target from a ref at message time keeps metadata fresh without changing bridge ownership.
- CDP command mocks may accidentally test call shape only. The service test will assert the security-relevant contract: the resolver evaluation must use the context returned by `Page.createIsolatedWorld`.
