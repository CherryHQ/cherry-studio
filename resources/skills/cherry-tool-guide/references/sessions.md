# Agent Sessions

Covers `mcp__cherry-tools__session_list`, `mcp__cherry-tools__session_search`,
`mcp__cherry-tools__session_rename`, `mcp__cherry-tools__session_create`,
`mcp__cherry-tools__session_send`, and `mcp__cherry-tools__session_deliveries` — finding
prior Agent work and coordinating a bounded task with another Session.

Get exact argument and result shapes from the live tool schema. This reference defines
routing, sequencing, result interpretation, and the approval boundary.

## Resolve immutable IDs first

Session and Agent names are display labels, not addresses. Before sending work, resolve
the target's immutable `sessionId` with one of these read-only tools:

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

## Rename display metadata

Use **`session_rename`** when the active task requires a Session title to match a task,
directory, or other user-facing label. Resolve the immutable `sessionId` first; never
guess it from a title. The target must belong to the current Agent. Missing, orphaned,
and foreign-Agent targets all fail as not found.

The title is trimmed, must be non-empty, and is limited to 255 characters. A successful
rename marks the title as manually edited so automatic naming cannot replace it. It changes
only current display metadata: Session id, Agent ownership, workspace, messages, history,
routing, and delivery state remain unchanged. Existing delivery envelopes retain their
frozen name snapshots.

## Choose create vs. send

- **`session_create`** creates a new Session for the current Agent and submits its first
  completion request. Use it to isolate a substantial task that should have its own
  timeline. The new Session inherits the Agent's model and workspace policy; do not try
  to supply a model. The call returns immediately with the new IDs while the work runs.
- **`session_send`** addresses an existing Session. Use immutable IDs obtained from
  list/search; never guess an ID from a name.

For `session_send`, choose the delivery contract by intent:

- **One-way update** — use `reply: none`.
- **Delegated task with a result** — use `reply: completion`. Every delivery owns an
  independent FIFO turn so its terminal output can be attributed to that request.
  The call returns a `requestId` immediately; the runtime later delivers one durable,
  frozen result back to the caller Session. Do not keep the tool call open or poll for
  the answer.

All six Session tools require an interactive user turn. Headless, scheduled, channel, and
delivery-triggered turns cannot discover, inspect, rename, create, or message Sessions. In an interactive
turn, `session_send` and `session_create` additionally require live per-call approval because they
start another Agent Session turn. If approval is declined, stop; unattended multi-hop delegation
is not available.

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
- **Rename reports not found** → resolve the id again and confirm the target belongs to the
  current Agent; do not probe or attempt to rename another Agent's Session.
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
