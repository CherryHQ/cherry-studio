## ADDED Requirements

### Requirement: Prometheus Rust tools ship as verified per-platform binaries
`compass` and `rust-mcp-filesystem` SHALL be declared as `TOOLS[]` entries in
`scripts/download-binaries.js`, each with a package per `platform-arch` covering `win32-x64`,
`win32-arm64`, `darwin-arm64`, `darwin-x64` and `linux-x64`, and each carrying a `sha256` that is
verified before the binary is used. They SHALL NOT be vendored as git submodules in this
repository.

#### Scenario: An arm64 Windows build finds its binary
- **WHEN** `electron-builder --win --arm64` runs and `before-pack.js` invokes the downloader
- **THEN** the `win32-arm64` package resolves and `verifyBundledBinaries` reports it present

#### Scenario: A tampered archive is refused
- **WHEN** a downloaded archive's SHA-256 does not match the manifest
- **THEN** the download fails and the build does not proceed with that binary

#### Scenario: No entry lacks a digest
- **WHEN** the `TOOLS[]` manifest is read
- **THEN** every Prometheus package entry has a `sha256`

### Requirement: compass runs over stdio only
`compass` SHALL be registered as a stdio MCP server, resolved through the existing
`getBinaryPath` path so the bundled copy is found and `.exe` is appended on Windows. It SHALL NOT
be registered with an HTTP transport or a watch mode.

#### Scenario: The bundled binary resolves
- **WHEN** the server starts on a machine with no system `compass` on PATH
- **THEN** `resolveLaunchCommand` reports `resolution: 'bundled'`

#### Scenario: A missing binary reports a usable reason
- **WHEN** neither a system nor a bundled `compass` exists
- **THEN** `resolution: 'unresolved'` with an `unavailableReason`, and the app does not crash

### Requirement: rust-mcp-filesystem is registered read-only
The filesystem MCP server SHALL be registered with write capability disabled.

#### Scenario: Write is off by default
- **WHEN** the server's registration is read
- **THEN** no write-enabling flag is present
