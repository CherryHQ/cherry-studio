# Utility process smoke harness

Manual verification of `src/main/core/utilityProcess/` against real Electron processes:

```bash
pnpm smoke:utility-process
```

It builds a throwaway app into `local/utility-process-smoke/app` (`out/main/index.js` plus `out/utility-process/<entry>.js`), asserts the entry bundles are hermetic, runs it unpacked, packs it into `app.asar`, and runs it again. Evidence — `summary.json`, one NDJSON log per variant, and the asar manifest — lands in `local/utility-process-smoke/evidence/`.

The harness drives the engine with the real Electron adapter and does not boot the lifecycle container. The check list, the reasoning behind that scope, and the platform coverage still owed are in [docs/references/utility-process/utility-process-testing.md](../../docs/references/utility-process/utility-process-testing.md).
