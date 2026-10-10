# Electron packaging hooks

`electron-builder.yml` registers the hooks in this directory:

- `before-pack.js`: prepares target native dependencies and bundled binaries, then filters foreign platform files.
- `after-pack.js`: adjusts packaged license files and installs the pinned Linux SQLite artifact.
- `notarize.js`: notarizes the signed macOS application when credentials are configured.
- `mac-sign.js`: preserves the Electron signing policy and assigns empty entitlements to the system speech helper.
- `win-sign.js`: validates and signs Windows artifacts.
- `artifact-build-completed.js`: normalizes public release artifact names.

Native source compilation belongs alongside its platform code in `native/<platform>/`.
Shared binary download and Linux compatibility tooling remain in `scripts/download-binaries.js`
and `scripts/linux-native/`, since development and standalone validation also use them.
