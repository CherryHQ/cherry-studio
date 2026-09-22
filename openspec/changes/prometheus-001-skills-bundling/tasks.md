Surgical: one submodule, one script, one argument. Verify with `pnpm lint` and the targeted test
runners, not the whole repo.

## 1. Vendor

- [ ] 1.1 `git submodule add https://github.com/Prometheus-AGS/prometheus-skills-mini` under a path that fits the closed-set rule — confirm with the repo layout before choosing; do NOT create a new top-level directory.
- [ ] 1.2 Pin to a released commit. Record the SHA in the proposal.
- [ ] 1.3 Vendor the `openspec` fork as a second submodule (goal B6) — `https://github.com/Prometheus-AGS/openspec`, pinned to the commit `the-boss-release-infrastructure` §3 releases. Confirm the path obeys the closed-set rule.
- [ ] 1.4 Record which the-boss call sites consume it. **If none do today, say so plainly in the proposal rather than vendoring source nothing runs** — goal B6 says it must be used, so an unused submodule does not satisfy it.

## 2. Sync script

- [ ] 2.1 Write `scripts/__tests__/sync-mini-skills.test.ts` FIRST: copies every skill dir; excludes `carried-payload.test.mjs` and `AGENTS.md`; `--check` exits non-zero when a tracked copy is missing or stale and zero when current.
- [ ] 2.2 Write `scripts/sync-mini-skills.ts` modelled on `scripts/generate-cherry-assistant-knowledge/index.ts:53-69`. Add `skills:sync:mini` and `skills:sync:mini:check` to `package.json`; wire the check into `ci:basic-check`.
- [ ] 2.3 Run it; commit the 22 resulting `resources/skills/` directories.

## 3. App-data copy of the runnable pack

- [ ] 3.0 Test first: after startup, `{userData}`-resolved pack root contains `scripts/doctor.mjs`, `lib/` and `rules/`, and `node scripts/doctor.mjs` from there exits 0 or 1 (never 2, which means it could not run). **`prometheus-003` and `prometheus-004` spawn these; shipping `skills/` alone would leave both spawning files that do not exist.**
- [ ] 3.1b Copy the pack into app resources and install it into `{userData}` on startup, alongside the existing per-skill install. Paths via `application.getPath(...)`; no new top-level directory.

## 4. Namespace

- [ ] 4.1 Test first: a builtin synced under namespace `prometheus` is rejected when a builtin of the same folder name exists under a different namespace (the guard at `SkillService.ts:1127-1137` already implements this — assert the contract, do not re-test the guard).
- [ ] 4.2 Pass `'prometheus'` as the fourth argument from `builtinSkills.ts:53` for directories originating in the submodule. Cherry's own five keep the default namespace.

## 5. Verify

- [ ] 5.1 `pnpm exec vitest run scripts/__tests__/sync-mini-skills.test.ts` and the SkillService suite.
- [ ] 5.2 `pnpm lint` (covers format, typecheck, i18n:check).
- [ ] 5.3 Launch the app; confirm the 22 appear in `{userData}/Data/Skills/` and are mirrored into `CLAUDE_CONFIG_DIR/skills`. Paste the directory listing.
- [ ] 5.4 **Windows:** repeat 4.3 on a real Windows machine. Everything above is macOS-observed; the Windows claim is unverified until this runs.
