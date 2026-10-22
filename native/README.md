# Selection Assistant native panel

`darwin/selectionPanel.mm` is a macOS Node-API addon for the action result window. The
toolbar and other panels keep Electron's default behavior. `SelectionService`
configures each action window through `onWindowCreatedByType`, including pool
warmup, and moves it to the invoking Space **before** showing it on every reuse.
The registry disables native fullscreen for action windows.

Electron 44's `ElectronNSPanel.setCollectionBehavior:` forces `CanJoinAllSpaces`.
The addon intercepts that setter, forwarding unmarked windows to the original
implementation and applying `FullScreenAuxiliary` without `CanJoinAllSpaces` to
marked action windows. It never replaces the window's class: doing so removes
AppKit's KVO subclass and can crash during observer cleanup on close. The hook
is restored during Node environment cleanup. Pending moves use weak window
references and a per-request token so closing or rapidly reusing a window is safe.

This relies on Electron's internal panel class. Revalidate on Electron upgrades;
Node-API ABI stability does not guarantee AppKit/Electron behavior compatibility.

## Build and validation

Electron Vite builds the host addon automatically on macOS; `scripts/packaging/before-pack.js`
rebuilds for the packaging target (`arm64` or `x64`). Xcode Command Line Tools
are required. Windows and Linux skip the addon. Headers come from the pinned
`node-api-headers` development dependency, without downloading Electron headers.

Output: `resources/binaries/darwin-<arch>/selection-panel.node`. The existing
resource unpacking and per-target binary filters include only the target addon.

```sh
node native/darwin/build.js arm64
node native/darwin/build.js x64
```

Manually verify action windows over Cherry and another app's fullscreen Space,
desktop switching, pinning, reuse, closing, and multiple displays. Electron flags
alone cannot prove Space placement. Check a packaged build as well to validate
loading from unpacked asar resources.
