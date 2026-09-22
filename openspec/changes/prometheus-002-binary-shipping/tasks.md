Blocked until both releases exist. Do not write placeholder digests.

## 1. Gate

- [ ] 1.1 Assert `gh release list` is non-empty for `GQAdonis/compass` and `GQAdonis/rust-mcp-filesystem`, and that each release carries all five target archives plus digests. Paste the asset lists.

## 2. Manifest

- [ ] 2.1 Add the `compass` `TOOLS[]` entry: `archive: 'tar.gz'`, `strip: 'compass-<target>'`, real `sha256` per package. Model it on the existing `rg` entry.
- [ ] 2.2 Add the `rust-mcp-filesystem` entry the same way, from its cargo-dist assets.
- [ ] 2.3 `node scripts/download-binaries.js darwin arm64` then `win32 x64` then `win32 arm64`; confirm each lands in `resources/binaries/` and `verifyBundledBinaries` passes. Paste the output.

## 3. MCP registration

- [ ] 3.1 Test first: compass resolves to the bundled path when absent from PATH, and reports `unresolved` with a reason when absent entirely.
- [ ] 3.2 Register compass as stdio; register rust-mcp-filesystem with write off.

## 4. Verify

- [ ] 4.1 Targeted tests (`pnpm test:main <file>`), then `pnpm lint`.
- [ ] 4.2 `pnpm build:unpack` and confirm both binaries are in the packaged resources.
- [ ] 4.3 **Windows, both arches:** confirm `.exe` resolution and that each server starts. Unverified until run on real hardware.
