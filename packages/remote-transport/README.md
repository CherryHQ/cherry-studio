# Remote transport

Shared LAN connection transport for Desktop and Mobile. Noise XX authenticates
Ed25519 device identities and encrypts records. Protocol negotiation is bound to
the Noise prologue. Pairing and business authorization are owned by the host.

There is no relay service in this implementation. Applications provide their
WebSocket, identity persistence and central logger. Never log key or record data.
The implementation uses the public libp2p Noise and stream APIs; it does not
implement cryptographic primitives or a custom key exchange.

Published as `@cherrystudio/remote-transport` through the repository's Changesets release
workflow. It depends on the matching published `@cherrystudio/remote-protocol` version;
`workspace:*` is converted to a concrete version when the package is packed.

Run `pnpm --filter @cherrystudio/remote-protocol build` before this package's
`test`, `typecheck` or `build` script.
