# Agent runtime — goose reference notes

Architectural notes from reading goose's `lyon` source (Rust, AAIF /
Linux Foundation, formerly block/goose). Same five subsystems as the
Claude Code and OpenCode reference docs. **Observational only** — does
not prescribe a Cherry implementation. Pair with
`agent-runtime-claude-code.md` and `agent-runtime-opencode.md`.

goose is structurally different from CC and OC: a Rust monorepo with
crates split as `goose` (runtime), `goose-cli`, `goose-server`,
`goose-mcp` (MCP-side tools), `goose-sdk`. Three top-level abstractions
worth naming up front: **Extensions** (MCP servers, in-process or
external), **Recipes** (whole-session blueprints), and **Skills**
(prompt-fragments-on-demand). They are not synonyms.

## Workspace root

`crates/goose/src/session/session_manager.rs:59` — `Session.working_dir`
is a `PathBuf` field on the `Session` row, **persisted to SQLite**.
Set via `SessionUpdateBuilder.working_dir(...)` (`:171`), updated mid-
session via `update_working_dir` (`thread_manager.rs:220`).

Every tool call receives the current cwd through `ToolCallContext` —
`platform_extensions/developer/mod.rs:179` shows `*_with_cwd` variants
of every operation that resolves relative paths against
`ctx.working_dir`. Multiple concurrent sessions = multiple independent
cwds, isolated by Session row.

Gotcha: subagents inherit cwd by sharing the parent's Session, not by
explicit propagation. There's no per-tool-call cwd override and no
worktree concept distinct from cwd.

vs CC/OC: Claude Code has three roots in process-global state with an
ALS override; OpenCode has two carried via Effect's ALS. goose has
**one cwd, persisted in the conversation database**. The trade-off is
explicit: less concurrency flexibility, but `Where am I working?` is
recoverable across crashes / restarts because it's literally a row.

## Hints (`.goosehints`, `AGENTS.md`, `CLAUDE.md`)

`crates/goose/src/hints/load_hints.rs:13` — `get_context_filenames()`
defaults to `[".goosehints", "AGENTS.md"]`, configurable via
`CONTEXT_FILE_NAMES` env. Tests confirm `CLAUDE.md` works as a custom
value.

`load_hint_files` (`:225`) walks **from git root *down* to cwd** (or
just cwd if no `.git`) and concatenates every matching file at every
level — root last in source order, but actual injection treats deeper
files as more specific. Plus `~/.config/goose/.goosehints` joined as
"Global Hints".

Supports `@path` imports in `import_files.rs`, bounded to git root, and
filtered through a hierarchical `Gitignore` built from every
`.gitignore` between git root and cwd.

The interesting design: `SubdirectoryHintTracker` (`:27`) **observes
every tool call's `path` / `command` argument** at runtime, queues
parent directories of those paths, and lazily appends a fresh
`### Subdirectory Hints (...)` block to the system prompt when the
agent first touches a new subdir. Hints arrive only when relevant —
neither all-up-front (CC) nor read-tool-piggyback (OC), but a third
mode: prompt mutation as a side-effect of tool argument inspection.

vs CC/OC: all three load some form of hierarchical instructions. CC
loads at session start. OC streams subdir AGENTS.md via Read tool
output. goose **observes tool argument paths** and grows the system
prompt mid-conversation. Each is a different answer to "when do nested
conventions arrive?"

## System prompt construction

`crates/goose/src/agents/prompt_manager.rs:115` — `SystemPromptBuilder::build()`
renders `prompts/system.md` (Tera/MiniJinja template) with a
`SystemPromptContext` of:

```
extensions, current_date_time, extension_tool_limits,
goose_mode, is_autonomous, enable_subagents,
max_extensions, max_tools, code_execution_mode
```

Static brand prefix at `prompts/system.md:1`:
`You are a general-purpose AI agent called goose, created by AAIF...`

Layout:

1. Brand prefix (one identity, no per-model variants)
2. Extension sections, sorted **alphabetically** (`:127`)
3. Mode-specific text (autonomous, chat-mode notice)
4. "Additional Instructions" tail — an `IndexMap<String, String>` for
   extras (hints, chat-mode, lazy subdir hints)

Two cache-shaping decisions worth calling out:

- `current_date_timestamp` is **rounded to the hour** (`:206`).
- Extension blocks are sorted by name (`:127`).

Both explicit choices to maximize prompt-cache hits across turns / sessions.
Every extra is run through `sanitize_unicode_tags` (E0000-block tag
chars) to defeat hidden-instruction attacks.

Rebuilt every turn — no caching at session level. Recipes override the
whole prompt via `set_system_prompt_override`.

vs CC/OC: CC has cache-friendly static prefix + boundary marker. OC
rebuilds per-turn and picks per-model prefix. goose rebuilds per-turn
but **engineers determinism into the rebuild** (hour-rounding, sorting)
so cache still hits at the provider layer. Different mechanism, similar
intent.

