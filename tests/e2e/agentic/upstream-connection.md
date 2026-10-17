# Explicit native target binding for the web engine

## Reproduction

With `@e2e-dev/web@0.15.1`, attach to an Electron process exposing multiple page
targets. Use the documented `connect.cdpEndpoint` and `reconnectEndpoint` options.
`AttemptSession.nextPage()` selects the first open page and navigates it to
`about:blank`. The first page need not be the main BrowserWindow. A preload check
alone cannot establish that the intended native window was selected.

The local driver reproduced this mismatch after validating the main target's URL,
PID, listener ownership, and working directory. It stopped before UI actions with
`The framework first-page binding does not match the verified native main window`.

## Proposed upstream change

Add optional `connect.existingTargetId` for persistent connections. Match it through
CDP `Target.getTargetInfo`, without relying on page order. Missing targets must fail
before any navigation. Require `reconnectEndpoint`; ordinary connections create a
new context and cannot adopt a native window. The existing initialization,
reconnection identity checks, masking, and host-owned cleanup remain in use.

The standalone workspace applies this change through a pinned pnpm patch in
`patches/`. It changes only connection validation, type declarations, option
propagation, and first-page selection. No application code or custom engine is
required. For an upstream PR, apply the equivalent edits to `packages/web/src/`
and place the regression tests with that package's existing tests; the installed
package contains compiled modules, so the local reproducible patch targets `dist/`.

## Verification

```sh
pnpm --dir tests/e2e/agentic test:connection
pnpm test:e2e:agentic --case startup
```

The three patch regression checks verify non-first target selection, rejection of a
missing target without navigating another window, and rejection of ordinary
new-context mode. Runtime cases supply the main window's verified target ID for
every invocation, including after a real Electron restart. Native identity records
are retained in each case's system run directory. `compatibility.test.ts` also
checks preload/IPC and captures a screenshot when run with the driver's native
record and target ID.
