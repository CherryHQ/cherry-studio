# Native integrations

[File associations](external-app/README.md) use a cross-platform Node-API addon.

[System speech](system-speech/README.md) provides the macOS and Windows voice helpers.

## Selection Assistant native panel

`selection-panel/darwin/selectionPanel.mm` is a macOS Node-API addon for the action result window and
the selection agent window. It also supplies the Quick Assistant drag cursor.
`selection-panel/win32/selectionPanel.cpp` supplies the Windows Quick Assistant drag cursor.
Other panels keep Electron's default behavior. `SelectionService` and `SelectionAgentWindowService` configure each of
their windows through `onWindowCreatedByType`, including pool warmup, and move it
to the invoking Space **before** showing it on every reuse. The registry disables
native fullscreen for both window types.

Electron 44's `ElectronNSPanel.setCollectionBehavior:` forces `CanJoinAllSpaces`.
The addon intercepts that setter, forwarding unmarked windows to the original
implementation and applying `FullScreenAuxiliary` without `CanJoinAllSpaces` to
marked action windows. It never replaces the window's class: doing so removes
AppKit's KVO subclass and can crash during observer cleanup on close. The hook
is restored during Node environment cleanup. Pending moves use weak window
references and a per-request token so closing or rapidly reusing a window is safe.

Agent windows also route minimizing to a capsule. Electron's `minimize` event fires
after the fact and cannot be cancelled, so the addon overrides `performMiniaturize:`
and `miniaturize:` on the panel class alone (other Electron windows keep theirs).
Marked agent windows hand the yellow light, Cmd+M, and title-bar double clicks to
one JavaScript handler, through a Node-API thread-safe function, as the window's
native handle; unmarked panels minimize as usual.

Two more calls serve the capsule's restore:

- `isFullScreenAppInFront(displayBounds)` takes the frontmost normal-level window
  that another app shows on the display, from `CGWindowListCopyWindowInfo`, and reads
  `AXFullScreen` from that app's window with the same frame, with a short messaging
  timeout. It skips Cherry's own windows because clicking a capsule activates Cherry
  first. The window list's owner, layer, and bounds need no Screen Recording access;
  without Accessibility access it returns false.
- `animateWindow()` animates a window's frame and opacity with
  `NSAnimationContext` and resolves when the animation ends. Electron's animated
  `setBounds` runs AppKit's resize synchronously, which would block the main thread.

This relies on Electron's internal panel class. Revalidate on Electron upgrades;
Node-API ABI stability does not guarantee AppKit/Electron behavior compatibility.

### Quick Assistant drag cursor

`enableDragCursor(handle)` opts in only the Quick Assistant panel. The addon
sets the closed-hand cursor on a plain left press in a drag region and otherwise
forwards `sendEvent:` to Electron first, then sets the AppKit open-hand cursor for
mouse-move/cursor-update events where Chromium's content-view hit test returns
`nil` inside the view (its native draggable-background result). Input fields,
buttons, and other `no-drag` regions retain Chromium's cursor handling. Hidden
or mouse-passthrough windows do not claim the cursor. Window movement remains
entirely native; there is no renderer region mirror or per-move IPC.

A common-run-loop timer exists only during a drag to maintain the closed hand and
detect release even when the window server consumes mouse-up. Mouse-up also
restores hover feedback after Electron processes it. Releasing, hiding, closing,
or enabling mouse passthrough stops the timer; its window reference is weak.

The hook is scoped to marked panels and restored during Node environment cleanup;
per-window state uses associated objects rather than retained window pointers.
Revalidate this Chromium hit-test contract on Electron upgrades. Verify the actual
AppKit cursor, not just computed CSS, over toolbar gaps, text, buttons, window
edges, and after hiding/reopening the panel.

On Windows, `enableDragCursor(handle, enabled)` subclasses only the opted-in
window and its same-thread child HWNDs. Chromium's root `WM_NCHITTEST` result of
`HTCAPTION` selects the open hand; client controls and resize edges keep Electron's
handling. Quick Assistant's existing view state enables the hand only in bar and
quick-panel views; conversation panels retain the default cursor, including their
titlebar. Disabling clears any hand cursor and drag timer immediately. macOS keeps
its existing one-argument creation opt-in. The child subclasses apply hover feedback after Chromium processes a
mouse move. Native caption dragging remains with Windows, with a timer maintaining
the closed hand during its modal move loop. Release, cancellation, hiding,
minimizing, mouse passthrough and destruction clear the dragging state. Subclasses
are removed on HWND destruction or Node environment cleanup.

The Windows addon embeds Chromium's [grab/grabbing cursor resources](selection-panel/win32/cursors/README.md)
with their license. Check the actual `GetCursorInfo` image through hover, press,
native movement and release over the input bar, verify the conversation titlebar
keeps the default arrow, and check no-drag inputs, buttons and resize edges.

### Build and validation

Windows fractional-DPI window geometry is a known upstream limitation: a renderer
child can exceed its HWND client area and clip a normal border, and bounds get/set
round trips can grow the window. Standalone Electron 45.2.2 reproduces this at 175%
DPI without the addon. Cursor handling does not alter the existing sizing logic
or compensate for this with an inset border or negative offset.

`selection-panel/build.js` and `binding.gyp` stay at the module root. Platform
implementations live under `darwin/` and `win32/`; Windows cursor resources and
their license stay under `win32/cursors/`. Build watch inputs include only the
host platform sources, so Windows resource changes do not invalidate macOS builds.

Electron Vite builds the host addon automatically on macOS and Windows; `scripts/packaging/before-pack.js`
rebuilds for the packaging target (`arm64` or `x64`). Xcode Command Line Tools
are required on macOS. Windows requires MSVC and the Windows SDK, including ARM64
tools for an ARM64 target; node-gyp uses the pinned Electron headers and delay-load
hook. Linux skips the addon. macOS headers come from the pinned `node-api-headers`
development dependency, without downloading Electron headers.

Output: `resources/binaries/<platform>-<arch>/selection-panel.node`. The existing
resource unpacking and per-target binary filters include only the target addon.

```sh
node native/selection-panel/build.js arm64
node native/selection-panel/build.js x64
```

Manually verify action windows over Cherry and another app's fullscreen Space,
desktop switching, pinning, reuse, closing, and multiple displays. For agent windows,
also verify that the yellow light and Cmd+M collapse a started window, that both are
disabled on the compose bar, that restoring over a full-screen app keeps IME
candidates visible, and that the main and action windows still minimize to the Dock. Electron flags
alone cannot prove Space placement. Check a packaged build as well to validate
loading from unpacked asar resources.
