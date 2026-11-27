# Remote protocol

Portable schemas and pure Agent recovery functions shared by Desktop and Mobile.
The root owns JSON-RPC and connection contracts. Agent and configuration transfer
have separate exports; neither owns sockets, keys, persistence or reconnection.
The root also owns the shared discovery service type, TXT format and fixed WebSocket
path. These are Cherry peer interoperability contracts, not listener or routing policy.

Published as `@cherrystudio/remote-protocol` through the repository's Changesets release
workflow. Package versions follow semver independently of the negotiated wire protocol
version. Building or passing package tests alone does not qualify Desktop, Expo or relay interoperability.

Run `pnpm --filter @cherrystudio/remote-protocol test`, `typecheck` and `build`.
External consumers enter through the package exports, never `src/` deep imports.

The event reducer caches streaming text byte lengths by part snapshot without adding wire
fields. Appends encode only new text after an initial length calculation; restored or replaced
parts calculate their own length. Producers read `part.append` offsets through the exported
`textByteLength`, so emitting and validating an append share one cache entry. Completion still checks the full content digest and does
not inherit the streaming snapshot's cache. Older snapshots remain independently usable
for atomic recovery; their weakly held cache entries disappear with those objects.

## Connection addresses

`connection.hello.connectionEndpointsVersion: 1` advertises `connection.endpoints`.
The request names an already approved domain; the desktop rechecks its current grant
before and after preparing the response. The result contains the desktop identity and
at most 32 direct endpoints, with no invitation or VPN credentials. Clients pin the
identity, keep suggestions ephemeral, and persist only explicitly verified selections.
Peers without this optional capability retain existing pairing and manual-address flows.

## Failure outcomes

`./failure` owns the bounded execution failure snapshot shared by live execution and message
history. Messages carry explicit pending/success/error/paused status. A failed execution requires
a failure and a terminal message identity. Terminal persistence is either durable with message
and history revisions, or non-durable with a separate persistence failure. RPC authorization errors
and command receipts remain independent of execution outcomes.

`connection.hello.agentFailureVersion: 1` advertises this contract. New clients require it for Agent
access only; configuration and pairing retain their existing protocol. Old execution `error` fields
remain a compatibility projection. Old cached projections missing required fields are rebuilt from
a checkpoint. Unknown upstream causes are classified as `unknown`; wire snapshots validate the
versioned reason vocabulary without rewriting bytes used by checkpoint digests.

## Interaction and workspace additions

- Interaction summaries may declare `kind: question`; full questions stay in the versioned input
  resource and use `questionInputSchema`. Responses are explicit approve, deny-with-optional-reason,
  or answer-with-question-keyed-values. Validate completeness against the current interaction at
  the host; the schema validates shape and bounds. Question text keys must be unique.
- Workspace catalogs advertise `systemWorkspace`; creation accepts an explicit system or registered
  selection. The host owns directory resolution and returns the real workspace ID and kind.
- Legacy plain `decision` and `workspaceId` mutations remain accepted, including journal recovery.
  A request must choose exactly one form. New clients use the legacy forms for those existing
  operations and explicit forms for the additions; old catalogs do not imply system support.
- Command identity includes the full answer or workspace selection. Retrying with the same ID
  and different input is an idempotency conflict, never a replacement operation.

Agent catalogs optionally include `emoji` (nonempty Unicode text, at most 64 UTF-16 units).
It is display metadata, not a file path or URL. Omission remains compatible with older hosts;
clients keep their normal fallback. Image transfer is outside this field's contract.

### Message usage

`AgentMessage.usage` is an optional materialized summary. It carries nonnegative token counts,
cache/reasoning breakdowns, bounded per-currency costs and request counts, and completed runtime
durations. Absence means unknown, not zero. It deliberately excludes per-request accounting rows
and runtime span arrays. The message owns the snapshot, so history responses, message updates,
and checkpoint/replay use one schema. Older peers may omit it; no pairing capability gate changes.

The optional public model summary (`modelId`, `providerId`, `name`) is shared by message snapshots
and Agent catalog entries. A message records its producing model; the catalog records current
configuration (`null` for unconfigured, omitted for older hosts). Neither carries provider secrets
or requires the receiving device to have the model installed.

### Pairing addresses

`pairingQrSchema` accepts legacy v2 IP/port invitations and v3 invitations with complete
`endpoints` (`host`, `port`, `security`). `fixtures/pairing-qr.json` is also exercised by
Mobile's lightweight startup schema. Keep the fixture copy aligned when changing the wire contract.
`parseDirectEndpoint` accepts HTTP(S) input as an alias for WS(S), preserving TLS and explicit ports.
The fixed route remains `/v1/remote/connect`; advertised endpoints use `advertisedEndpointSchema`
to reject loopback and wildcard destinations.

## Task queries

The Agent export defines five read-only methods under the existing Agent grant:
`agent.tasks.list`, `agent.tasks.get`, `agent.tasks.runs.list`,
`agent.tasks.runs.get`, and `agent.tasks.content.read`. Types derive from the
public schemas; desktop task and Job services own their values. No additional
hello capability or stored task state is introduced. A host without these methods
returns method-not-found; clients must show unsupported access instead of an empty list.

Task lists accept an optional Agent and a nonempty `statuses` filter (`active`,
`paused`, `completed`, `missed`). Heartbeats and tasks with archived or missing
Agents are excluded before paging. Omission selects all statuses. Unknown Agent
filters return an empty page; hidden or missing task/run identities return `NOT_FOUND`.
Task status describes scheduling; a completed one-shot task does not imply successful execution.
Both list and detail include the configured `trigger` and the business task's
`updatedAt` timestamp. The latter is not limited to user edits or a new revision counter.

