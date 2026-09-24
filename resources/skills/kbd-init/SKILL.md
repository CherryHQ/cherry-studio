---
name: kbd-init
description: Use once per project, before any other KBD command — auto-discovers project identity, stack, and constraints from existing context files (AGENTS.md, CLAUDE.md, README.md, package.json, Cargo.toml, pyproject.toml, etc.) and generates .kbd-orchestrator/project.json and .kbd-orchestrator/constraints.md.
---

# /kbd-init

Initialize the KBD orchestrator for the **current project**.

> `/kbd-init` owns full project configuration discovery. Phase creation and
> advancement helpers own `project.json.activePhase`, preserve unrelated keys,
> and remove the legacy `active_phase` alias. If metadata is missing, those
> helpers may bootstrap minimal identity and active-phase metadata; this does
> not replace `/kbd-init` for full stack, policy, and constraint discovery.

## What this does

Scans the current repository to auto-discover project identity and configuration,
then generates two project-specific files:

1. `.kbd-orchestrator/project.json` — project context, stack commands, tool preferences
2. `.kbd-orchestrator/constraints.md` — project-specific blocking/warning rules derived
   from `AGENTS.md` "Never Do" section and known stack conventions

Resolve every `references/` and `scripts/` path in this skill relative to this
`SKILL.md`'s own directory (`skills/kbd-init/`). Never resolve resources
through another checkout or a cached copy of this pack.

## Discovery Algorithm

### Step 1: Project Name & Description

Read in priority order:

1. Explicit argument: `/kbd-init "My Project Name"`
2. `AGENTS.md` — first H1 or "Project Identity" section
3. `CLAUDE.md` — first H1 or executive summary first sentence
4. `README.md` — first H1
5. `package.json` → `name` + `description`
6. `Cargo.toml` → `[package] name` + `description`
7. `pyproject.toml` → `name` + `description`
8. Repository directory name (last resort)

### Step 2: Technology Stack Detection

Detect from lock files / config files:

| File Present | Stack |
|-------------|-------|
| `pnpm-lock.yaml` or `package.json` + `next.config.*` | Next.js (pnpm) |
| `package.json` + `vite.config.*` | Vite/React |
| `package.json` (no framework) | Node.js |
| `Cargo.toml` | Rust |
| `pyproject.toml` | Python |
| `go.mod` | Go |
| `build.gradle` | JVM |
| `*.sln` or `*.csproj` | .NET |

### Step 3: Build / Test / Lint Commands

Derive from package.json `scripts`, Cargo.toml, Makefile, or common conventions:

- Look for `build`, `test`, `lint`, `dev`, `check` script keys
- For Next.js: detect port from `pnpm run dev` script or default to 3000
- For Rust: `cargo check --workspace`, `cargo test --workspace`, `cargo clippy`
- Read `AGENTS.md`, `CLAUDE.md`, and equivalent project instructions for mandatory
  command wrappers, environment variables, toolchain selectors, and storage paths.
- Prepend those requirements to every affected command (for example, an nvm path
  or a mandatory `CARGO_TARGET_DIR`).
- Treat a command policy as transitive: apply it to `project.json` command fields,
  every compiling `command:` in `constraints.md`, and every generated workflow
  trigger. For chained commands, apply the required prefix to each affected
  command segment; a prefix on the first `cargo` command does not cover a later
  `cargo` command after `&&`.
- Never weaken, omit, or replace a mandatory external path merely because it is
  unavailable during initialization.

After deriving commands, perform a read-only prerequisite preflight:

1. Check required external roots or mounts for existence and writability.
2. Do not mount storage, create target directories, or substitute a local path.
3. If a required path is unavailable, continue generating configuration and mark
   execution as blocked in the final summary.
4. If the required command policy was not propagated to every affected command,
   stop and correct the generated configuration before reporting completion.

### Step 4: Spec Paths

Check in order:

1. `openspec/specs/*.md` — if `openspec/` directory exists
2. `docs/specs/*.md` — if `docs/specs/` exists
3. `docs/*.md` — fallback
4. None — set `openspec_available: false`

### Step 5: Constraints

Read `AGENTS.md` sections:

- "Never Do" → blocking constraints
- "Always Do" → derive as warning constraints if they have machine-checkable form
- "Code Style" → derive as warning constraints

Preserve explicit ownership and path exceptions. Do not infer that a directory is
disposable solely because it is hidden or named like tool state. Reconcile proposed
constraints with explicit project rules and existing tracked paths, and scope each
constraint so it does not contradict a documented exception.

Apply the command environment policy from Step 3 to every compiling `command:` or
workflow trigger emitted in this file.

If no `AGENTS.md`, use generic constraints from
`skills/kbd-init/references/constraints.md` in this project.

