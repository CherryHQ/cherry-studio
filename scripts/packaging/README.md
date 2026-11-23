# Electron packaging hooks

`electron-builder.yml` registers the hooks in this directory:

- `before-pack.js`: prepares target native dependencies and bundled binaries, then filters foreign platform files.
- `after-pack.js`: installs the target Computer Use runtime from the SDK's matching npm platform package outside ASAR before signing, adjusts packaged license files and installs the pinned Linux SQLite artifact. Missing helpers or mismatched SDK/runtime versions fail the build; `.context` is only for development.
- `notarize.js`: notarizes the signed macOS application when credentials are configured.
- `mac-sign.js`: preserves the Electron signing policy and assigns empty entitlements to the system speech helper.
- `win-sign.js`: validates and signs Windows artifacts.
- `artifact-build-completed.js`: normalizes public release artifact names.

Native source compilation belongs alongside its code in `native/`. The file-association
addon lives in `native/external-app/`, with a shared Node-API bridge and platform adapters.
Shared binary download and Linux compatibility tooling remain in `scripts/download-binaries.js`
and `scripts/linux-native/`, since development and standalone validation also use them.

Release and Preview prepare external tools with
`node scripts/release/prepare-tools.js prepare <windows|mac|linux> <all|x64|arm64>`.
Only Windows accepts `all`, preparing x64 then arm64. The packaging hook also runs
preparation for direct electron-builder invocations. Development keeps its existing
shared versioned cache.

Packaging downloads at most three tools concurrently and extracts them sequentially.
`CHERRY_BINARY_CACHE` selects an original-asset cache outside the checkout; without
it, packaging uses a checkout-scoped OS temporary cache. Assets under `complete/`
are keyed and checked by their pinned SHA-256 on reuse. Interrupted transfers live
under `partial/`, outside the Actions cache path, and are resumed by their owner.
Only complete verified assets are published. Resources receive private copies or
extracted files, so later packaging cannot modify the original cache. Invalid
entries are fetched again; an unavailable cache falls back to temporary downloads.
Logs report cache verification, transfer, asset verification, and extraction/install
intervals. Temporary files may be evicted by the OS.


## Desktop region compatibility packages

Build the compatibility package from a stable source version above the last
legacy version and below the unified target. Set
`CHERRY_REGION_BRIDGE_EDITION` to the original edition and use
`--config electron-builder.region-bridge.config.cjs`. Finish packaging before
publishing its manifests.

For the CN macOS compatibility package, build the matching Electron
distribution for x64 and arm64. Use the repository's pinned Electron version
and apply `mac-region-bridge.patch` with `git apply --unidiff-zero` in its Squirrel.Mac checkout before building
the distribution. For Electron 45.2.2 the Squirrel.Mac revision is
`fffea30e4a339a7f7d69a3391314b72548d209bd`. Supply the architecture's
distribution ZIP and its SHA-256 through `CHERRY_MAC_BRIDGE_ELECTRON_DIST` and
`CHERRY_MAC_BRIDGE_ELECTRON_SHA256`. [Electron GN build instructions](https://github.com/electron/electron/blob/v45.2.2/docs/development/build-instructions-gn.md)

The bridge signs with the original Developer ID team and applies the expanded
designated requirement to the outer app only. The signing hook verifies the
finished app against the legacy requirement. Real update acceptance requires
the old signed CN build, the signed and notarized bridge, and a signed unified
build for each architecture.