## Extensions / Recipes / Skills

Three coexisting concepts, intentionally separated:

### Extensions = MCP servers

`crates/goose/src/agents/extension.rs` + `platform_extensions/`. Two
flavors:

- **In-process built-ins**: `developer`, `analyze`, `summon`,
  `orchestrator`, `chatrecall`. Each contributes tools + an
  `instructions` block injected into the system prompt's `# Extensions`
  section.
- **External**: stdio / SSE / streamable-http MCP servers.

The "skills" extension itself is a platform extension. This is
load-bearing: skills are exposed *through* extensions.

### Skills = Claude Code-compatible markdown-with-frontmatter

`skills/client.rs:42`, `skills/builtin.rs:3`.

Discovery sources (in order):

1. `<cwd>/.agents/skills/`
2. `<cwd>/.goose/skills/`
3. `<cwd>/.claude/skills/`
4. `~/.agents/skills/`
5. `~/.config/goose/skills/`
6. `~/.claude/skills/` — explicit Claude Code compat
7. `~/.config/agents/skills/`
8. Built-ins, embedded via Rust's `include_dir!` (compile-time)

The skills extension injects a one-line catalog
(`• name - description`) into its instructions block. The model
invokes a `load_skill` tool to pull the full `SKILL.md` body (plus
`name/path.md` for supporting files) on demand. This is the **closest
analog to CC's SkillTool**.

Gotcha: skill names must match `[a-z0-9-]{1..64}`; `load_skill`'s
relative-path mode canonicalizes and rejects paths escaping the skill
directory.

### Recipes = whole-session blueprints

`recipe/mod.rs:42`. YAML/JSON files defining:

```
title, description, instructions, prompt,
extensions, parameters, sub_recipes,
response.json_schema, retry, settings
```

Loaded from: `.`, `$GOOSE_RECIPE_PATH`, `~/.config/goose/recipes`,
`./.goose/recipes`, `.agents/recipes`.

Recipes can declare extensions (auto-injecting `summon` for sub_recipes,
`analyze` when `developer` is present) and **override the system prompt
entirely**.

A Recipe shapes a session — provider, extensions, parameters, sub-recipes,
even retry/response schema. A Skill shapes a single response. An Extension
shapes the tool catalog.

vs CC/OC: CC has only Skills. OC has Agents (subagent recipes) and
Skills. goose has all three as separate concepts. The deliberate split
mirrors three different lifecycles: **session** (Recipes), **turn**
(Skills), and **process** (Extensions / MCP).

## Read tool

goose **has no dedicated cross-format read tool**. The `developer`
extension exposes `write` / `edit` / `shell` / `tree`
(`platform_extensions/developer/mod.rs:233`); reading is delegated to
`shell` (`cat`, `sed`, `rg`).

Rich-format readers live as separate MCP tools in **`goose-mcp`'s
`computercontroller`**: `pdf_tool.rs`, `docx_tool.rs`, `xlsx_tool.rs`.
Model picks them by file type, no central dispatch.

`apply_line_limit(content, line, limit)` (`edit.rs:199`) provides
1-based pagination when used. Shell stdout/stderr is capped at 2000
lines per stream; overflow spills to a temp file (`mod.rs:127`).

A `FileReadParams` struct exists in `edit.rs:11` but is not registered
as a tool — vestigial.

Gotcha: no mtime dedup, no image/binary blocking, no notebook handler,
no device-file guards. Policy is pushed entirely to the shell layer
and per-format MCPs.

vs CC/OC: CC's Read is a single multimodal dispatcher with line
numbers + mtime gating + device blocklist. OC has a single Read with
binary heuristic + AGENTS.md piggyback. goose **inverts the pattern**:
shell is the universal reader, file-format MCPs handle binaries
individually, no central read abstraction.

## Cherry-relevant deltas

Three things stand out vs CC and OC:

1. **Lazy contextual hints via tool-arg inspection.** goose's
   `SubdirectoryHintTracker` watches every tool call's path / command
   argument and injects nested AGENTS.md only when the agent walks
   into that subdir. A third option between CC's load-everything-upfront
   and OC's stream-via-Read.

2. **Three-axis composition** of Recipes (whole session) / Skills
   (single turn) / Extensions (process / MCP servers). The same
   problem CC collapses into "Skills" gets factored across three
   lifetimes. Useful framing: where in time does this thing live?

3. **Cache-shaped prompts.** Hour-rounded timestamps + alphabetized
   extension blocks are an explicit, cheap design choice for cross-turn
   prompt caching that neither CC nor OC document. Anyone rebuilding
   per-turn should at least consider these knobs.

A fourth: persisting `working_dir` to the session DB row makes
`where am I` recoverable across crashes — small detail, easy to copy.
