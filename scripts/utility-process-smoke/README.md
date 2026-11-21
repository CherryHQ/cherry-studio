# Utility process smoke harness

Manual verification of `src/main/core/utilityProcess/` against real Electron processes:

```bash
pnpm smoke:utility-process
```

It builds a throwaway app into `local/utility-process-smoke/app` (`out/main/index.js` plus `out/utility-process/<entry>.js`), asserts the entry bundles are hermetic, runs it unpacked, packs it into `app.asar`, and runs it again. Evidence — `summary.json`, one NDJSON log per variant, and the asar manifest — lands in `local/utility-process-smoke/evidence/`.

The harness drives the engine with the real Electron adapter and does not boot the lifecycle container. The check list, the reasoning behind that scope, and the platform coverage still owed are in [docs/dev/references/utility-process/utility-process-testing.md](../../docs/dev/references/utility-process/utility-process-testing.md).

It also checks independent instance initialization, sibling isolation, and refusal to restart stopped/crashed single-generation handles. The pinned Ghostty assets are copied into both app layouts and loaded by the child from that layout, verifying Unicode snapshots, headless replies, native search and allocator callbacks, input encoding, alternate-screen restoration, resize, and sibling core disposal without a renderer. The production terminal entry also runs a pipe command with a nonzero exit code and, on POSIX, a real PTY that requires a headless VT reply before completing. The temporary asar unpacks native modules and scope executables. TerminalService admission, Windows PTY cleanup, and final installers still require separate evidence.
