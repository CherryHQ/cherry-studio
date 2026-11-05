# Native integrations

[File associations](external-app/README.md) use a cross-platform Node-API addon.

[System speech](system-speech/README.md) provides the macOS and Windows voice helpers.

## Selection Assistant native panel

`selection-panel/selectionPanel.mm` is a macOS Node-API addon for the action result window and
the selection agent window. It also supplies the Quick Assistant drag cursor.
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

### Build and validation

Electron Vite builds the host addon automatically on macOS; `scripts/packaging/before-pack.js`
rebuilds for the packaging target (`arm64` or `x64`). Xcode Command Line Tools
are required. Windows and Linux skip the addon. Headers come from the pinned
`node-api-headers` development dependency, without downloading Electron headers.

Output: `resources/binaries/darwin-<arch>/selection-panel.node`. The existing
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
