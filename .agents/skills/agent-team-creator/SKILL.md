---
name: agent-team-creator
description: "Create the smallest useful coding agent team for a task, with guided role discovery and native exports for UAR, Codex, Claude Code, Copilot, Kimi Code, MiniMax CLI, OpenCode and DeepSeek. Use when a user asks to create, configure or choose an agent team; use agent-team-manage for existing task state. Do not use for existing task updates (see agent-team-manage)."
license: MIT
compatibility: Requires Node.js 22 or newer. Git is optional for handoff snapshots. Model gateways, memory services and native harness CLIs are optional and separately configured.
metadata:
  version: "1.1.0"
  tags: "agents, teams, orchestration, coding"
---

# Agent Team Creator

Help the user choose a useful team, then create inspectable definitions. A role
describes responsibility; a skill provides reusable instructions; a model supplies
capability; a harness owns execution. Do not turn these into one interchangeable
concept or start a second agent loop.

## Start with the task

Read project instructions and any active KBD work first. Reuse answers already
given. Ask only for missing outcome, scope, deliverables, budget preference and
review needs. Use ordinary language: “Is this one isolated change, or does it
span design, implementation and verification?” The user need not know agent
terminology. Choose a short team ID and explain it rather than requiring jargon.

Use [assets/intake.json](assets/intake.json) as the JSON request shape. `guide`
returns missing intake fields when answers are incomplete, or a proposed team
with role explanations and a single-agent alternative. Once task details are known,
the guide returns `proposedRoles` and ownership questions until every proposed role
has output paths in `ownership: {"role-id": ["relative/path/**"]}`. Inspect the
project, suggest concrete disjoint paths, and reuse known scope. Reviewers can read
broadly but need a separate findings output path. Only `ready: true` returns `team`:

```text
node <this-skill>/scripts/cli.mjs guide --input intake.json
```

Recommend one implementer for a small isolated task. Add specialists only for
concrete work that can be assigned separately. Independent review costs another
pass; explain that tradeoff. Let the user refine roles using their existing
authorization and preferences. Do not require a ritual confirmation for every
reversible file creation. Experts may supply a manifest directly.

The guide’s skill IDs are suggestions, not assertions that anything is installed.
Discover actual installed skills or use an available skills directory/search.
Inspect each chosen skill’s provenance, scope, tools and instructions. Replace
unavailable suggestions, or propose installation when needed; do not silently
install external code. Bind discovered skills to each role’s `skills` array.

## Define and export

Save the proposed `team` from guide output. Fill `owns`, inputs, outputs and
dependencies for each role before parallel edits. Empty ownership is unresolved,
not permission over the repository. The [manifest reference](references/manifest.md)
and [JSON schema](schemas/team.schema.json) define the common contract.

Select models with `$agent-team-models`: declared strength, required capabilities,
and known prices, followed by concrete IDs. Tier labels alone do not configure a
native model. Every native option can be carried in `native.<target>.options`,
role-native overrides, or exact `native.<target>.files`. Read
[native harness contracts](references/native-harnesses.md) for the selected
target’s mapping, source, plugin support and limitations. Do not load every
harness manual for a single-target task.

```text
node <this-skill>/scripts/cli.mjs validate --input team-request.json
node <this-skill>/scripts/cli.mjs init --input team-request.json
node <this-skill>/scripts/cli.mjs export --input export-request.json
```

`team-request.json` contains `{"team": <manifest>, "state": <local-state-path>}`.
`export-request.json` contains `{"state": <local-state-path>, "target": "codex",
"out": <new-proposal-directory>}`. Targets are `uar`, `codex`, `claude`,
`copilot`, `kimi`, `minimax`, `opencode`, `deepseek`, and the separate `bossfang`
integration. MiniMax means its own `mcode` CLI.

Export never overwrites an existing output directory or native configuration.
Inspect `team-export.json`, diagnostics, native files and the source/version
receipt. Preservation of arbitrary options is not semantic validation. Validate
with the installed harness when available, or report source-only support. Confirm
what a probe enumerates: CLI availability, running sessions, custom-role discovery
and actual invocation are different evidence. For Claude, read the
[validation caveat](references/native-harnesses.md#claude-code-validation).

## Install and operate within the requested scope

Normal project-team creation finishes with `install-project` after inspecting the
staged export. Creation authorized for a project includes installing its discovery
instructions; do not stop at an export and leave the team undiscoverable.

```text
node <this-skill>/scripts/cli.mjs install-project --input install-request.json --dry-run
node <this-skill>/scripts/cli.mjs install-project --input install-request.json
node <this-skill>/scripts/cli.mjs install-project --project <project-directory> --check
```

An installation request contains `{"project": "<directory>", "team": <manifest>}`.
For existing teams, omit `team`: a sole `.agent-team/<id>/team.json` is selected
automatically; an existing `.agent-team/project-routing.json` selection wins.
Use `teamId` (or `--team`) to select explicitly when several teams exist. For an
intentional update to an existing manifest, include `updateTeam: true`. See
[project installation](references/project-installation.md) for the complete contract.

The installer binds `prometheus-ui-ux` to design, creative direction and UI
implementation roles, and `prometheus-ui-review` to UI review roles. It preserves
role IDs and ownership. These are conditional routing skills: backend work must
not activate UI guidance. UI review receives no taste skill or permission to
bypass upstream user-only invocation restrictions. The complete protocol is loaded
only for UI work, with `.agents/UI_UX_PROTOCOL.md` taking precedence over the
bundled protocol. Actual platform manifests and model family determine routing.

Managed pointers in both `CLAUDE.md` and `AGENTS.md` default **all code work** to
the selected team's relevant roles. Zed's higher-priority existing instruction
file receives the same pointer. No automatic delegation API is invented: when the
active harness cannot delegate, use those role instructions sequentially, report
the limitation, and never label builder-context review independent.

Apply reviewed proposals only where the user authorized them. Merge existing
native configuration deliberately; never replace it wholesale. `install-project`
creates missing native definitions from the same adapter used by export, preserves
all existing native files, and reports differences for a deliberate merge. Follow the
native reference for supported project agents or plugin/marketplace installation.
Do not invent plugin agent fields where a harness has none. A plugin installation
does not start an agent team.

For UAR or BossFang, keep registry registration, activation and execution separate.
Use the exported native payload and verified route, operator-selected instance
URL and environment credential reference. Record each returned native ID and
outcome; multi-agent registration is not atomic. BossFang Hands and standalone
agent/workflow registration are alternative native deployment paths. Choose one.
Do not auto-activate a Hand or run a workflow merely because definitions exist.

For actual work, the chosen harness owns native spawning, permissions, sessions,
subagent depth and model overrides. Use its available tools/current CLI contract;
the team ledger does not schedule processes or enforce Cedar. Resolve missing
native capabilities explicitly. Use `$agent-team-manage` for tasks and
`$agent-team-handoff` when changing owners/harnesses.

## Evidence and recovery

Report generated paths, roles and rationale, chosen model policy, native support
level, unresolved ownership/configuration and the next authorized action. Never
report export as live execution. Node 22+ runs the compiled package without a
root checkout or runtime dependencies. Maintainers rebuild the `.mts` source
with pinned TypeScript 7.0.2 under `runtime/`; full and mini ship identical bytes.

The local state is a coordination record for trusted collaborators, not a
distributed authorization service. See [task and handoff contracts](references/task-handoff.md)
for revision/lock recovery and [models and memory](references/models-memory.md)
for optional shared services and Karpathy boundaries. Existing KBD state stays
authoritative; never hand-edit its generated projections.
