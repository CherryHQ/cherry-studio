---
name: e2e-run
description: Rehearse a UI flow with agent-browser before writing a deterministic Playwright spec (the Verify stage of tests/e2e/AGENTS.md), run tests/e2e/ specs on a remote/pre-configured test machine, and — when triggered by an IM message (e.g. `run <tier> [domain] [on <ref>]`) — sync the branch, run the matching specs, and report pass/fail back to the chat. Use when adding/changing an e2e test, asked to run the e2e suite remotely, or triggered to gate a branch/PR.
---

# e2e-run

Remote-execution helper for `tests/e2e/AGENTS.md`'s **Verify** and **Green** stages, plus the
automated "someone asks in chat, get a report back" loop. Nothing it produces (screenshots, scratch
specs, agent-browser output, reporter JSON) is committed — the only durable output is the
pass/fail message it sends back.

## Prerequisites

- SSH access to the test machine. `$ARGUMENTS` (or ask the user) gives `<host>` — never hardcode a
  specific machine here, it's environment-specific and lives outside the repo.
- Reuse one worktree per branch, don't create/destroy per run — it carries a full `node_modules`
  (multi-GB): `~/.cherry-e2e/worktrees/<branch-slug>` (`/` in the branch name → `-`). To sync:
  ```bash
  ssh <host> "zsh -lic '
    WT=~/.cherry-e2e/worktrees/<branch-slug>
    lockf \"\$WT/.e2e.lock\" bash -c \"
      cd \$WT &&
      git fetch origin <branch> && git reset --hard FETCH_HEAD &&
      pnpm install --frozen-lockfile
    \"
  '"
  ```
  `lockf` (macOS-native, `/usr/bin/lockf` — this test machine has no `flock`, that's Linux-only)
  serializes concurrent triggers against the *same* worktree; different branches get
  different worktrees and don't contend. `pnpm install` is fast when the lockfile didn't change.
  Do not hand-edit files or run any other git operation there — only fetch/reset to the ref you were
  asked to test.
- `agent-browser`, `pnpm`, and `node` (via mise) are pre-installed there. Use a login shell
  (`ssh <host> "zsh -lic '...'"`) so mise's shims resolve — a plain non-interactive `ssh` command
  will not find `pnpm`/`node`.

## Verify — rehearse before writing the spec

1. Launch the dev app against a **scratch copy** of the golden profile — never the real
   `golden-profileDev` (see "Multi-instance isolation" below for the full isolation rules; this is
   the minimal version for a single ad-hoc rehearsal session):
   ```bash
   ssh <host> "zsh -lic '
     cd ~/.cherry-e2e/worktrees/<branch-slug> &&
     RUN=~/.cherry-e2e/run-$$ &&
     cp -R ~/.cherry-e2e/golden-profileDev \"\${RUN}Dev\" &&
     PATH=\$PWD/node_modules/.bin:\$PATH dotenv -- electron-vite -- \
       --remote-debugging-port=<port> --user-data-dir=\"\$RUN\" &
   '"
   ```
   Poll `<port>` until it's listening (electron-vite + DB migrations can take 20-30s).
2. Connect and drive it by semantic ref, not raw CSS:
   ```bash
   ssh <host> "agent-browser connect <port> && agent-browser tab"     # pick the localhost:<vitePort> main window — not a mini-app webview target
   ssh <host> "agent-browser snapshot -i"                             # accessibility tree: button "..." [ref=eN]
   ssh <host> "agent-browser click @eN"                               # drive by ref
   ```
3. Record the **stable** selector each step resolved to (prefer `data-testid`; add one in the Code
   stage if the element doesn't have one yet — testid-first, per AGENTS.md). Nothing from this
   stage gates anything — agent-browser's own pass/fail verdicts are LLM/non-deterministic and are
   only an authoring aid.
4. If agent-browser can't reach the right target (multiple CDP targets — e.g. a mini-app webview,
   see `cherry-pr-test`'s troubleshooting section), fall back to a throwaway spec: write
   `tests/e2e/specs/_explore.spec.ts`, `scp` it to the worktree on the test machine, run it with
   `pnpm test:e2e tests/e2e/specs/_explore.spec.ts`, and pull back `mainWindow.screenshot()` /
   `page.locator('body').innerText()` dumps to inspect locally. Delete the scratch file on both
   sides once the real spec is written — it's not part of the deliverable.
5. Kill the scratch app and delete its userData copy (`rm -rf "${RUN}Dev"`) when done. Never touch
   `golden-profileDev` itself.

## Green — run specs on the test machine

```bash
ssh <host> "zsh -lic 'cd ~/.cherry-e2e/worktrees/<branch-slug> && pnpm test:e2e <path/to/spec.ts>'"
```

Prefer a single spec while iterating; run the full suite before a release or a large refactor
(same policy as running locally, per AGENTS.md's Green stage). `pnpm test:e2e` already isolates
each test against its own copy of the golden profile via `fixtures/seeded-electron.fixture.ts` and
`fullyParallel`s across workers (`playwright.config.ts`) — you don't need to manually launch/copy
profiles for this path, that's only for the Verify rehearsal above.

## Automated trigger — `run <tier> [domain] [on <ref>]`

When asked (e.g. via an IM bridge relaying a chat message) to run a tier/domain on a branch or PR
and report back, do the following. There is no compile/YAML step — this reads the plain
`tests/e2e/specs/` Playwright suite directly.

1. **Parse** `tier` (`light` | `medium` | `full`), optional `domain` (`knowledge` | `websearch` |
   `fileprocessing`, default = all three), optional `on <ref>` (branch/PR/`HEAD`, default = current
   worktree tip). `light` and `medium` currently select the **same** set of specs (see "Tier
   granularity" below) — both mean "the deterministic, gating specs."
2. **Sync**: resolve `<ref>` to a branch (`gh pr checkout` first if it's a PR number), then run the
   worktree sync from Prerequisites.
3. **Select specs**: domain is a path, tier is a Playwright tag (`@full`, applied to every full-tier
   spec's outer `test.describe`):
   ```bash
   # full tier
   pnpm test:e2e tests/e2e/specs/<domain>/ --grep @full --reporter=json > /tmp/e2e-report.json
   # light/medium (deterministic)
   pnpm test:e2e tests/e2e/specs/<domain>/ --grep-invert @full --reporter=json > /tmp/e2e-report.json
   ```
   Omit `tests/e2e/specs/<domain>/` entirely when no domain was given (runs all three).
4. **Read the result**: `/tmp/e2e-report.json` is Playwright's JSON reporter output — no custom
   parser needed, just read it directly (`jq '.stats'` for `expected`/`unexpected`/`skipped`/
   `flaky`; walk `.suites[].specs[].tests[].results[].error.message` for failures). Failure
   screenshots are already on disk per `playwright.config.ts`'s `screenshot: 'only-on-failure'`, at
   `test-results/<test-name>/test-failed-1.png`.
4b. **Investigate before reporting a failure**: don't just relay the raw Playwright error. First
   read the failing spec file itself — its top-of-`describe` doc comment often already documents a
   known root cause (see `kb-manage.spec.ts` for the pattern: a "KNOWN FAILING" block naming the
   exact defect and the files involved) and, if so, that *is* the diagnosis — summarize it instead
   of re-deriving it. If the comment doesn't explain it (a genuinely new failure), do a quick
   pass yourself: skim the relevant source file(s) the spec exercises, and give your best-effort
   read on the likely cause rather than only pasting the stack trace. State uncertainty honestly
   when the cause isn't clear from a quick look — a hedged guess beats a confident wrong one, and
   either beats silence.
5. **Report** (see "Reporting to chat" below): one message on success, a diagnostic message (+ one
   representative failure screenshot) on failure — include the root-cause summary from step 4b,
   not just "test X failed". A failure inside an `@full` spec is **reported, not gating** — say so
   explicitly in the message, don't treat it as a run failure.
6. **Clean up**: the worktree itself is reused (don't remove it); only clean up anything the run
   wrote outside it (see "Multi-instance isolation").

### Tier granularity (know this before someone asks for exact "light-only")

Unlike the retired YAML framework (three cumulative tiers: medium ⊇ light, full separate), the
current Playwright specs only carry one tag (`@full`). `light` and `medium` both map to "every spec
without `@full`" — there's no mechanical way to run *only* light or *only* medium right now. If
that precision is needed, it requires tagging every light/medium spec individually (`@light`/
`@medium`) — a deliberate follow-up, not implied by adding `@full`.

### Reporting to chat

The chat/report channel is environment-specific (which chat, which identity to send as) — get it
from whoever configured the trigger (e.g. the local `AGENTS.override.md` on this machine), never
hardcode a chat ID or profile name in this skill.

```bash
LARKSUITE_CLI_CONFIG_DIR=<profile's lark-cli config dir> lark-cli im +messages-send \
  --chat-id <chat-id> --as bot --markdown "<summary>"
# on failure, additionally:
cd <dir containing the screenshot> && \
LARKSUITE_CLI_CONFIG_DIR=<profile's lark-cli config dir> lark-cli im +messages-send \
  --chat-id <chat-id> --as bot --image ./test-failed-1.png
```
`--image` uploads the file itself, no separate upload-then-reference step — but it rejects an
absolute path (`--file must be a relative path within the current directory`); `cd` into the
screenshot's directory first and pass a relative path. Validate the command with `--dry-run`
first. **Never send a live message to a shared chat without it being part of an actual triggered
run** — a stray test/ping message is visible to everyone in that chat.

## Multi-instance isolation & disk hygiene

Other e2e runs (interactive or triggered) may be happening on the same machine at the same time.
Every run — Verify rehearsal or an automated trigger — must be self-contained:

- **Never launch directly against `golden-profileDev`.** Copy it per run:
  `RUN=~/.cherry-e2e/run-<unique-id>`; `cp -R ~/.cherry-e2e/golden-profileDev "${RUN}Dev"`; launch
  with `--user-data-dir="$RUN"` (dev mode appends the `Dev` suffix itself, landing on `${RUN}Dev`).
- **Independent port** for `--remote-debugging-port` — never the hardcoded `pnpm debug` port
  (9222), and never run two instances on the same port.
- **Scoped kill only** — locate and kill by this run's own port/userData path. Never a global
  `pkill Electron` or a kill of a fixed port; that can take down someone else's run.
- **AeroSpace window placement is automatic** — the test machine's `aerospace.toml` has an
  `on-window-detected` rule (`if.app-id = 'com.github.Electron'` → `move-node-to-workspace A`) that
  tiles every detected dev-Electron window into workspace `A` on its own, no manual
  `list-windows`/`move-node-to-workspace` step needed for the Verify rehearsal or any ad-hoc
  `electron-vite` launch. `pnpm test:e2e`'s own Playwright-driven instances land there too but don't
  rely on it. Concurrent manual instances now tile together inside `A` rather than getting separate
  letters — fine since ad-hoc rehearsal is normally one session at a time. Never move or close
  another instance's window.
  - `playwright.config.ts` runs specs serialized (`fullyParallel: false`, `workers: 1`), not in
    parallel — concurrent Electron instances were seen contending for CPU/GPU enough to widen UI
    transition races (a navbar-intercepts-click flake on `agent-kb.spec.ts`/`assistant-kb.spec.ts`,
    reproduced under `workers: 3`). A full-suite run is correspondingly slower; that's the tradeoff.
- **Clean up your own run's output only**: kill your scoped process, `rm -rf` your `${RUN}Dev`
  (trap it on exit so interrupts still clean up), and write any screenshots/logs you want to keep
  under `/tmp/<something-scoped>/` rather than inside `~/.cherry-e2e/`.
- **Disk whitelist**: `~/.cherry-e2e/` should only ever durably contain `golden-profileDev` and
  `secrets.local.json` (+ `.bak`). Anything else there (stray `run-*`/`run-*Dev`, loose logs/
  screenshots) is cleanup debt from an earlier run — safe to remove if nothing is currently using it
  (check `ps` for the corresponding `user-data-dir` before deleting).
- **`golden-profileDev` is read-only** from every run's perspective. Only touch it during an
  explicit, user-requested golden-maintenance session (checkpoint the WAL afterwards:
  `sqlite3 cherrystudio.sqlite 'PRAGMA wal_checkpoint(TRUNCATE);'`).

## Constraints

- Only do what you were explicitly asked to on the test machine — no autonomous merges, commits,
  pushes, or contract/schema changes there. Repo changes are decided and made from your own
  checkout, then synced over; on the test machine you only fetch/reset to the ref under test.
- Never hardcode a chat ID, bot profile name, or specific hostname in this file — it's committed
  and shared; those are environment-specific and belong in the caller's local config.
- Never touch `golden-profileDev` directly; always work against a scratch copy, and clean it up.
- Kill your scratch app afterwards; never leave a debug process running.
