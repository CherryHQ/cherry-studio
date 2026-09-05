# WebView Annotation Review Fixes Design

## Status

Approved implementation scope for PR #17842 at head `dda19af3a3c90d0b8a1ff31e77fda0066fa5806a`.
This design covers the confirmed runtime defects plus the accepted accessibility and ownership cleanups. The semantic-theme follow-up and disconnected-editor product behavior are explicitly excluded.

## Goals

1. Make annotation input ownership reliable on untrusted guest pages, including selecting the outer element of a full-viewport iframe.
2. Prevent one Escape keypress from both cancelling annotation interaction and triggering a host shortcut.
3. Do not report WebView command delivery as successful until Electron resolves `WebviewTag.send()`.
4. Keep editable-page text out of annotation locators for all supported editable semantics.
5. Make region snapshots schema-valid on long pages without corrupting page coordinates, and bound locator construction to the published result limit.
6. Track pins and editor anchors while relevant CSS animations or transitions move their targets.
7. Re-establish document-session ownership when `WebviewService` restarts while a guest survives.
8. Activate a Mini App pane when keyboard focus enters its toolbar.
9. Restore the annotation count to the toggle's accessible name.
10. Narrow the shared annotation contract and co-locate the renderer module with its sole Mini Apps owner.

## Non-goals

- Do not enable preload execution in iframe subframes or traverse cross-origin iframe contents.
- Do not add a global UI or input channel.
- Do not persist annotation sessions outside `WebviewService` lifecycle ownership.
- Do not silently clamp long-page region coordinates to the old 10,000,000 limit.
- Do not change the overlay palette in this patch series.
- Do not choose what happens to an editor draft after its DOM target disconnects.
- Do not refactor unrelated WebView, Mini App, lifecycle, or shared-type code.

## Considered approaches

### Guest input ownership

1. Keep adding late `document` capture listeners. Rejected because a guest `window` capture listener remains upstream and a full-viewport iframe still owns its inner-document events.
2. Enable preload in all subframes. Rejected because it expands the security surface and is unnecessary when only the outer iframe element is promised.
3. Install an early preload-owned arbiter and use a top-document input shield while selection is enabled. Chosen because it establishes one input owner without entering iframe contents. The shield is temporarily excluded from hit testing so `elementFromPoint()` resolves the underlying top-document element, including `<iframe>`.

### Long-page coordinates

1. Clamp page `x/y` to 10,000,000. Rejected because it stores a false location and renders the pin at the wrong page position.
2. Reject annotations beyond 10,000,000. Valid but needlessly removes support for pages Chromium can display.
3. Separate viewport-anchor bounds from page-coordinate bounds and accept finite safe-integer page coordinates. Chosen because it preserves real geometry while retaining explicit validation.

### Session restart

1. Keep `AnnotationSession` alive after service stop. Rejected because listeners and queues would outlive their lifecycle owner.
2. Store session IDs in hidden global state. Rejected because it creates a second owner and survives without independently useful semantics.
3. Create a new service-owned session and announce it immediately to already-loaded guests. Chosen because restart deliberately creates a new session and the existing `start_session` protocol already resets guest and renderer state.

### Animated target tracking

1. Poll every visible annotation forever. Rejected because it imposes permanent frame work on static pages.
2. Refresh only at animation end. Rejected because pins remain visibly detached throughout longer animations.
3. Run requestAnimationFrame only while a relevant target or composed ancestor has a running or pending animation, with start/end/cancel events providing wake-up and final refresh. Chosen for correctness with bounded activity.

## Design

### 1. Preload input arbiter

`WebviewAnnotationController` installs its top-level capture handlers when it is constructed, before guest scripts run. Handlers return immediately unless the current session/configuration owns the interaction.

When selection is enabled, the closed overlay contains a transparent, viewport-sized input shield below annotation pins. Pointer events target this shield rather than the page or iframe document. The controller temporarily disables the shield for top-document hit testing, then restores it. Pin/editor overlay paths remain distinguishable and keep their existing commands.

The preload entry sends host key shortcuts only when the controller reports that it did not consume the key. Escape is consumed while cancelling an active marquee, editor, or selection mode; otherwise it retains its existing host-shortcut behavior. Disabling or disposing the controller removes the shield and all permanent listeners.

Editable targets remain pass-through according to the privacy policy below.

### 2. Command delivery

The renderer session hook exposes an asynchronous command helper that awaits `WebviewTag.send()`. User actions commit local state only after delivery resolves:

- toggle changes `enabled` after success;
- clear changes count/editor state and closes confirmation after success;
- save/delete keep the editor available after failure;
- snapshot requests reject immediately and clear their timeout when delivery fails.

Lifecycle synchronization commands remain explicit fire-and-forget calls to the same rejection-safe helper. They do not optimistically mutate user-facing state.

### 3. Privacy predicate

