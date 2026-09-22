## ADDED Requirements

### Requirement: Every Prometheus MCP server is a listed, configurable preset
Each Prometheus tool exposing an MCP server SHALL appear in `PRESET_MCP_SERVERS` with a name in
`BuiltinMcpServerNames` under the `@prometheus/` namespace, so the renderer lists it for install
and the user can configure it like any other built-in. None SHALL be wired in outside that
registry.

#### Scenario: The servers are listed for install
- **WHEN** the user opens the MCP server catalog
- **THEN** compass, rust-mcp-filesystem, sycophancy-correction and surreal-memory appear beside the existing presets

#### Scenario: A preset is offered, never auto-enabled
- **WHEN** a Prometheus preset is first seeded
- **THEN** `isActive` is false until the user enables it

### Requirement: Bundled binaries resolve per platform without a platform branch
A preset backed by a bundled binary SHALL name the binary by command and rely on the existing
resolution path, which searches the bundled location and appends `.exe` on Windows. A preset SHALL
NOT carry per-platform command variants.

#### Scenario: Windows resolves the .exe
- **WHEN** a bundled-binary preset starts on Windows
- **THEN** the `.exe` is resolved from the bundled location with no preset change

#### Scenario: A missing binary reports rather than crashes
- **WHEN** the bundled binary is absent
- **THEN** the server reports unresolved with a reason, and the app continues

### Requirement: Dangerous tools are not auto-approved
`rust-mcp-filesystem` SHALL list its write-capable tools in `disabledAutoApproveTools`, matching
how the existing filesystem preset treats write, edit and delete.

#### Scenario: A write requires approval
- **WHEN** the filesystem server is active and a write tool is invoked
- **THEN** it requires explicit approval rather than being auto-approved

### Requirement: compass runs over stdio only
The compass preset SHALL declare `type: 'stdio'` and SHALL NOT declare an HTTP base URL or a watch
mode.

#### Scenario: No HTTP transport is offered
- **WHEN** the compass preset is read
- **THEN** its type is stdio and it has no `baseUrl`

### Requirement: A service-backed server is inactive until its service runs
`surreal-memory` is reached over HTTP at the fixed endpoint and depends on a Docker container it
does not start. Its preset SHALL be inactive by default and SHALL NOT cause an error when the
container is absent.

#### Scenario: The container is not running
- **WHEN** surreal-memory is enabled but its container is down
- **THEN** the failure is reported as that server being unavailable, and the app is otherwise unaffected
