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
