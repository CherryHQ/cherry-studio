# Electron packaging hooks

`electron-builder.yml` registers the hooks in this directory:

- `before-pack.js`: prepares target native dependencies and bundled binaries, then filters foreign platform files.
- `after-pack.js`: adjusts packaged license files and installs the pinned Linux SQLite artifact.
- `notarize.js`: notarizes the signed macOS application when credentials are configured.
- `win-sign.js`: validates and signs Windows artifacts.
- `artifact-build-completed.js`: normalizes public release artifact names.
- `velopack.js`: builds x64/arm64 Velopack distributions alongside the legacy artifacts; run with `global` or `cn` after installing the pinned vpk CLI.
- `velopack-after-sign.js`: signs and notarizes the final Velopack macOS bundle while electron-builder still owns the signing keychain.
- `velopack-sign.js`: adapts the existing Windows signing implementation to vpk's signing callback.

Velopack SDK and vpk are pinned to 1.2.161. See [integration and verification details](../../docs/contrib/velopack-implementation-design.md#13-已落地的代码与发布方式).

Native source compilation belongs alongside its platform code in `native/<platform>/`.
Shared binary download and Linux compatibility tooling remain in `scripts/download-binaries.js`
and `scripts/linux-native/`, since development and standalone validation also use them.