### Step 6: VSCode Workspace Discovery

Search for a `.code-workspace` file starting from the focus project's parent directory:

1. `<focus_project_path>/../*.code-workspace`
2. `<focus_project_path>/../../*.code-workspace`
3. `<focus_project_path>/*.code-workspace`

If found, read all `folders` entries and auto-assign roles:

| Heuristic                                                        | Role                                 |
| ------------------------------------------------------------------ | ------------------------------------- |
| Folder IS the focus project (cwd or contains `AGENTS.md`)        | `focus`                              |
| Folder name contains `MVP`, `legacy`, `spec`, `reference`, `old` | `reference`                          |
| Otherwise                                                          | Ask user: focus / reference / ignore |

For `reference` folders, detect useful read paths:

- `src/pages/Doc*.jsx`, `src/pages/DocPage*.jsx` — legacy spec files
- `docs/**/*.md` — documentation
- Root `*.md` files — readme/specs

Write the `workspace` block to `project.json`. If not found, set
`workspace.workspace_file = null` and use single-project mode.

See `skills/kbd-init/references/workspace-context.md` for the full specification.

### Step 7: Agent Preferences

If `AGENTS.md` contains an "Agent-Specific Notes" section referring to specific
tools, use those to populate `preferred_planning_agent` and
`preferred_execution_agents`. Otherwise default to a sensible planning agent
name for this harness and leave execution as an empty list.

## Output: `.kbd-orchestrator/project.json`

Generated from `skills/kbd-init/references/schemas/project.template.json` with
discovered values and conforming to
`skills/kbd-init/references/schemas/project.schema.json`:

```json
{
  "name": "<discovered project name>",
  "description": "<discovered one-line description>",
  "activePhase": null,
  "focus_project_path": "<absolute path to focus project root>",
  "spec_paths": ["<discovered spec paths>"],
  "openspec_available": true,
  "constraint_file": ".kbd-orchestrator/constraints.md",
  "build_health_command": "<detected build command>",
  "test_command": "<detected test command>",
  "lint_command": "<detected lint command>",
  "dev_command": "<detected dev command or null>",
  "preferred_planning_agent": "<from AGENTS.md or a sensible default>",
  "preferred_execution_agents": ["<from AGENTS.md or empty>"],
  "agents_config": { "...": "..." },
  "workspace": {
    "workspace_file": "<path to .code-workspace or null>",
    "folders": [
      { "path": "<focus>", "role": "focus", "write_access": true },
      {
        "path": "<reference>",
        "role": "reference",
        "write_access": false,
        "purpose": "<what to read from here>",
        "read_paths": ["<glob>"]
      }
    ]
  }
}
```

## Output: `.kbd-orchestrator/constraints.md`

Generated from `skills/kbd-init/references/constraints.md` in this project, with
project-specific blocking rules derived from `AGENTS.md`'s "Never Do" section.
Mandatory command environments apply to every affected command in this file, and
documented path-ownership exceptions remain explicit.

## Post-generation Validation

After writing both files, run the validator bundled beside this `SKILL.md`:

```bash
node skills/kbd-init/scripts/kbd-init-validate.mjs "<project-root>"
```

Resolve `skills/kbd-init/scripts/kbd-init-validate.mjs` from this project's
own root. The validator checks JSON readability and mandatory Cargo
environment propagation. It never writes project files.

- A configuration error is fatal: correct it before emitting the completion
  progress signal.
- An unavailable external prerequisite is non-fatal for initialization. Preserve
  the configured path and report:
  `initialization complete; execution blocked: required path unavailable: <path>`.
- When prerequisites are available, report that execution prerequisites are ready.

## Idempotency

- If `.kbd-orchestrator/project.json` already exists, print a diff of what
  would change and ask for confirmation before overwriting.
- Using `/kbd-init --force` skips confirmation and overwrites.
- Running `/kbd-init --dry-run` prints the discovered values without writing files.
  Apply the same command-policy and prerequisite checks in memory, including the
  execution-blocked warning when an external path is unavailable.

## Progress Signals (MANDATORY)

Before any other action, emit:

```
Starting kbd-init — <project-name or argument>
```

When all steps are complete, emit:

```
Completed kbd-init — <project-name or argument>
```

Use the project name from the argument or the discovered project name. Emit to plain response text — no tool call needed.

## How to invoke

```
/kbd-init                          # Auto-discover everything
/kbd-init "HotSeaters"             # Override project name
/kbd-init --force                  # Overwrite existing project.json
/kbd-init --dry-run                # Preview without writing
```

## After Init

Run `/kbd-status` to confirm KBD is correctly initialized, then start the
first phase — or run `/kbd-assess` directly if a phase is already defined in
`activePhase` (readers also accept the legacy `active_phase` alias).
