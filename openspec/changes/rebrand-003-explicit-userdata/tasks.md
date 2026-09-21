# Tasks — rebrand-003-explicit-userdata

- [x] Implement per plan.md
- [x] Verify acceptance criteria
- [x] pnpm lint

## What changed

**`userDataLocation.ts`** — the packaged non-portable path previously fell through
all three branches with no `setPath`, leaving Electron's name-derived default
(`<appData>/<app name>`). It now sets `userData` explicitly to
`<appData>/${PRODUCT_DIRNAME}`, so the data directory is pinned by configuration and
**cannot move when the display name changes in rebrand-004**.

**`warnOnUnadoptedLegacyDataDir()`** — implements D1 (start clean). Detects an
existing upstream `CherryStudio` directory and logs a warning naming both paths,
without ever adopting it. An operator can find their old data instead of concluding
it vanished.

**`paths/constants.ts`** — `CHERRY_HOME_DIRNAME`: `.cherrystudio` → `.the-boss`.
Literal, not an import: this layer loads before `app.whenReady()` and may not import
business modules. Reciprocal comments link it to `HOME_DIRNAME`.

**`pathRegistry.ts`** — temp dir `path.join(sysTemp, 'CherryStudio')` now uses
`PRODUCT_DIRNAME`.

**`branding.ts`** — added `PRODUCT_DIRNAME = 'TheBoss'` (space-free; it becomes a
real directory on every platform).

## Behavioral contract change

Five existing tests asserted `setPath` was **not** called in the fall-through case —
that was the bug. They now assert the branded path, and were renamed from
"falls through, no setPath" to "falls through to the branded path" so the names
match what they verify.

## New coverage

- `an existing upstream Cherry Studio directory is never adopted as userData` —
  the legacy dir is present and adoptable under the default fs stub, and must still
  be ignored.
- `the branded userData path does not depend on the display name` — stubs a renamed
  app and asserts the path does not follow it. This is the regression guard for the
  data-loss scenario.

**Mutation-checked:** reverting the explicit `setPath` fails 7 tests including both
new guards, so these assert the contract rather than pinning behavior.

## Evidence

- `pnpm test:main` → **1031 files / 16383 tests passed**, 0 failed
- `pnpm lint` → exit 0 (4 typecheck projects, 76011 translations, format clean)
- Two test files repointed at the constants rather than re-pinned to new literals:
  `BootConfigService` (`CONFIG_PATH`), `pathRegistry` (temp path)

## Not done here (correctly out of scope)

No migration of existing profiles — D1 is start-clean. Verifying a real packaged
launch (create data → relaunch → same directory) needs `pnpm build:unpack` and a
manual run; the unit tests cover the resolution logic.
