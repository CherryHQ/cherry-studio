# Agent runtime — Cherry implementation plan

Pairs with `agent-runtime-claude-code.md`, `agent-runtime-opencode.md`,
`agent-runtime-goose.md`. Those are observations of three reference
agents; this document is **Cherry's own design**, picking and choosing
from each based on user-confirmed decisions.

## Decisions confirmed

1. **Workspace root** — column on `topic` only. Topic and Assistant
   are decoupled in current Cherry architecture (no per-Assistant
   default needed). Existing `agent.accessiblePaths` (the Claude-agent
   path) stays as-is.
2. **Subdirectory hints** — goose-style: tool-arg observation, lazy
   injection via `<system-reminder>` in tool result envelope.
3. **System prompt** — static brand prefix + cache boundary marker +
   dynamic section registry. Output style is a configurable section.
4. **Skills** — existing `agent_global_skill` + `agent_skill` tables
   become the canonical store. Loader reads:
   - DB rows directly (custom-agent path; no longer needs symlinks)
   - `.claude/skills/` filesystem (compat for Claude-agent setups)
   - Optional global: `~/.claude/skills/`, `~/.codex/skills/`,
     `~/.agent/skills/`
5. **AGENTS.md** primary, **CLAUDE.md** fallback.
6. **Read tool** — single `fs__read`, dispatch by extension
   (text / image / PDF / docx / xlsx).
7. **@-include in input bar** — migrate `useResourcePanel`'s ripgrep
   dep (came in via Claude Agent SDK) to `@ff-labs/fff-node` (already
   in use by `fs__find` / `fs__grep`).

## Implementation order

Each phase is independently shippable. The order is by dependency
+ user-visible value, not by complexity.

```
Phase A. workspace root on topic       ← unblocks B, C, E, F
   ↓
Phase B. system prompt section registry ← unblocks D, E, output style
   ↓
Phase C. AGENTS.md top-level injection (consumes B)
Phase D. read-tool defensive hardening (independent — mtime, caps, blocklist)
Phase E. subdir hint tracker (consumes B + C)
Phase F. skills loader + SkillTool      (consumes B + workspace root)
Phase G. read-tool format dispatch (image / PDF / docx / xlsx)
Phase H. @-include via fff (renderer-only, independent)
```

## Phase A — Workspace root

### Schema

`src/main/data/db/schemas/topic.ts`:

```ts
workspaceRoot: text(),  // absolute path; null = no workspace bound
```

No change to `assistant.ts`. Topic + Assistant are decoupled — a topic
either has a workspaceRoot or it doesn't, and that's the whole story.

### Read path

A new helper `getTopicWorkspaceRoot(topicId): Promise<string | undefined>` —
returns `topic.workspaceRoot`. Tools and prompt builder consume this.

### Subagent inheritance

Subagents share parent topic's `workspaceRoot`. v1 doesn't support
per-call override. (If we add worktrees later, copy OpenCode's
`InstanceContext` ALS pattern.)

### Validation

- Reject relative paths at the API boundary.
- Soft-reject paths that don't exist (warn, allow — user might be
  about to `mkdir`).

## Phase B — System prompt section registry

### Shape

```ts
type SystemSection = {
  id: string                    // 'identity', 'memory', 'env', ...
  text: string
  cacheable: boolean             // true = before the boundary
}

function buildSystemPrompt(ctx: BuildCtx): SystemSection[]
```

The renderer at the AI SDK boundary concatenates with a marker between
cacheable / non-cacheable groups. For Anthropic provider, emit
`providerOptions.cacheControl` on the last cacheable section. For
non-Anthropic, plain string concat — no-op cost.

### Default section order

Cacheable (above the marker):

1. `identity` — built-in brand prose (configurable, see below)
2. `assistant_prompt` — `assistant.prompt` body
3. `tool_intros` — generic tool-use guidance

Boundary marker (logical, not literal — implemented by `cacheable: false`).

Non-cacheable:

4. `output_style` — preference-driven (see below)
5. `memory` — top-level AGENTS.md content (Phase C)
6. `env` — workspace_root, cwd, date (hour-rounded, goose-style),
   platform, model, OS
7. `mcp_instructions` — sum of installed MCP servers' instruction
   blobs
8. `skills_catalog` — Phase F
9. `subdir_hints` — appended by Phase E (lazy)
10. `custom_append` — assistant-supplied trailing text

Sections sorted alphabetically within each group where order doesn't
matter (cache-stability, goose-inspired). Hour-rounded timestamp in
`env`.

### Output style

