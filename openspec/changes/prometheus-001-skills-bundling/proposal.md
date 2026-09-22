## Why

The Prometheus mini skill pack (22 skills) must ship inside The Boss on every platform, Windows
first, and be present even on a machine where the app has run before.

Most of this already exists. `installBuiltinSkills()` (`src/main/utils/builtinSkills.ts:31`) runs
on **every** startup from `AiService.ts:407`, copies each directory under `resources/skills/` into
`{userData}/Data/Skills/`, registers it, and mirrors it into `CLAUDE_CONFIG_DIR/skills`. Updates
are gated on a **content hash** (`SkillService.ts:1142`), not a version string — so the 21 mini
skills that declare no `version:` are handled correctly with no change.

Two things are missing: the skills are not in `resources/skills/`, and `syncBuiltinSkill`'s
`namespace` parameter (`SkillService.ts:1123`, guards at `:1127-1137`) is never passed, so a
Prometheus skill and a Cherry skill of the same folder name would collide.

## What Changes

- Vendor `prometheus-skills-mini` as a git submodule (markdown + Node, no compile step).
- **Ship the RUNNABLE pack, not only its skills.** `prometheus-003` and `prometheus-004` spawn
  `node scripts/doctor.mjs` and `node scripts/services.mjs` from an app-data copy; those entry
  points need `lib/`, `rules/` and `scripts/` beside them. Shipping `skills/` alone would leave
  both changes spawning files that are not there. The pack is therefore copied into app resources
  as a unit and installed into `{userData}` on startup, and `resources/skills/` remains the
  separate, already-working path by which the 22 skills reach the skill registry.
- **Vendor the `openspec` fork as a submodule too** (goal B6). It is Node, it is a build/dev
  dependency rather than a shipped runtime binary, and it carries the Windows-compatibility fixes;
  it is the one tool consumed as source here rather than as a downloaded artifact.
- Add `scripts/sync-mini-skills.ts` with a `--check` mode, following the existing
  `build:builtin-knowledge` / `build:builtin-knowledge:check` precedent
  (`scripts/generate-cherry-assistant-knowledge/index.ts:53-69`): it copies the submodule's
  `skills/*` into `resources/skills/` and fails CI when the tracked copies are stale. Excludes
  `carried-payload.test.mjs` and `AGENTS.md`, which are repo tooling and not skills.
- Pass a `prometheus` namespace from `builtinSkills.ts:53` into `syncBuiltinSkill`, so the 22
  never collide with the 5 Cherry builtins. No collision exists today, but folder names are not
  ours to control.

## Impact

- Affected: `.gitmodules` (two submodules: the mini and the openspec fork), `resources/skills/**`
  (22 directories), the app-data copy of the runnable pack, `scripts/sync-mini-skills.ts`,
  `src/main/utils/builtinSkills.ts` (one argument), `package.json` scripts.
- **`prometheus-003` and `prometheus-004` depend on the app-data copy this change creates.** They
  spawn from it; without it they have nothing to spawn.
- `pnpm skills:check` already gates `ci:basic-check`; the new `--check` joins it.
- No new top-level directory; no new service; no migration.

## Non-goals

- The home-directory push to `$HOME/.agents` / `$HOME/.claude` — that is `prometheus-003`.
- Any Rust binary — that is `prometheus-002`.
- Changing how Cherry's own five builtin skills are managed.
