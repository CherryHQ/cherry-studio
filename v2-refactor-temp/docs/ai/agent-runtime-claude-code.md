# Agent runtime — Claude Code reference notes

Architectural notes from reading `manila-v1` (the Claude Code source). The
goal is to know what Cherry would copy, what Cherry would skip, and what
the non-obvious load-bearing pieces are. **Observational only** — this
document does not prescribe a Cherry implementation.

Five subsystems matter for the runtime we're sketching: workspace root,
project-level instructions (CLAUDE.md), system prompt construction,
skills, and the read tool. They compose top-down — workspace root is the
foundation everything else anchors on.

## Built-in system prompt

Yes — Claude Code has a substantial **static prefix** baked in. From
`src/constants/prompts.ts:444-577` (`getSystemPrompt`), the cacheable
prefix stacks (in order):

1. `getSimpleIntroSection` — "You are Claude Code, …"
2. `getSimpleSystemSection` — system framing (output discipline, tool
   permissions, prompt-injection awareness, hooks, context compaction)
3. Doing-tasks — engineering principles
4. Executing actions — reversibility / blast radius
5. Using-your-tools — generic tool-use guidance (parallel, defer to
   dedicated, TaskCreate)
6. Tone and style
7. Output efficiency

These are real prose strings checked into source — multi-KB total — not
template placeholders. Then a load-bearing marker
`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` separates the static prefix from the
dynamic suffix; **anything that varies per turn must go after the
marker** or the prefix cache busts for the whole conversation.

