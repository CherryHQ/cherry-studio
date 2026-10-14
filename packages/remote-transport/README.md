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

## Binary upload records

Negotiation remains bound to the Noise transcript. Control records retain their JSON
encoding. Binary DATA starts with `0x01`, a two-byte big-endian JSON header length,
the bounded header and raw bytes. The marker cannot begin a JSON record. Control JSON stays
at 64 KiB. DATA is at most 1 MiB, with a 4 KiB header limit. Noise handles its own
smaller encrypted frames; application callers never split DATA into crypto frames.

Mobile provides `createNativeNoiseCrypto` with Quick Crypto for bulk encryption. Electron
uses Noise's built-in implementation: its Node crypto does not expose ChaCha20-Poly1305.
Noise continues to own key exchange, nonces and authentication. No global crypto polyfills
are installed. Desktop final file hashing still uses Node crypto.

Upload acknowledgements are independent of RPC request admission. The sender keeps
at most two DATA blocks outstanding; the receiver acknowledges only durable offsets.
Transport buffers are bounded to 4 MiB, including framing overhead. Application
ownership, writer epochs, source snapshots and final hashing belong to the hosts.
