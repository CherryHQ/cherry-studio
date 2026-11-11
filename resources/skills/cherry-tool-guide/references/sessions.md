# Agent Sessions

Covers `mcp__cherry-tools__session_list`, `mcp__cherry-tools__session_search`,
`mcp__cherry-tools__session_create`, `mcp__cherry-tools__session_send`,
`mcp__cherry-tools__session_deliveries`, `mcp__cherry-tools__agent_delegate`,
`mcp__cherry-tools__delegation_cancel`, and `mcp__cherry-tools__session_rename` —
finding prior Agent work, renaming Sessions, and coordinating a bounded task with
another Session.

Get exact argument and result shapes from the live tool schema. This reference defines
routing, sequencing, result interpretation, and the approval boundary.

## Resolve immutable IDs first

Session and Agent names are display labels, not addresses. Before sending work or
renaming another Session, resolve the target's immutable `sessionId` with one of
these read-only tools:

- **`session_list`** deterministically enumerates visible Sessions. Use it when browsing
  recent Sessions, selecting by Agent, or when the user refers to a Session by name.
- **`session_search`** ranks distinct Sessions using lexical message evidence plus
  Session name/description metadata. Use a focused keyword, identifier, error text, or
  exact phrase from the work; this is trigram/BM25 search, not embedding-based semantic
  retrieval.

`session_search` returns two evidence channels:

- `matches` contains message evidence with `messageId`, snippet, and timestamp;
- `metadataMatches` identifies matching Session `name` or `description` fields.

An empty `matches` array does not mean the result is spurious when `metadataMatches` is
present. The requested limit counts final distinct Sessions, not raw message rows. An
optional Agent filter is applied before ranking and limiting.

## Delegate local coding work

For Code Mate work with Codex, Claude Code or an ACP Agent, use `agent_list` to resolve
an enabled local Agent, then `agent_delegate` with its `target_agent_id` and task `message`.
The default project is the caller's workspace, never the target's previous project.
Use `workspace_id` only for an existing user workspace; without a user project, a fresh
managed workspace is created. CLI configuration, model and credentials come from Agent Services.
Driver availability does not prove authentication or model access.

The call returns a durable `requestId` and dedicated `sessionId` immediately. The task
card updates its state, shows target permissions/questions and opens the target history.
Approving delegation does not approve target tools. Do not bypass declined permissions
with shell commands. Wait for the asynchronous completion result instead of polling.

Use `delegation_cancel` with `request_id` to cancel owned work. Stopping the parent reply
or changing views leaves the delegated task running. Deleting the origin or disabling
the target cancels outstanding work. Tasks have a ten-minute deadline; interruptions
retain partial output and are not automatically replayed after restart. Local targets
cannot initiate another delegation through Cherry tools.

## Choose create vs. send

- **`session_create`** creates a new Session for the current Agent and submits its first
  completion request. Use it to isolate a substantial task that should have its own
  timeline. The new Session uses the Agent's model; with `target_agent_id` it continues
  that Agent's own most recent workspace. Do not try to supply a model. The call returns
  immediately with the new IDs while the work runs.
- **`session_send`** addresses an existing Session. Use immutable IDs obtained from
  list/search; never guess an ID from a name.

For `session_send`, choose the delivery contract by intent:

- **One-way update** — use `reply: none`.
- **Delegated task with a result** — use `reply: completion`. Every delivery owns an
  independent FIFO turn so its terminal output can be attributed to that request.
  The call returns a `requestId` immediately; the runtime later delivers one durable,
  frozen result back to the caller Session. Do not keep the tool call open or poll for
  the answer.

Session tools require an interactive user turn. Headless, scheduled, channel, and
delivery-triggered turns cannot discover, inspect, rename, create, or message Sessions. In an interactive
turn, `session_send` and `session_create` additionally require live per-call approval because they
start another Agent Session turn. If approval is declined, stop; unattended multi-hop delegation
is not available.

## Rename a Session

Use **`session_rename`** when the user asks to change a Session's display title.
Omit the target to rename the current Session, or resolve the immutable ID first
to rename another Agent Session, including one belonging to a different Agent.
Missing Sessions and trashed Sessions cannot be renamed.

The title is trimmed and must contain 1–255 characters. A successful rename is
persisted as an explicit name edit, so automatic naming cannot overwrite it. The
tool returns the Session ID and saved name without starting another turn. It is
auto-approved, but still requires user intent and an interactive user turn.

## Inspect delivery state

Use **`session_deliveries`** to audit or recover durable requests and results, not as a
busy-wait loop. Select incoming or outgoing direction and narrow by status when known.
When a request ID is supplied, the tool returns that request and its correlated result
regardless of direction.

The lifecycle is `accepted` → `delivering` → `consumed`, or `failed` for a
terminal routing/execution failure. A completion result correlates to its request ID.
Accepted intent and terminal results are durable across ordinary restarts, but a crash
during external tool execution cannot make arbitrary side effects exactly-once.

## Recovery

- **No suitable target** → refine `session_search`, filter by Agent, or use
  `session_create` when a new same-Agent timeline is the intended boundary.
- **Metadata-only result** → inspect `metadataMatches`; do not discard it merely because
  `matches` is empty.
- **Approval declined or unavailable** → report that delegation did not run. Do not
  emulate it with shell processes, schedules, or repeated calls.
- **Failed delivery** → inspect the correlated request with `session_deliveries`, report
  the terminal error, and ask before creating a new request; retries are distinct work
  because the API has no caller idempotency key.

## Example

> "Have the implementation Session finish the auth fix and bring the result back here."

`mcp__cherry-tools__session_search` for a focused auth identifier → select the intended
`sessionId` from message or metadata evidence → `mcp__cherry-tools__session_send` with
`reply: completion` and accept the live approval → continue other work; the runtime
delivers the terminal result asynchronously. Use `session_deliveries` only if the user
asks for delivery state or recovery.

The built-in `code-mate-claude-code`, `code-mate-codex` and `code-mate-opencode` shell skills have been retired. Use `agent_list` and `agent_delegate` for these local Agents. Their CLI installation, login and terminal controls remain in Agent Services.
