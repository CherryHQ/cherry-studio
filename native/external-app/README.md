# External application associations

`external-app.node` exposes asynchronous `list(absolutePath)` and
`open(absolutePath, applicationId)` functions through Node-API 8. It is loaded by
Main, not a separate executable or workspace package. The shared bridge runs
discovery and launch calls off the JavaScript thread, with a fresh thread for each
operation so Windows Shell COM owns its STA apartment. Linux GTK icon resolution
runs in the completion callback on the host's main thread. Calls finish before their async
worker is released; native crashes are not isolated from the host process.

macOS uses NSWorkspace file URLs, Windows uses SHAssocEnumHandlers and
IAssocHandler::Invoke, and Linux uses GIO content types and GAppInfo. Opening
re-enumerates the file's current handlers and rejects missing identities. The
list includes default metadata separately; Main removes its duplicate menu row,
hashes application identities for the renderer, and owns caching and dangerous
extension policy. Directory editors and terminals remain in the existing service.

Applications declare support through OS registrations. Results do not prove
actual parsing compatibility, and successful activation does not prove rendering.
Application icons are best effort: macOS uses NSWorkspace to rasterize each
application's icon as a 32-pixel PNG. Windows uses the handler's declared icon
location and resource index, or the AppsFolder Shell item for packaged apps;
WIC encodes the result as PNG. Linux resolves themed icons through the host's
already-loaded GTK 3 or GTK 4, then GdkPixbuf converts theme and absolute-file
icons (including SVG) to PNG. Missing or corrupt icons leave the application
available with the menu fallback. Windows executable icons retain an Electron
fallback when native extraction fails.

## Build

Install repository dependencies first. Electron Vite prepares the host addon on
startup; the packaging hook rebuilds for the target architecture. Both write
`resources/binaries/<platform>-<arch>/external-app.node`. The existing resource
unpacking, foreign-platform filters and native code signing apply.

```sh
node native/external-app/build.cjs
node native/external-app/build.cjs x64
node native/external-app/build.cjs arm64 --packaging
```

Development uses node-gyp and node-addon-api. macOS needs Xcode Command Line
Tools. Windows needs MSVC and the Windows SDK, including ARM64 tools when targeting
ARM64; node-gyp uses the pinned Electron headers and its delay-load hook. Linux
needs a C++17 compiler, pkg-config and the GLib/GIO and GdkPixbuf development headers
(`libglib2.0-dev libgdk-pixbuf-2.0-dev` on Debian/Ubuntu). SVG icons need the desktop's
GdkPixbuf SVG loader (`librsvg2-common`). GTK is not linked into the addon: themed
icons reuse the host's loaded GTK major version to avoid mixing GTK 3 and GTK 4.
macOS and Linux use Node-API rather than V8 APIs,
so their host Node headers do not tie the addon to a Node module ABI version.

Linux packaging builds in an Ubuntu 22.04 Docker image to bound the glibc baseline.
Docker and foreign-architecture emulation are required for ARM64 builds on x64.
The release workflows enable QEMU. The addon dynamically uses the desktop's GIO;
it does not bundle an application registry or replace the user's XDG environment.

## Verification

The native smoke checks real enumeration, identity uniqueness, invalid paths and
rejection of an unregistered handler. Its optional last argument explicitly opens
the fixture in that associated application. Run it inside Electron as well as Node
before release; a successful compiler invocation alone does not establish loading.

```sh
node native/external-app/smoke.cjs README.md
node native/external-app/smoke.cjs README.md /System/Applications/TextEdit.app
node native/external-app/win32/smoke.cjs
xvfb-run -a env LD_PRELOAD=libgtk-3.so.0 node native/external-app/linux/smoke.cjs
xvfb-run -a env LD_PRELOAD=libgtk-4.so.1 node native/external-app/linux/smoke.cjs
```

The Windows icon smoke creates temporary per-user file associations and compares
different DLL resource indices for identical executables, then removes them.
Linux smoke uses isolated XDG directories to check themed and absolute SVG icons,
missing/corrupt icon fallback, and launching. Standalone Node preloads GTK for
this test; passing the Electron binary path as the first smoke argument runs the
same assertions inside Electron (with `--gtk-version=3` or `--gtk-version=4` as the
next argument). Electron provides its own loaded GTK. No display means themed icon
lookup is unavailable, while absolute-file icons can still load.

Windows and Linux require platform acceptance for real installed applications;
include a packaged Windows app, non-ASCII paths, a changed default association,
and Linux user-local desktop entries. Verify the packaged target architecture and
loading from unpacked resources on each release platform.
