# Project installation contract

`install-project` is separate from proposal-only `export`. It accepts JSON through
`--input`, with optional `--project`, `--team`, `--target`, `--dry-run` and `--check`
overrides. JSON preserves spaces and Unicode paths. Native Windows drive and UNC
paths run on Windows; a POSIX host rejects them rather than writing to a misleading
local path. Node 22+ is the only runtime dependency.

Request fields:

| Field | Meaning |
| --- | --- |
| `project` | Existing authorized project directory |
| `team` | Optional schema-v1 project manifest to install |
| `teamId` | Explicit active team selection |
| `target` | Existing adapter target; defaults to recorded target, then team harness |
| `updateTeam` | `true` only when intentionally replacing a differing manifest |
| `dryRun` | Preflight and report changes without any writes |
| `check` | No writes; CLI exit 2 when changes are required |
| `zed` | Defaults true; include Zed's effective instruction file |
| `minimaxDataDirectory` | Explicit project-relative MiniMax data directory; launcher must set `MINIMAX_DATA_DIR` accordingly |

No team selection is guessed when multiple candidates remain. The project routing
record retains an explicit selection across reruns. A stale selection is an error,
not permission to switch silently. Candidate manifests live at
`.agent-team/<team-id>/team.json` and must match the directory's identity.

Installation renders native definitions using the existing adapters. Only native
project agent paths and missing associated config files are installed; plugin
marketplaces, service registrations and exports are not activated. Existing native
file contents are retained exactly, preserving permissions, model settings and
concurrency limits. Differing native files are reported for a deliberate merge;
the shared project instructions apply updated role skill bindings meanwhile.
MiniMax global user files are never written by this project operation. UAR and
BossFang registration remain separate operations. A record with no native agent
files explicitly uses sequential role instructions.

Both instruction entrypoints receive one `prometheus-team-routing` managed block.
Existing prose and CRLF are retained. Existing in-project links remain links and
shared targets are edited once. Broken links and links escaping the project are
rejected. All managed markers and paths are checked before writes. Updates retain
exact previous content and resulting hashes in `.agent-team/recovery/<hash>.json`;
a write failure rolls back changed files. Recovery content may include project
instructions; handle it as project data and do not publish it automatically.

Zed loads its first matching file in this order: `.rules`, `.cursorrules`,
`.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`,
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. The effective existing file receives the
pointer in addition to the two standard entrypoints. External ACP agents retain
their own native configuration. Zed's parallel thread UI is not a delegation API.
Source: [Zed instructions](https://zed.dev/docs/ai/instructions).

The installer does not assert that the current harness discovered or invoked an
agent. `nativeDefinitions` lists actual project files (existing or planned), while
the record's limitations distinguish definition presence from live execution.
If delegation is unavailable, select role instructions sequentially and report
the limitation. A separate reviewer context is required for independent review.

UI roles bind the router, not every catalog entry. It defers design context,
focused Pro Max queries, one craft selection and platform selection to
`prometheus-ui-ux`. Review binds `prometheus-ui-review`, excludes taste guidance,
and runs only after the complete implementation phase. Backend tasks do not load
either UI workflow. Preserve upstream `disable-model-invocation` restrictions;
directly reading a user-only skill is not an invocation workaround.

Generated native skill preloads omit the two conditional UI routers and the
known user-only workflows `interface-review`, `break`, `variant` and
`explain-interface`. The manifest retains these role bindings, and conditional
role instructions activate UI guidance only for UI work. Explicit operator
`native.<target>.skills` overrides are preserved and conflicting preload requests
produce diagnostics requiring resolution before native invocation. Existing
installed native files are never silently rewritten to change an operator policy.