Run IDs identify Jobs across retries. Runs expose `queued`, `running`, `completed`,
`failed`, or `cancelled`; a cancellation request remains a separate flag until the
Job settles. Timestamps are persisted facts and remain null when absent, never
substituted with queue or cancellation-request time. Completed runs distinguish
structured `executed`, `skipped`, and legacy `unknown` outcomes. A result location
is `none`, a readable `session` belonging to the task's Agent, or `unavailable`.
Reused sessions do not promise an exact reply position. Existing session/message
methods read the result; job retention can expire independently of conversation history.
`summary` is a nullable excerpt of structured task output, capped at 200 UTF-16
units without splitting surrogate pairs. Malformed legacy Unicode is replaced;
absent or non-text results return null, never raw output serialized as JSON.
The excerpt does not determine the outcome; read the linked session for the full reply.

Pages default to 20 items, accept at most 100, and may be shortened for the wire
byte budget. Follow `nextCursor` until null. Cursors bind offsets to the method and
normalized filters; concurrent changes require a refresh and client deduplication.
Task and run ordering is `createdAt DESC, id DESC`.

Task detail retains the configured trigger, timeout, workspace selection and reuse
mode. `timeoutMinutes` is a nonnegative number of minutes; `0` means no timeout.
An omitted cron timezone means the host scheduler's timezone; clients use
`nextRunAt` rather than calculating a schedule. Prompts over 4,096 UTF-16 units use
`ContentRef`. Read at most 24,576 UTF-8 bytes per request, reassemble bytes before
decoding text, and verify the complete SHA-256. Both revision and content identity
must match the current prompt. On `REVISION_EXPIRED`, reload detail and restart.

Remote `agent.sessions.list` includes ordinary and scheduled-task conversations,
preserving existing mobile discovery without changing existing requests. Background
and trashed conversations remain excluded. Desktop ordinary topic lists retain
their own scope. Refresh from page one after a host upgrade to discover newly visible results.

Pass optional `taskId` to `agent.sessions.list` to page through a task's associated
conversations directly, including fresh and reused sessions after execution history
has been collected. `agentId` and `workspaceId` intersect with this filter. Missing,
hidden or non-Agent tasks and conflicting Agent filters return an empty page.
Only readable conversations belonging to the task's Agent are returned, with the
existing pinned-first ordering and byte budget. Restart pagination when changing
filters. This collection is independent of each run's `resultLocation` and the
task's current reuse target. Old hosts may reject `taskId`; do not silently drop
the filter and present unrelated sessions.

## Paged message summaries

`connection.hello.agentMessageSummariesVersion: 1` advertises the optional
`agent.messages.list` parameter `partsMode: 'paged'`. Only send this parameter
after observing the capability. Without it, responses retain complete `partIds`.

Paged responses contain `AgentMessageSummary` items: message identity, revision,
role, status and optional usage/model/failure metadata, with `partsMode: 'paged'`
and no `partIds`. Enumerate every part through `agent.parts.list` using the message
ID and revision, following `nextCursor` until null. An omitted index is not an
empty message. History and part revision checks remain unchanged.

`AgentMessageListItem` is the full-message/summary union. Summaries are list-only;
events, checkpoints and reducers still require complete `AgentMessage` snapshots.
Peers without the capability keep the existing request and response shapes.

An indivisible list item over the response budget returns `RESOURCE_EXHAUSTED`
with `details: { kind: 'ITEM_TOO_LARGE', itemBytes, budgetBytes, retryable: false }`.
The same request and data cannot recover by waiting. Other resource-exhaustion
errors retain their semantics; legacy clients may ignore the additional details.

## Resumable Agent attachments

`connection.hello.agentUploadsVersion: 1` advertises prepare/get/resume/complete/cancel and binary DATA/ACK records.
Upload identity is scoped to device and Agent grant, independent of sockets and sessions.
A durable `committedOffset` is the only resume position. `resume` uses an idempotent resume ID
and expected writer epoch; old writers cannot advance a replaced upload. DATA carries raw bytes authenticated by Noise AEAD, with a durable ACK after each block.
Desktop computes the full-file SHA-256 before publishing a ready managed reference.
The optional `agentUploadChecksum: 'sha256'` hello capability supports independent source verification:
prepare fixes `checksumAlgorithm`, complete supplies `expectedSha256`, and ready returns the actual
`sha256`. A mismatch becomes durable failed state with `CHECKSUM_MISMATCH`; disk/publication errors
use `VERIFICATION_FAILED`. Changing a recorded digest or mode is an idempotency conflict.
Absent-mode uploads retain legacy behavior. New mobile hashes its retained immutable source natively
in parallel with normal DATA transfer; recovery compares the saved digest before resumed writes.

Limits: 1 GiB/file, 2 GiB/message, eight files, 1 MiB blocks and two outstanding blocks.
Staging expires after 24 hours idle or seven days total, with 4 GiB/device and 8 GiB/global
reservations. Upload permission and expiry are rechecked independently of message receipts.
Send accepts text, files, or both. Clients freeze the upload references in the durable send
command before submission and query that command's receipt after uncertain outcomes.
They must never replace expired upload references inside an already submitted command.

Uploaded file history uses a revision-bound content reference, never a desktop filesystem path.
Content pages are read under the current Agent grant and checked against the complete digest.
