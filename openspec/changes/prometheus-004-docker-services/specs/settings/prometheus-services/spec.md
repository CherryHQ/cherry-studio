## ADDED Requirements

### Requirement: Docker state is read from the mini, never re-detected here
The app SHALL obtain Docker and service state by spawning the mini's `scripts/services.mjs` and
reading its output. It SHALL NOT implement its own Docker detection, call `wsl.exe`, or access the
Docker socket.

#### Scenario: Detection is unavailable before the mini lands it
- **WHEN** the mini's `services.mjs` is not present in the app-data copy
- **THEN** the panel reports that detection is unavailable, and does not guess a state

#### Scenario: Each Docker state renders its own next step
- **WHEN** state is `absent`, `daemon-down` or `ready`
- **THEN** the panel shows that state and, when not `ready`, names the platform's next step without performing it

### Requirement: The three services are reached at fixed endpoints on every platform
The panel SHALL report on exactly three services, at the endpoints the project fixes identically on
every platform: surreal-memory at `http://localhost:23001/mcp/sse`, SurrealDB at
`127.0.0.1:28000`, and the liter-llm gateway at `http://localhost:4000/v1`. No platform branch
SHALL exist in this client code — only how the process starts differs. No fourth service SHALL be
added.

#### Scenario: The same endpoints are used on every platform
- **WHEN** the panel probes the services on Windows, macOS or Linux
- **THEN** it uses those three endpoints unchanged, with no platform-specific branch

#### Scenario: A gateway answering 401 is up, not broken
- **WHEN** the liter-llm gateway answers 401 because no key is exported
- **THEN** it is reported as running-but-unverified rather than failed — matching the mini doctor's
  own treatment of that case

### Requirement: Containers start only with consent
The app SHALL NOT run `services.mjs up` without an explicit user action and a stored Docker
consent preference.

#### Scenario: No consent, no containers
- **WHEN** consent has not been given
- **THEN** no container is started, and the UI explains what consent enables

### Requirement: Every service being down is a status, not a failure
Absent or unreachable services SHALL be reported as status. Startup SHALL NOT fail, and no error
dialog SHALL be raised, when Docker or any service is unavailable.

#### Scenario: The app starts with everything down
- **WHEN** Docker is absent and no service is reachable
- **THEN** the app starts normally and the panel reports each as unavailable
