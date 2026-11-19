# Ghostty assets

`manifest.json` pins the source revisions, Zig toolchain, and artifact SHA-256 hashes. `ghostty-vt.wasm` is the official libghostty-vt C ABI; `ghostty-write-pty.wasm` adapts its callback table to a JavaScript reply handler. Both are read-only assets, with no browser or native addon requirement.

The initial artifacts and bindings come from [T3 Code at the pinned revision](https://github.com/pingdotgg/t3code/tree/0a8aaa3ccb944dadb70054ae4ef2e29897b0db03/apps/web/src/terminal/ghostty). Its [VERSION](https://github.com/pingdotgg/t3code/blob/0a8aaa3ccb944dadb70054ae4ef2e29897b0db03/native/libghostty-vt/VERSION) identifies the Ghostty source used to build the WASM. The older revision cited in the architecture research is not this artifact's build identity.

Licenses shipped with these assets:

- `LICENSE-GHOSTTY` — Ghostty, MIT; copyright 2024 Mitchell Hashimoto and Ghostty contributors.
- `LICENSE-T3` — adapter and callback trampoline, MIT; copyright 2026 T3 Tools Inc.

The adapted bindings live in [the terminal engine](../../../src/main/services/terminal/README.md). Cherry changes load supplied bytes in Node, avoid a global runtime singleton, verify the build revision, accept normalized key input, expose the scrollback byte limit, omit transcript replay, exclude wide-cell spacers from row text, and keep old snapshots stable after later renders.

To rebuild from a clean checkout of the exact Ghostty revision and Zig version in the manifest:

```bash
node scripts/terminal/buildGhostty.mjs /absolute/path/to/ghostty /absolute/path/to/zig
```

The script verifies source/toolchain identity, builds into a temporary directory, and checks both hashes before replacing either asset. The callback source is [ghosttyWritePty.zig](../../../scripts/terminal/ghosttyWritePty.zig). Updating the pin requires reviewing the ABI bindings and re-running their real-WASM tests together.