The dynamic suffix is a **section registry**: `session_guidance`,
`memory` (CLAUDE.md), `ant_model_override`, `env_info_simple` (cwd, git,
platform, OS, model name/cutoff), `language`, `output_style`,
`mcp_instructions`, `scratchpad`, `frc`, `summarize_tool_results`,
optional `numeric_length_anchors` / `token_budget` / `brief`. Each
section is wrapped by `systemPromptSection(name, fn)` with cache control;
some are explicitly `DANGEROUS_uncachedSystemPromptSection` (e.g. MCP
instructions when delta isn't enabled).

Override resolution is a second layer — `buildEffectiveSystemPrompt` in
`src/utils/systemPrompt.ts:41-123` picks **override → coordinator →
agent → custom → default** and may append `appendSystemPrompt`.

## Workspace root

Process-global state in `src/bootstrap/state.ts:500-533` carries **three
distinct roots**:

| Root | Mutability | Purpose |
|---|---|---|
| `cwd` | mutable, follows `cd` | working directory for tools |
| `originalCwd` | session start, mutated only by `EnterWorktreeTool` | session anchor |
| `projectRoot` | frozen at startup, never updated | project identity (history / skills binding) |

`pwd()` (`src/utils/cwd.ts:1-32`) first checks an
`AsyncLocalStorage<string>` (`cwdOverrideStorage`) and falls back to
`STATE.cwd`. Concurrent agents/subagents (`AgentTool` spawning into a
worktree) get their own cwd via `runWithCwdOverride(path, fn)` without
mutating the global.

Gotcha: `EnterWorktreeTool` updates `originalCwd` mid-session but is
**forbidden from touching `projectRoot`** (`state.ts:506-513`), so
skills and per-project history stay anchored even when the user hops
worktrees. The conceptual separation matters — Cherry will need it the
moment we want stable per-project config that survives a worktree
checkout.

## CLAUDE.md (project instructions)

Claude Code does **not** auto-load `AGENTS.md`. The only mention is
`commands/init.ts:46,108` listing it as a *source to migrate from* when
generating CLAUDE.md.

Discovery (`src/utils/claudemd.ts:849-934`) walks from `originalCwd`
upward to FS root, then iterates **root → cwd** at injection — deeper
files come last, so cwd content takes priority. At each directory it
checks four file shapes:

- `CLAUDE.md` (project, gitignored or not)
- `.claude/CLAUDE.md`
- `.claude/rules/*.md` (Project)
- `CLAUDE.local.md` (Local, gitignored)

Plus three out-of-tree sources:

- Managed: `/etc/claude-code/CLAUDE.md`
- User: `~/.claude/CLAUDE.md`
- `--add-dir` directories

Files support `@path` includes (relative / absolute / `~`); included
files are inserted *before* the parent (`claudemd.ts:18-25`). Content
gets injected as a system-prompt section via `loadMemoryPrompt()` in the
`'memory'` dynamic section (`prompts.ts:495`), prefixed with the
boilerplate "Codebase and user instructions are shown below…"
(`claudemd.ts:89`).

Gotcha: nested-worktree detection (`claudemd.ts:868-884`) skips Project-
type files in the parent repo's working tree to avoid double-loading
the same checked-in CLAUDE.md.

## Skills

Skills are **prompt fragments lazy-loaded by a single tool**. Not
individual tools — a single `SkillTool` is registered, and the *list*
of available skills (name + truncated description, ~1% context budget)
is injected per-turn as a `system-reminder` attachment
(`src/utils/attachments.ts:2742`, listing prompt at
`src/tools/SkillTool/prompt.ts:173-195`).

A skill = a directory containing `SKILL.md` with YAML frontmatter:

| Field | Use |
|---|---|
| `name` | identifier the model calls the tool with |
| `description` | one-line surfacing in the per-turn list |
| `when_to_use` | extended description shown only when invoked |
| `allowed-tools` | gate on which tools the skill body can call |
| `model` / `effort` | model overrides for the skill's body |
| `paths` | extra glob roots the skill needs |
| `hooks` | SKILL_PRE / SKILL_POST shell hooks |
| `disable-model-invocation` | hide from model, user-invocable only |
| `user-invocable` | exposed via `/skill-name` slash command |
| `argument-hint` | shape of the args string |

Discovery (`src/skills/loadSkillsDir.ts:638-710`) merges five sources:
`policySettings` (`/etc/claude-code/.claude/skills`), `userSettings`
(`~/.claude/skills`), `projectSettings` (walked up from cwd —
`.claude/skills/*/SKILL.md`), `--add-dir` paths, and bundled skills
registered via `registerBundledSkill` (`skills/bundledSkills.ts:53`).
All become `Command` objects of `type: 'prompt'`.

Invocation: model calls `SkillTool({ skill: "name", args: "..." })`;
only the SKILL.md body is then expanded into the conversation. Bundled
skills with `files: Record<path, content>` get extracted to a temp dir
on first invoke and the prompt is prefixed with `Base directory: <dir>`
so the model can `Read` / `Grep` reference files
(`bundledSkills.ts:59-72`) — full content is *not* preloaded.

The big design win: a huge skills directory does not bloat the tool
catalog or shred the prompt cache. Only the metadata sentence per skill
is in the per-turn context until the model decides to invoke one.

## Read tool

Single tool, dispatches by extension
(`src/tools/FileReadTool/FileReadTool.ts:496-863`):

| Type | Behavior |
|---|---|
| Text | line-numbered `cat -n` output via `addLineNumbers` |
| Image (jpeg/png/gif/webp) | base64 with token-budget compression + resize |
| PDF | `pages: "1-5"` arg; rendered as image blocks via `extractPDFPages`, capped by `PDF_MAX_PAGES_PER_READ` |
| Notebook (.ipynb) | parsed cells via `readNotebook` |

Pagination: **line-based for text** (`offset` 1-indexed line + `limit`
line count), **page-based for PDF**. No tail-follow.

Two caps (`src/tools/FileReadTool/limits.ts:1-92`):

- `maxSizeBytes` = 256 KB on **total file size pre-read** (throws before
  any I/O cost)
- `maxTokens` = 25 000 on **actual output** (throws post-read using the
  API's token count)

Binary extensions (excluding PDF/SVG/images) are rejected at permission-
check time (`FileReadTool.ts:471-482`). A blocklist of device files
(`/dev/zero`, `/dev/random`, `/dev/stdin`, `/proc/self/fd/0`, …) prevents
hangs (`FileReadTool.ts:96-115`).

Non-obvious: re-reading the same file+range without an mtime change
returns a `FILE_UNCHANGED_STUB` instead of resending content
(`FileReadTool.ts:534-553`). Driven by a `readFileState` map keyed by
full path. Dedup is **disabled for entries written by Edit/Write**
(offset undefined) so post-edit reads aren't shadowed by pre-edit
content.

## What Cherry inherits if it copies the shape

- A workspace-root concept on the assistant/session that distinguishes
  cwd / session-anchor / project-anchor.
- A system prompt builder split by a cache boundary; static prose
  before, registry-driven dynamic sections after.
- A first-class CLAUDE.md (or AGENTS.md — Cherry can choose) reader
  that walks root→cwd, supports `@path` includes, and injects via the
  prompt registry.
- A single SkillTool with metadata-only injection until invoked.
- A Read tool that dispatches by extension, has dual size caps, and
  dedups on mtime.

## Open questions for Cherry's port

1. Built-in identity prose vs all-user-supplied. Claude Code bakes a
   curated multi-KB framing in source; Cherry currently relies entirely
   on per-assistant `prompt`. Hybrid possible.
2. Per-section caching. AI SDK's
   `providerOptions.cacheControl` covers this per provider, but not all
   Cherry-supported providers honour cache-control. Boundary marker
   pattern is provider-agnostic; the *cache* part is provider-specific.
3. AGENTS.md vs CLAUDE.md naming. Cherry isn't Claude — using
   `CLAUDE.md` is misleading; `AGENTS.md` (which Claude Code only treats
   as legacy) is more honest. Either way, document the *single* name
   chosen.
4. Skills source priority. Five-source merge is principled but heavy.
   Cherry could ship with project + user only and add policy/system
   sources later.