`preference: 'feature.system_prompt.output_style'` (string enum,
default `'default'`). Values: `'default'`, `'concise'`, `'detailed'`,
`'review'`, `'plan'`. Each maps to a frozen prose block that goes into
the `output_style` section.

User-defined output styles (file-system based, like CC) can land in a
later phase.

### Built-in identity prose

Always emitted. No feature flag. The `identity` section is hard-wired
to Cherry's curated framing prose — output discipline, tool permissions
awareness, prompt-injection caution, context compaction. Roughly the
shape of `getSimpleSystemSection` in CC (`prompts.ts:186-197`) adapted
for Cherry's threat model. `assistant.prompt` body comes after, on top
of that foundation.

The actual prose draft lives in
`src/main/ai/agent/prompts/identity.ts` (created in Phase B), checked
into source. Multi-KB. Not hot-pluggable.

### Migration

Existing `assembleSystemPrompt` becomes `buildSystemPrompt` returning
sections. Render-time concat happens at AI SDK call boundary. Existing
callers see no behavior change; the registry is internal.

## Phase C — AGENTS.md top-level injection

### Discovery

```
function loadProjectInstructions(workspaceRoot: string): {
  filename: 'AGENTS.md' | 'CLAUDE.md'
  content: string
  origin: string  // absolute file path
} | null
```

Search order:

1. `<workspaceRoot>/AGENTS.md`
2. `<workspaceRoot>/CLAUDE.md` (fallback only — ignored if AGENTS.md
   present)

Plus globals (concatenated with origin labels):

- `~/.cherry/AGENTS.md`
- `~/.config/cherry/AGENTS.md`

`@path` includes supported (CC-style: relative / absolute / `~`).
Implementation reuses any of CC / OC / goose's algorithm — the gnarly
parts are gitignore filtering and circular-include detection.

### Injection point

The `memory` section in the registry (Phase B). Re-read every turn
(filesystem is source of truth). Cached at provider's HTTP layer if
content unchanged — content-hash inside the section to make this
deterministic.

## Phase D — Read tool defensive hardening

Independent; can ship before A-C.

Add to current `fs__read`:

1. **mtime dedup** — module-level `Map<string, { mtimeMs, hash }>`
   keyed by absolute path. On call, stat first; if mtime ≤ last-seen
   AND requested range overlaps last-seen range, return a stub:

   ```
   [file unchanged since last read at <ts>; current content matches
   what you already have. Re-read with offset/limit if you need a
   different range, or call again after editing.]
   ```

   Invalidate on `fs__patch` write to the same path.

2. **Size cap** — 256 KB pre-read on file size, throws before any I/O
   beyond `stat`. Token cap (25 K) post-read on the formatted output.

3. **Device file blocklist** — reject paths matching `/dev/...`,
   `/proc/self/fd/...`, named pipes, etc. before opening.

These three changes are pure additions, no behavior change for existing
green path. Tests: small unit tests per check.

## Phase E — Subdirectory hint tracker

The interesting goose pattern. Hook every tool call's `input` for path-shaped
fields, walk-up to find unseen `AGENTS.md`, queue them.

### Detection

Tools register a `pathFieldExtractor: (input) => string[]` (optional).
Defaults: `fs__read`/`fs__patch`/`fs__find`/`fs__grep` extract from
their known fields. `shell__exec` parses the bash AST (already have
the parser from 5.5.2!) to find file-shaped arguments.

### State

Per-topic `Map<topicId, Set<absolutePath>>` of "AGENTS.md files already
shown". Persisted to shared cache so it survives renderer reloads
within a session; cleared on topic delete.

### Injection

After every tool call returns, the tool's result envelope (already
goes back through cherry's tool-result pipeline) gets a
`<system-reminder>` block appended for each newly-seen AGENTS.md:

```
<system-reminder>
The directory containing <path/of/tool-target> has its own AGENTS.md.
Apply these conventions to work in this area:

<contents>
</system-reminder>
```

Once-per-message dedup is OC's pattern; goose's is once-per-session.
We pick once-per-topic (matches our DB shape).

## Phase F — Skills

### Loader

`SkillCatalog.list(): Skill[]` from three sources, deduplicated by
`name` (last write wins, per the source-priority order):

```
1. agent_global_skill table (DB rows, isEnabled=true)
2. <workspaceRoot>/.claude/skills/*/SKILL.md  ← compat
3. <workspaceRoot>/.cherry/skills/*/SKILL.md
4. ~/.cherry/skills/*/SKILL.md                (always read)
5. ~/.claude/skills/*/SKILL.md                (opt-in)
6. ~/.codex/skills/*/SKILL.md                 (opt-in)
7. ~/.agent/skills/*/SKILL.md                 (opt-in)
```

