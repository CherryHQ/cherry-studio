# Remote protocol

Portable schemas and pure Agent/Assistant recovery functions shared by Desktop and Mobile.
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

Wire protocol 2 also advertises `connection.hello.uploadsVersion: 1`: the same transfer through
domain-neutral `uploads.prepare/get/resume/complete/cancel`. Each call names the owning
`domain` (`agent` or `assistant`); DATA records carry the same `domain` and are acknowledged with
`uploads.ack`. Records without `domain` remain the Agent path acknowledged by `agent.uploads.ack`.
Uploads are scoped to that domain's grant: a message can only reference uploads owned by its own
grant, and revoking one capability cancels only that capability's uploads. Neutral limits are
advertised as `upload*` keys with the same values as their `agentUpload*` counterparts.

## Assistant access

`./assistant` exports the Assistant schemas, command encoding, checkpoint installation,
and event reducer. Desktop advertises `connection.hello.assistantVersion: 1` only on
wire protocol 2. New clients offer `[2, 1]` and require version 2 plus this capability
before requesting Assistant authorization. Protocol 1 retains its two-domain
authorization view during pairing, authentication and refresh, even when the device
also has an Assistant grant. Package versions and wire versions remain independent.

An `assistant` grant authorizes all active desktop Assistants and existing topic history.
It does not authorize provider credential export. Approval adds missing grants while
preserving existing IDs; revocation removes only the requested capability.

The first contract supports text and uploaded files with the desktop Assistant's default model,
current-branch history, independent model/message stream identity, expected-execution
cancellation, and ordinary approval/denial. Model selection, branch editing and configuration
mutation are excluded. Question forms, MCP OAuth, elicitation and browser confirmation
require the desktop; interaction resources state whether a decision is remotely answerable.

Read `assistant.topics.get` before paging messages. Every history/part/content read carries
the selected `parentAnchorId` and `historyRevision`; cursors additionally bind the grant.
History pages start with the latest messages and keep chronological order within each page.
The current branch includes its multi-model reply groups, identified by `replyGroupId`;
ordinary sibling branches remain outside the view.
Catalog pages are bounded by both item count and encoded byte size. Treat their cursors as opaque;
the next cursor advances only over returned entries, including when a byte limit shortens the page.
Message revisions use the view's history revision, so any visible mutation invalidates
its content references. Messages preserve their producing Assistant and model snapshots.
Files uploaded by a paired device expose revision-bound file references; other historical
attachments expose metadata only.
Message headers carry `partCount`; historical headers leave `partIds` empty and clients
page through `assistant.parts.list`. Each `part.updated` names `afterPartId` (`null` for
the first part), positioning both new and replaced parts within their message; an unknown
predecessor requires recovery. Checkpoint parts follow the message's canonical order.
These rebuild the ordered part IDs, keeping large tool transcripts out of individual message headers.

Sends attach files through `uploads.*` with `domain: 'assistant'` and the same limits and
checksum rules as Agent attachments; text may be empty when files are attached.
`assistant.attachments.present` publishes a topic's in-progress selection to the desktop,
matching `agent.attachments.present`.

Create/send/cancel/respond use stable command IDs and `assistant.commands.get` for uncertain
outcomes. A receipt records admission independently of runtime and persistence results.
An interrupted command is never automatically replayed. Sends also name the expected
Assistant configuration, branch anchor and history revision; stale or busy sends conflict.
Approval responses bind the message, execution, view/configuration revisions and input digest.

Subscribe and read checkpoint pages. Fetch streamed text, reasoning and tool-input references
while the checkpoint lease is held. Pass content keyed by `contentId:revision` to
`installAssistantCheckpoint(descriptor, pages, content, integrity)`; it verifies byte length,
SHA-256 and UTF-8 and materializes those parts. Only activate after installation succeeds:
activation releases the checkpoint's content lease.
Alternatively, reconnect with the last applied cursor and replay the retained suffix.
`applyAssistantEvents` applies a batch atomically; fetch and verify referenced content before
retrying a `content` result. Acknowledge only applied cursors. Gaps/epoch changes and
`assistant.subscriptions.resetRequired` require a fresh checkpoint. Closing a subscription
does not cancel desktop execution. Terminal events distinguish saved results from
persistence failures; refresh history after a durable terminal result.
