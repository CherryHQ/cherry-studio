---
name: cherry-tool-guide
description: Cherry Studio first-party tool and bundled-shell routing for general agents. For straightforward local work in shell-capable sessions, run JS/TS with `bun <file>` and one-off JS tools with `bun x`; run Python with `uv run [--with <pkg>] python` and one-off Python CLIs with `uvx`; search with `rg`. Load this guide before changing project dependencies, deciding whether a tool should be ephemeral or reusable, reading or converting local Office/PDF files, coordinating or delegating across Agent Sessions, or using Cherry-owned web/browser, knowledge, persistent memory, schedules/notifications, IM channels, image generation, artifact reporting, managed CLI, or skill capabilities—even if the user names no tool. Consult it before shell/file workarounds; live tool schemas are authoritative.
version: 1.3.0
---

# Cherry Tool Guide

Cherry Studio injects first-party tools into your session over three MCP servers
(`mcp__cherry-tools__*`, `mcp__agent-memory__*`, `mcp__skills__*`) and gives
shell-capable general agents bundled runtimes for local execution. The MCP tools act on
the running app — the user's knowledge bases, IM channels, schedules, managed CLIs, and
skill library — through boundaries only Cherry owns. Shell and file tools cannot reach
those app boundaries correctly; use the bundled runtimes only for the local execution
cases routed below.

**This file is a router.** It carries only the global rules and the intent → tool →
reference table. Each reference holds that domain's prerequisites, sequencing,
conditional availability, output interpretation, recovery, and examples. Read the one
reference the task needs (and any it cross-links to) before calling — don't work from
this page alone.

Tool names here are fully qualified (`mcp__server__tool`); the exact names exposed in
your session are authoritative if they ever differ. This guide never restates argument
shapes — **the live tool schema in your session is the authoritative source** for
parameter names, enums, and required fields. Read it before every call.

## Global rules

- **Check availability first.** Several tools are conditional (each reference says
  which). If a tool is not in your live tool list, its capability is unavailable *in
  this session* — say so honestly and stop; never pretend a call succeeded or fabricate
  a result.
- **Don't reach around Cherry's mutation boundaries.** Knowledge bases, IM channels,
  schedules, managed CLIs, and skills are mutated only through these tools. Do not shell
  out to `npm install`, `git clone`, `crontab`, or hand-edit knowledge files to
  accomplish these — the tool does bookkeeping (registration, scoping, approval, sync)
  that a raw shell command skips. Shell is fine for *inspection* (e.g. `command -v` to
  probe PATH) — just not to perform the owned mutation.
- **Honor approval.** `mcp__cherry-tools__kb_manage`, `mcp__cherry-tools__cli_install`,
  `mcp__cherry-tools__session_send`, and `mcp__skills__install_skill` are gated by the
  session's approval mode. Call them only once the user's intent is clear; if approval is
  declined, stop and report — do not retry the same effect through another route.
- **Intent still gates auto-approved effects.** Memory writes, schedule changes,
  notifications, and agent/channel configuration may execute without an approval card.
  Do not call them merely because they are available; first make sure the user requested
  the effect or it is necessary to complete an already-approved task.

## Routing table

| User intent | Route to | Reference |
| --- | --- | --- |
| Look up current/online facts, news, docs | `mcp__cherry-tools__web_search` → `mcp__cherry-tools__web_fetch` | [web.md](references/web.md) |
| Browser interaction (click, forms, screenshots) | *(unavailable via web built-ins)* | [web.md](references/web.md) |
| Answer from the user's own documents | `mcp__cherry-tools__kb_list` → `mcp__cherry-tools__kb_search` → `mcp__cherry-tools__kb_read` | [knowledge.md](references/knowledge.md) |
| Add / delete / re-index knowledge | `mcp__cherry-tools__kb_manage` (resolve IDs first; needs approval) | [knowledge.md](references/knowledge.md) |
| Read or convert a local document | `mcp__cherry-tools__to_markdown` → read the returned temporary Markdown path as needed | [documents.md](references/documents.md) |
| Recall a past fact, correction, or preference | `mcp__agent-memory__memory` (`search`) before re-asking | [memory.md](references/memory.md) |
| Save durable knowledge vs. a one-off event | `mcp__agent-memory__memory` (`update` vs. `append`) | [memory.md](references/memory.md) |
| Schedule a recurring / future task | `mcp__cherry-tools__cron` (Cherry scheduling only) | [autonomy.md](references/autonomy.md) |
| Proactively message the user or send a file | `mcp__cherry-tools__notify` | [autonomy.md](references/autonomy.md) |
| Inspect / connect / repair IM channels, rename agent | `mcp__cherry-tools__config` | [autonomy.md](references/autonomy.md) |
| Find, create, message, or inspect work across Agent Sessions | `mcp__cherry-tools__session_list` / `session_search` / `session_create` / `session_send` / `session_deliveries` | [sessions.md](references/sessions.md) |
| Generate an image | `mcp__cherry-tools__generate_image` (needs a painting model) | [outputs.md](references/outputs.md) |
| Declare final deliverable file(s) | `mcp__cherry-tools__report_artifacts` | [outputs.md](references/outputs.md) |
| Run JS/TS or Python, invoke a one-off package, search local code/files | bundled `bun`, `uv` / `uvx`, or `rg` according to task lifetime | [cli.md](references/cli.md) |
| Find / install a command-line tool | `command -v` check → `mcp__cherry-tools__cli_list` → `mcp__cherry-tools__cli_search` → `mcp__cherry-tools__cli_install` (approval) | [cli.md](references/cli.md) |
| Find / install a new capability skill | `mcp__skills__search_skills` → `mcp__skills__install_skill` (approval) | [skills.md](references/skills.md) |

## When a tool isn't there

Two different situations, don't confuse them:

- **The tool is absent from your live list** → the capability is unavailable this
  session (e.g. no knowledge base in scope, or CLI management disabled for a shell-less
  agent). Explain what's missing and what the user can do; don't work around it with
  shell/file tools. The reference for that domain says exactly when it can be absent.
- **The tool is listed but reports a missing dependency** → e.g.
  `mcp__cherry-tools__notify` with no connected channel, or
  `mcp__cherry-tools__generate_image` with no painting model. It stays listed and
  returns a note; relay the note and point the user at configuration — don't retry
  blindly or fake success.

On any **tool error result** (bad ID, unsupported channel/file, invalid recipe), read
the message and correct the call; don't silently retry the same arguments. On **declined
approval**, stop and report — never re-attempt the mutation through a different route.

## Out of scope

Not covered here: SDK-native `Read`/`Edit`/`Bash` and orchestration tools; third-party
(user-configured) MCP servers; the AI-SDK chat `read_file` attachment reader (a
chat-path tool, not exposed on this MCP surface); and the role-specific
`mcp__assistant__*` navigation/diagnosis tools, which belong to the Cherry Assistant and
its own guide.