Opt-in via three preferences:

- `feature.skills.include_claude_global` (boolean)
- `feature.skills.include_codex_global` (boolean)
- `feature.skills.include_agent_global` (boolean)

`Skill = { name, description, body, source, path }` — body is the
full SKILL.md text minus frontmatter.

### Catalog injection

In Phase B's `skills_catalog` section, list each enabled skill as one
line:

```
- name — description (truncated to N chars)
```

Sort by name for cache stability.

### SkillTool

A new builtin tool `skills__load`:

```ts
inputSchema: { name: string, args?: string }
execute: ({ name }) => skill.body  // returns full SKILL.md content
```

Permission: defaults to `'allow'` (loading a skill is read-only).
Future: per-skill allowlist of which tools the skill body's
recommended actions may call (frontmatter `allowed-tools`); ignored
for v1, parsed and stored.

### Schema usage

Existing `agent_global_skill` table is the single global skill store.
The existing `agent_skill` join determines per-principal enablement.
**Same table serves both Claude-agent and Assistant paths** — keep the
table name as-is. To support both principals without renaming, add a
nullable `assistantId` column alongside the existing `agentId`, with
an exactly-one-set check enforced at the service layer. Drop the
existing composite PK in favor of `(id, skillId)` where `id` is
either the agent or assistant uuid; or keep the composite PK by
nulling unused side and using a partial unique index per principal
type. Final shape decided in Phase F when we hit the migration.

## Phase G — Read tool format dispatch

Single `fs__read` adds:

| Extension | Handler |
|---|---|
| `.txt` `.md` `.ts` `.js` etc. | existing line-numbered |
| `.png` `.jpg` `.gif` `.webp` | base64 image part (with size cap, possibly resize) |
| `.pdf` | per-page extraction (`pages: '1-5'` arg), image parts |
| `.docx` | text via existing dependency or new `mammoth` |
| `.xlsx` | text via existing or new `xlsx` reader |
| `.ipynb` | parse cells, line-numbered output |

Dispatch by extension at top of `execute`. Each handler isolated in
`fs/readers/<format>.ts` for testability. Errors per-format don't
crash the tool — return `{ kind: 'error', code: 'binary-decode-failed' }`.

## Phase H — @-include via fff

Renderer-only. `useResourcePanel` currently uses ripgrep (came in via
Claude Agent SDK install). Migrate to a renderer-side bridge that
calls `fs__find` / `fs__grep` (already fff-backed). The model never
sees this — pure UX speedup.

Touched files:

- `src/renderer/src/pages/home/Inputbar/tools/components/useResourcePanel.tsx`
- Renderer needs IPC to call fff (probably already exposed via
  `fs__find`'s tool wiring; check before adding new IPC).

## Cross-phase concerns

### Where AGENTS.md / CLAUDE.md content is stored at runtime

Not stored — re-read every turn. Filesystem is canonical. Let the
provider's HTTP cache + cache-control breakpoints handle dedup. We
keep a content hash in the section so identical content emits
identical bytes (cache-friendly).

### How tools learn the workspace root

Two paths:

- Tool execution context (`ToolExecutionOptions.experimental_context`)
  carries `topicId`. Tools that need workspace root call
  `getTopicWorkspaceRoot(topicId)`.
- The system-prompt builder receives it as a build-ctx field.

### Permission system interaction

Skills loaded via `skills__load` may include shell commands or path
references. The unified permission pipeline (5.5.x) still applies —
the skill body is just text the model reads; any tool call the model
makes after reading the skill goes through the normal L1-L5 pipeline
unchanged.

### Cross-platform paths

All path normalization at storage / read boundary (`path.resolve`).
Display can use `~` shorthand. Subdir matching uses absolute paths.

## What's *not* in this plan

- **OpenCode-style nested-AGENTS.md piggyback on Read output**. We
  already chose goose-style observation.
- **Per-model brand prefix** (OC). Out of scope; one identity prose
  is enough.
- **Recipes** (goose). The whole-session-blueprint concept is real
  and useful, but separate from this five-subsystem plan. Park as
  Phase J.
- **HTTP-backed remote skills** (OC). Single-source-of-truth
  preference for now; remote sync is a settings-page feature when
  there's demand.
- **Subagent ALS context propagation** (OC). Cherry's subagents
  share parent context; revisit when worktree support lands.
