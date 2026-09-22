## ADDED Requirements

### Requirement: The Prometheus skills ship with the app and install on every startup
The 22 skills from the `prometheus-skills-mini` submodule SHALL be present in
`resources/skills/` so that `installBuiltinSkills()` installs them on every launch, including on a
machine where the app has run before. The existing content-hash gate
(`SkillService.computeBuiltinDirectoryHash`) governs updates; no version field is required of a
skill, and none SHALL be added to satisfy this.

#### Scenario: A first launch installs them
- **WHEN** the app starts on a machine with no `{userData}/Data/Skills/` entries for them
- **THEN** all 22 appear there and are mirrored into `CLAUDE_CONFIG_DIR/skills`

#### Scenario: A later launch with unchanged content rewrites nothing
- **WHEN** the app starts again and the bundled content is byte-identical
- **THEN** the directory hash matches and no files are rewritten

#### Scenario: A skill without a version field still installs
- **WHEN** a bundled skill's `SKILL.md` declares no `version:`
- **THEN** it installs, its name falling back to the folder name

### Requirement: Bundled Prometheus skills are namespaced
`syncBuiltinSkill` SHALL be called with a `prometheus` namespace for skills originating in the
submodule, so a folder-name clash with a Cherry builtin is refused by the existing ownership guard
rather than silently overwriting.

#### Scenario: A cross-namespace clash is refused
- **WHEN** a Prometheus skill and a Cherry builtin share a folder name
- **THEN** the sync throws naming both namespaces, and neither is overwritten

### Requirement: The tracked copies cannot drift from the submodule
`resources/skills/` is git-tracked, so a sync script SHALL provide a `--check` mode that fails when
a tracked copy is missing or differs from the submodule, and it SHALL be part of `ci:basic-check`.
Repo tooling that is not a skill — `carried-payload.test.mjs`, `AGENTS.md` — SHALL NOT be copied.

#### Scenario: A stale copy fails CI
- **WHEN** the submodule advances and `resources/skills/` is not re-synced
- **THEN** `--check` exits non-zero naming the stale path

#### Scenario: Non-skill files are excluded
- **WHEN** the sync runs
- **THEN** no `carried-payload.test.mjs` or `AGENTS.md` appears under `resources/skills/`
