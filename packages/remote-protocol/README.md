# Remote protocol

Portable schemas and pure Agent recovery functions shared by Desktop and Mobile.
The root owns JSON-RPC and connection contracts. Agent and configuration transfer
have separate exports; neither owns sockets, keys, persistence or reconnection.

This package is private while protocol v1 is being implemented. Building or passing
package tests alone does not qualify Desktop, Expo or relay interoperability.

Run `pnpm --filter @cherrystudio/remote-protocol test`, `typecheck` and `build`.
External consumers enter through the package exports, never `src/` deep imports.

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
