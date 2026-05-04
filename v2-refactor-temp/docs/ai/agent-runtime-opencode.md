# Agent runtime — OpenCode reference notes

Architectural notes from reading OpenCode's `memphis` source. Same five
subsystems as the Claude Code reference doc, observed in parallel so the
deltas are visible. **Observational only** — does not prescribe a Cherry
implementation. Pair this with `agent-runtime-claude-code.md`.

OpenCode is a Bun monorepo. The agent runtime lives mostly in
`packages/opencode/src/`. Worth noting up front: OpenCode reads
`AGENTS.md` natively, not as a migration source — the entire vocabulary
around project instructions is built around that filename.

## Workspace root

OpenCode keeps **two roots**, propagated together:

| Root | Source | Purpose |
|---|---|---|
| `directory` | the cwd | working directory for tools |
| `worktree` | `git rev-parse --path-format=absolute --git-common-dir`'s parent | git project boundary; where AGENTS.md walking stops |

Plus a persisted `Project` row keyed by worktree.

Both travel together as `InstanceContext = { directory, worktree, project }`
in `packages/opencode/src/project/instance-context.ts`. Propagation is
via Effect's `LocalContext` (an AsyncLocalStorage equivalent) — every
async boundary preserves the same context. `Instance.provide({
directory, fn })` enters a new ALS scope; `Instance.bind(fn)` captures
and restores the ALS for callbacks crossing async boundaries (think
WebSocket handlers, promise chains).

Gotcha: non-git projects set `worktree = "/"`. `containsPath` then
short-circuits to avoid matching every absolute path (which would
otherwise defeat external-directory permission checks).

vs Claude Code: CC has *three* roots (`cwd` / `originalCwd` /
`projectRoot`) where `projectRoot` is frozen even when worktrees swap
mid-session; OpenCode collapses to two, with the same swap handled by
swapping the entire `InstanceContext`.

## AGENTS.md (project instructions)

`packages/opencode/src/session/instruction.ts:13-17, 106-147, 173-215`.

Search list, in order:

```
AGENTS.md   (preferred)
CLAUDE.md   (compat — gated by OPENCODE_DISABLE_CLAUDE_CODE_PROMPT)
CONTEXT.md  (legacy)
```

Discovery is `findUp(file, ctx.directory, ctx.worktree)` for each name.
**The first matching filename wins its full ancestor chain** — OpenCode
won't mix names. If `AGENTS.md` is found anywhere up the tree, it loads
*every* `AGENTS.md` from that directory up to `worktree`; CLAUDE.md is
not consulted in that case.

Plus globals:

- `~/.config/opencode/AGENTS.md`
- `~/.claude/CLAUDE.md`

The interesting design: subdir-scoped AGENTS.md is **not loaded into the
system prompt up front**. Instead, every time the read tool opens a
file, `resolve(messages, filepath, messageID)` walks up from that file,
attaches each newly-encountered `AGENTS.md` once per message, and
dedupes via:

- a `claims: Map<MessageID, Set<path>>`
- inspection of past `read` tool-call `metadata.loaded` paths

The attached AGENTS.md content rides **inside the read tool's output**,
wrapped in `<system-reminder>` — the model sees per-area conventions
exactly when it's actually reading code in that area.

vs Claude Code: CC injects all relevant CLAUDE.md content up front in
the `memory` system-prompt section (root → cwd, deeper-wins). OpenCode
splits: top-level AGENTS.md goes in the system prompt; nested AGENTS.md
streams in via Read tool output as the model encounters those subtrees.

## System prompt construction

`packages/opencode/src/session/system.ts`, assembly call site at
`session/prompt.ts:1444-1452`.

Per-step assembly (rebuilt every turn — no static prefix cached at
session start):

```ts
Effect.all([sys.skills(agent), sys.environment(model), instruction.system()])
system = [...env, ...instructions, ...(skills ? [skills] : [])]
```

Then prepended by `system.provider(model)`, which selects a **model-
family-specific brand prefix**. Seven variants:

```
PROMPT_ANTHROPIC   PROMPT_GPT
PROMPT_BEAST       (o-series)
PROMPT_GEMINI      PROMPT_KIMI
PROMPT_CODEX       PROMPT_TRINITY
PROMPT_DEFAULT
```

