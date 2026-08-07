# Shell runtimes and managed CLIs

Covers the bundled shell runtimes plus `mcp__cherry-tools__cli_list`,
`mcp__cherry-tools__cli_search`, and `mcp__cherry-tools__cli_install`. The first group
executes local, project-scoped, or one-off work; the MCP tools install reusable CLIs in
Cherry's **isolated managed environment**.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and safety only.

## Choose by lifetime

Use the shortest-lived mechanism that fits:

| Need | Use |
| --- | --- |
| Run a JS/TS file | `bun <file>` |
| Install an existing JS project's dependencies / add a project dependency | `bun install` / `bun add <pkg>` in the project cwd |
| Run a one-off JavaScript package | `bun x <tool>` — only `bun` is bundled, not a `bunx` shim |
| Run a Python file | `uv run python <file>` |
| Run Python with a temporary dependency | `uv run --with <pkg> python <file>` |
| Run a one-off Python CLI | `uvx <tool>` |
| Search local files or contents | `rg` |
| Keep a CLI for later tasks, login, or durable configuration | the managed CLI workflow below |

Shell-capable general agents receive `bun`, `uv` / `uvx`, and `rg` on their execution
PATH. Prefer them over `node` / `npm` / `npx` / `pip`, which are not guaranteed to
exist. Do not assume a version or source: a Cherry-managed or system executable may
shadow the bundled fallback. If `command -v` cannot resolve one of these expected
commands, report an environment problem rather than pretending the command ran.

Keep dependency changes inside the current project. Global installs (`-g` /
`--global`, `uv tool install`, `pip install --user`) and direct `mise` mutations are
blocked because they leak state across agent sessions. Use `bun x` / `uvx` for one-off
tools and the managed workflow for anything persistent. Do not use `cli_install` for a
project library, and do not use an ephemeral runner for a CLI that needs login or reuse.

## Conditional availability

The built-in Assistant does not expose the `cli_*` tools. For every other role, the live
tool list is authoritative. If they're absent, you cannot install CLIs in this session —
say so; don't work around it. The bundled shell-runtime guidance above likewise applies
only when the session exposes a shell.

## Approval

`mcp__cherry-tools__cli_install` mutates durable state and is **approval-gated**. Call it
only once intent is clear; if approval is declined, stop and report — don't retry through
the shell.

## Workflow

Before installing anything:

1. **Probe the agent's effective PATH.** `mcp__cherry-tools__cli_list` reports only Cherry-managed
   binaries and does **not** see the system PATH — so a tool it calls "unavailable" may
   already resolve in the agent shell. Run `command -v <name>` (shell inspection is
   fine) to inspect the agent's effective PATH before installing a duplicate. This PATH
   includes Cherry-managed and bundled locations as well as the user's shell PATH; do
   not treat it as a pure system-only probe. Use `mcp__cherry-tools__cli_list` to see
   what Cherry already manages.
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

> "I need `jq` available for later data-processing tasks."

`command -v jq` to check the agent's effective PATH → if absent, `mcp__cherry-tools__cli_list` to see
if Cherry already manages it → `mcp__cherry-tools__cli_search` "jq" for the exact recipe →
`mcp__cherry-tools__cli_install` with that recipe (approval runs). Never `brew install` /
`apt install` it yourself.
