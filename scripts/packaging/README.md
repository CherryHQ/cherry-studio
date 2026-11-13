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