The `environment` block contains: working directory, workspace root,
VCS state, platform, current date.

Gotcha: skills section is **omitted entirely** if the agent's permission
config denies `skill`. The block is pure prompt fragment — there's no
runtime check at tool-call time, so removing it from the prompt is also
how OpenCode hides the capability from the model.

vs Claude Code: CC has a single static identity prefix split by a cache
boundary marker (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`); OpenCode picks the
brand prefix per model family and rebuilds the whole prompt each step,
foregoing prefix caching to get model-specific framing.

## Skills

`packages/opencode/src/skill/index.ts:146-204` (loader),
`packages/opencode/src/tool/skill.ts` (tool).

Same fundamental shape as Claude Code: directory + `SKILL.md` with YAML
frontmatter (`name`, `description`).

Discovery sources, in order:

1. `~/.claude/skills/**/SKILL.md` — explicit Claude Code compat (gated
   by `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`)
2. `~/.agents/skills/**/SKILL.md`
3. Walked-up project `.claude/.agents` dirs between `directory` and
   `worktree`
4. opencode config dirs (`{skill,skills}/**/SKILL.md`)
5. User-configured `skills.paths`
6. HTTP-pulled `skills.urls` (cached under `Global.Path.cache/skills`)

Exposure is a **single `skill` meta-tool** taking `{ name }`. The prompt
advertises an `<available_skills>` block listing each skill's name +
description. When the model invokes, the loader runs ripgrep on the
skill dir and returns content + a sampled file list to the model — i.e.
the model gets both the SKILL.md body *and* a manifest of nearby files
in the skill's directory.

Gotcha: explicit cross-vendor compatibility — `~/.claude/skills` is
auto-included. A user with both Claude Code and OpenCode installed
shares their skill library by default.

vs Claude Code: same SKILL.md shape, same single-meta-tool pattern. Two
deltas: (a) OpenCode also pulls remote skills via HTTP with cache, and
(b) the skill load output includes a pre-sampled file list, not just
SKILL.md body.

## Read tool

`packages/opencode/src/tool/read.ts`. Single `filePath` + `offset` /
`limit` (lines, 1-indexed, default 2000 lines).

Dispatch:

| Type | Behavior |
|---|---|
| Directory | sorted, paginated listing |
| Image (jpeg/png/gif/webp) | base64 data-url attachment |
| PDF | data-url attachment |
| Binary | extension blocklist + 30%-non-printable heuristic on a 4 KB sample → reject |
| Text | line-numbered `${i}: ${line}` |

Caps:

- 2000 chars per line
- 50 KB total per response, with explicit "use offset=N to continue"
  footer

Niceties: did-you-mean fuzzy match on missing files. LSP `touchFile`
warm-up forked in parallel.

mtime-based dedup is **not** done here. Instead Read participates in
AGENTS.md propagation: passively claims nearby `AGENTS.md` files via
`Instruction.resolve` keyed by messageID.

Gotcha: office formats (`.docx` / `.xlsx` / `.pptx`) are explicitly in
the binary blocklist — they fail rather than render.

vs Claude Code: no notebook/office handling, no mtime re-read dedup.
But Read carries AGENTS.md propagation, which CC's Read does not.

## Cherry-relevant deltas

Three things stand out vs Claude Code:

1. **Dual root with ALS propagation.** `directory` (cwd) +
   `worktree` (git boundary) carried through Effect's
   AsyncLocalStorage. Subagents can swap cwd while sharing a project;
   the `worktree="/"` carve-out for non-git is a fix worth copying.

2. **Subdir AGENTS.md via Read, not system prompt.** Top-level
   AGENTS.md goes in the system prompt; nested AGENTS.md streams in
   via Read output as the model touches that area. Once-per-message
   dedup keyed by messageID. Good answer to "how do I expose subdir
   conventions without bloating the prompt?"

3. **Per-model-family brand prefix.** OpenCode picks one of seven
   prompts based on the model. CC has a single identity. Trade-off:
   prefix caching ↔ model-tailored framing — Cherry can pick either.

A fourth: skills as a single meta-tool with `~/.claude/skills`
auto-inclusion is a quiet UX win — users don't have to re-author skills
between agents.