One `isSensitiveEditable()` predicate is shared by locator text summarization and composed event-path checks. It recognizes native form controls, `HTMLElement.isContentEditable`, document `designMode`, inherited contenteditable behavior, and whitespace-tokenized ARIA textbox/searchbox/combobox roles. Ancestor and descendant scans use the same predicate, including open shadow roots.

### 4. Region contract and work bound

Shared schemas use separate concepts for viewport anchor coordinates and page coordinates. Page `x/y` must be finite safe integers; extents remain positive and bounded. A single producer helper rounds and validates the page rectangle before it enters annotation state.

The renderer distinguishes a malformed correlated snapshot from unrelated guest messages. A malformed response for the current session/request rejects that operation immediately instead of waiting for the timeout.

Region locator creation preserves candidate order and skips null locators, stopping as soon as the cross-process `regionElements` limit is reached.

### 5. Position tracking

Position tracking observes the actual annotated/editor elements and their composed ancestors. An initial scheduled update detects animations already in progress. Animation and transition lifecycle events wake the tracker for animations that begin later. While relevant animations are running or pending, each frame updates pins, highlights, and the editor anchor. The final frame runs after completion or cancellation, then polling stops.

All existing observer, overlay removal, reset, and dispose paths cancel pending frames and clear animation-tracking state.

### 6. Main-process session re-handshake

`AnnotationSession` owns an idempotent announcement operation used by `dom-ready` and by service initialization. `WebviewService` distinguishes WebContents discovered during startup/restart from newly created WebContents. An already-loaded surviving guest receives the new `start_session` immediately; a loading or newly created guest remains gated by `dom-ready`.

The new session ID becomes Main's only accepted export identity. Guest state reset and renderer configuration continue through the existing message protocol.

### 7. Pane focus and accessibility

`MiniAppPane` activates on React `focus` capture at the pane boundary while retaining the native WebView focus listener for pooled WebViews outside that subtree.

When annotations exist, the toggle's accessible label combines the localized enable/disable action with the existing localized count string. The visual Badge becomes assistive-technology-hidden to prevent duplicate announcement. The zero-count accessible name remains unchanged.

### 8. Ownership cleanup

Main-only accessibility and page export limits move into `annotationExport.ts`. Schemas used only to compose the public host/guest schemas become module-private; their inferred types remain exported only where a real cross-process consumer uses them. The unused snapshot alias is removed.

The complete `WebviewAnnotationControls` directory, including tests, moves under `src/renderer/pages/miniApps/components/`. `MinimalToolbar` imports it locally. This is a pure ownership move performed after behavior changes so rename detection does not hide logic review.

## Error handling

- WebView send rejection is observable by the initiating renderer action and never treated as success.
- A correlated malformed snapshot rejects immediately; unrelated malformed messages remain ignored and logged at the existing diagnostic level.
- Input arbitration fails closed only while annotation selection owns the page; outside that state guest interactions and host shortcuts preserve current behavior.
- Session announcement failure leaves the Main session unready, so exports reject as stale rather than crossing documents.

## Test strategy

Each runtime fix follows red-green TDD with the nearest existing suite:

- preload controller: hostile capture listeners, full-viewport iframe hit testing, editable pass-through, privacy variants, long-page coordinates, bounded locator construction, animation-driven movement, cleanup;
- preload entry: Escape ownership versus `MINI_APP_KEYDOWN_CHANNEL` relay;
- renderer session hook/component: rejected sends, immediate snapshot failure, confirmation/editor state, accessible toggle count;
- Mini App page/pane: keyboard focus activates the secondary pane and changes host ownership;
- AnnotationSession/WebviewService: stop/start with a surviving loaded guest, new session announcement, old-session rejection;
- annotation export/shared schema: moved limits and page-coordinate boundaries.

After focused suites pass, run repository lint/type/i18n validation because the shared cross-process contract changes. Run only the affected project tests rather than the global suite unless a cross-project failure cannot be isolated. Use the tracked Electron instance for a bounded manual check of selection, iframe selection, Escape in fullscreen, split-pane focus, and animated-target positioning.

## Implementation order

1. Renderer send-delivery regression tests and fix.
2. Preload input ownership, iframe, Escape, and privacy tests and fixes.
3. Region contract/work-bound tests and fixes.
4. Animated position-tracking tests and fix.
5. Main session restart tests and re-handshake fix.
6. Pane focus and annotation-count accessibility tests and fixes.
7. Shared-contract narrowing.
8. Renderer ownership move.
9. Focused verification, lint/type/i18n checks, and tracked Electron smoke test.

## Design self-check

- Every behavior maps to a confirmed review issue and a named regression test.
- Cross-origin iframe content remains inaccessible; only its top-document element is selectable.
- No session state survives outside its lifecycle owner.
- Geometry is preserved rather than silently altered.
- Static pages do not incur permanent animation polling.
- Theme and disconnected-editor product semantics remain outside scope.
- Architecture cleanups do not introduce new public APIs or speculative reuse.
