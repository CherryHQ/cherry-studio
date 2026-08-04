# Managed CLIs

Covers `mcp__cherry-tools__cli_list`, `mcp__cherry-tools__cli_search`, and
`mcp__cherry-tools__cli_install`. Cherry keeps CLIs in an **isolated managed
environment**, separate from the system PATH.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and safety only.

## Conditional availability

The `cli_*` tools are **absent for agents with no shell** (e.g. the built-in Assistant).
If they're absent, you cannot install CLIs in this session — say so; don't work around
it.

## Approval

`mcp__cherry-tools__cli_install` mutates durable state and is **approval-gated**. Call it
only once intent is clear; if approval is declined, stop and report — don't retry through
the shell.

## Workflow

Before installing anything:

1. **Probe the real PATH.** `mcp__cherry-tools__cli_list` reports only Cherry-managed
   binaries and does **not** see the system PATH — so a tool it calls "unavailable" may
   already exist on the machine. Run `command -v <name>` (shell inspection is fine) to
   check the real PATH before installing a duplicate. Use `mcp__cherry-tools__cli_list`
   to see what Cherry already manages.
2. **`mcp__cherry-tools__cli_search`** — look up the exact `name`/`tool` recipe from the
   registry. Never guess the executable name or recipe.
3. **`mcp__cherry-tools__cli_install`** — install using the recipe from search (or one
   translated from trusted docs). Approval runs here.

## Don't reach around the managed environment

**Do not** substitute `npm install -g`, `pipx install`, `cargo install`, `brew install`,
or a manual download — those bypass Cherry's managed environment.
`mcp__cherry-tools__cli_install` accepts the same backends, so there's no capability you
gain by shelling out — you only lose Cherry's bookkeeping.

## Recovery

- **Invalid recipe / wrong name** → the tool returns an error; correct the recipe (re-run
  `cli_search`) rather than retrying blindly.
- **Approval declined** → stop and report; don't install via the shell.

## Example

> "I need `ripgrep` available for searches."

`command -v rg` to check the real PATH → if absent, `mcp__cherry-tools__cli_list` to see
if Cherry already manages it → `mcp__cherry-tools__cli_search` "ripgrep" for the exact
recipe → `mcp__cherry-tools__cli_install` with that recipe (approval runs). Never
`brew install` / `cargo install` it yourself.
