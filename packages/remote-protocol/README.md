# Remote protocol

Portable schemas and pure Agent recovery functions shared by Desktop and Mobile.
The root owns JSON-RPC and connection contracts. Agent and configuration transfer
have separate exports; neither owns sockets, keys, persistence or reconnection.

This package is private while protocol v1 is being implemented. Building or passing
package tests alone does not qualify Desktop, Expo or relay interoperability.

Run `pnpm --filter @cherrystudio/remote-protocol test`, `typecheck` and `build`.
External consumers enter through the package exports, never `src/` deep imports.
