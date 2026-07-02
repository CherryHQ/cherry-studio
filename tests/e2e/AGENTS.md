# E2E Authoring Flow (for AI agents)

How to add or change an e2e test in this repo. Five stages, in order: **Spec → Code → Verify → Test → Green**. Playwright is the deterministic gate; agent-browser is only an authoring aid in Verify.

```
SPEC ──▶ CODE ──▶ VERIFY ──▶ TEST ──▶ GREEN
定义验收   实现功能   预演确认     写 spec   全通过
```

## 1. Spec — decide what to assert

Write the acceptance criteria in natural language first (page → action → expected). Keep it about
behavior, not selectors.

## 2. Code — implement the feature

Add `data-testid` to the elements the test will target. **testid-first** is the whole reason
Playwright stops being "脆": never gate on a CSS class or DOM structure.

## 3. Verify — preview with agent-browser (optional, non-gating)

Drive the running app once with [agent-browser](https://agent-browser.dev/) to discover the real
DOM, harvest stable refs, and catch UX problems before writing the test. Its verdicts are
LLM/non-deterministic → use them to author, never to gate. Nothing from this stage is committed.
Running against a remote/pre-configured environment (golden profile, agent-browser preinstalled)?
See skill `e2e-run` for the remote Verify/Green workflow.

## 4. Test — write the Playwright spec

Now the selectors are known, write the spec under `tests/e2e/specs/<domain>/`. Conventions:

- **Selector priority**: `data-testid` → `getByRole(role, { name })` → text. No class/structure.
- **Page Objects** in `tests/e2e/pages/` hold the locators; specs stay readable.
- **Seeded state**: import `test`/`expect` from `fixtures/seeded-electron.fixture` when the case
  needs golden state (a pre-seeded KB, configured providers, …). It launches against a per-test
  COPY of `~/.cherry-e2e/golden-profileDev`, never the real profile.
- **Native pickers**: a file/folder dialog would block the run. Use `picker.stub([path])` from the
  seeded fixture — it overrides `dialog.showOpenDialog` in the main process (no OS dialog, no
  `osascript`, zero product change). Resolve fixture paths via `fixturePath('<key>')`
  (logical keys from `~/.cherry-e2e/secrets.local.json`; never hardcode absolute paths).
- **Waits**: prefer auto-retrying assertions (`toHaveCount`, `toBeVisible`) and the helpers in
  `utils/wait-helpers.ts` over `waitForTimeout`.
- **Full-tier (live LLM) specs**: tag the outer `test.describe` with `{ tag: '@full' }` — remote
  tier-filtering (`--grep @full` / `--grep-invert @full`, see skill `e2e-run`) relies on it.

Two Electron facts worth keeping in mind:

- Launch with `args: ['.']` (repo root) so `app.getAppPath()` contains the `file://` renderer —
  otherwise IpcApi rejects the renderer as an untrusted sender and writes silently fail.
- The main window is the one whose URL contains `/windows/main/index.html` (not by title — the dev
  build's title varies).

## 5. Green — run it

```bash
pnpm build                                              # specs run against out/ — rebuild after code changes
pnpm test:e2e tests/e2e/specs/knowledge/add-file.spec.ts # one spec while iterating
pnpm test:e2e                                            # full suite before release / after a big refactor
```

E2E does **not** run in CI (slow, env-heavy). CI runs typecheck + build only. Run e2e locally:
the relevant spec after a feature, the full suite before a release or a large refactor.
