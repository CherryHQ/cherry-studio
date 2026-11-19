# Terminal assets

`buildGhostty.mjs` rebuilds the two pinned WASM assets from an explicitly supplied clean Ghostty checkout and Zig executable. It never fetches, checks out, or modifies source revisions. See the [asset manifest and provenance](../../resources/terminal/ghostty/README.md).

`ghosttyWritePty.zig` is the MIT-licensed T3 Code callback trampoline. Keep its import name aligned with `GhosttyRuntime` when changing it.
