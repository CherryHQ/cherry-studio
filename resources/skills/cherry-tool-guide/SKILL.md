---
name: cherry-tool-guide
description: 'Cherry tool routing: bun, uv, rg, knowledge, memory, schedules, skills, MCP, web. Read before shell workarounds.'
version: 1.8.0
---

# Cherry Tool Guide

Cherry Studio provides first-party tools through four MCP servers: `cherry-tools`,
`agent-memory`, `skills`, and `mcp-manager`. Which tools mount depends on the session.
Shell-capable general agents also get bundled runtimes for local execution. The MCP
tools act on the running app — the user's knowledge bases, IM channels, schedules,
managed CLIs, skill library, and MCP server registry — through boundaries only Cherry
owns. Shell and file tools cannot reach those app boundaries correctly; use the bundled
runtimes only for the local execution cases routed below.

**This file is a router.** It carries only the global rules and the intent → tool →
reference table. Each reference holds that domain's prerequisites, sequencing,
conditional availability, output interpretation, recovery, and examples. Read the one
reference the task needs (and any it cross-links to) before calling — don't work from
this page alone.

Resolve server/tool identity to a callable name: take the exact identifier verbatim
from your current session's schema or discovery result. Treat every qualified name in
this guide and its references as a runtime-specific example governed by this rule.
Never construct a name from examples, convert punctuation, convert to camelCase, or
reconstruct a digest. This guide never restates argument shapes — **the live tool
schema in your session is the authoritative source** for
parameter names, enums, and required fields. Read it before every call.

## Global rules

- **Check availability first.** Apply this procedure to every absence claim throughout
  this guide and its references, including claims based on a missing live-list entry.
  Missing from initial tool declarations does not mean absent: a tool may already be
  active or reachable through deferred/script discovery. First inspect tools currently
  available, then use whatever discovery your session actually offers. Query by
  capability or bare tool/server identity (e.g. `memory`, `agent-memory`), not only an
  assumed full identifier. On a miss, broaden the query or inspect the catalog as the
  discovery tool's own schema allows. Only after these checks establish absence, stop
  and report the capability absent. If discovery is unavailable or fails, report that
  limitation instead of asserting nonexistence. Never pretend a call succeeded or
  fabricate a result.
- **Don't reach around Cherry's mutation boundaries.** Knowledge bases, IM channels,
  schedules, managed CLIs, skills, and registered MCP servers are mutated only through
  these tools. Do not shell out to `npm install`, `git clone`, `crontab`, or hand-edit
  knowledge or MCP settings files to accomplish these — the tool does bookkeeping (registration, scoping, approval, sync)
  that a raw shell command skips. Shell is fine for *inspection* (e.g. `command -v` to
  probe PATH) — just not to perform the owned mutation.
- **Honor approval.** `mcp__cherry-tools__kb_manage`, `mcp__cherry-tools__cli_install`,
  `mcp__cherry-tools__session_create`, `mcp__cherry-tools__session_send`,
  `mcp__skills__install_skill`, and `mcp__mcp-manager__install_mcp_server` are gated by
  the session's approval mode. Call them only once the user's intent is clear; if approval is
  declined, stop and report — do not retry the same effect through another route.
- **Intent still gates auto-approved effects.** Memory writes, schedule changes,
  notifications, Session renames, and agent/channel configuration may execute without an approval card.
  Do not call them merely because they are available; first make sure the user requested
  the effect or it is necessary to complete an already-approved task.

## Routing table

| User intent | Route to | Reference |
| --- | --- | --- |
| Look up current/online facts, news, docs | `mcp__cherry-tools__web_search` → `mcp__cherry-tools__web_fetch` | [web.md](references/web.md) |
| Browser interaction (click, forms, screenshots) | Automation REPL when Browser is enabled; load `cherry-browser` | [web.md](references/web.md) |
| Native desktop applications (open, type, click, screenshots) | Automation REPL when Computer Use is enabled; load `cherry-computer` | [automation.md](references/automation.md) |
| Answer from the user's own documents | `mcp__cherry-tools__kb_list` → `mcp__cherry-tools__kb_search` → `mcp__cherry-tools__kb_read` | [knowledge.md](references/knowledge.md) |
| Add / delete / re-index knowledge | `mcp__cherry-tools__kb_manage` (resolve IDs first; needs approval) | [knowledge.md](references/knowledge.md) |
| Read or convert a local document | `mcp__cherry-tools__to_markdown` → read the returned temporary Markdown path as needed | [documents.md](references/documents.md) |
| Recall a past fact, correction, or preference | Server `agent-memory`, tool `memory` (`search`) before re-asking; resolve callable name above | [memory.md](references/memory.md) |
| Save durable knowledge vs. a one-off event | Server `agent-memory`, tool `memory` (`update` vs. `append`); resolve callable name above | [memory.md](references/memory.md) |
| Schedule a recurring / future task | `mcp__cherry-tools__cron` (Cherry scheduling only) | [autonomy.md](references/autonomy.md) |
| Proactively message the user or send a file | `mcp__cherry-tools__notify` (needs configured recipients) | [autonomy.md](references/autonomy.md) |
| Inspect / connect / repair IM channels, rename agent | `mcp__cherry-tools__config` | [autonomy.md](references/autonomy.md) |
| Rename the current or another Agent Session | `mcp__cherry-tools__session_rename` | [sessions.md](references/sessions.md) |
| Find, create, message, or inspect work across Agent Sessions | `mcp__cherry-tools__session_list` / `session_search` / `session_create` / `session_send` / `session_deliveries` | [sessions.md](references/sessions.md) |
| Generate an image | `mcp__cherry-tools__generate_image` (needs a painting model) | [outputs.md](references/outputs.md) |
| Declare final deliverable file(s) | `mcp__cherry-tools__report_artifacts` | [outputs.md](references/outputs.md) |
| Run JS/TS or Python, invoke a one-off package, search local code/files | bundled `bun`, `uv` / `uvx`, or `rg` according to task lifetime | [cli.md](references/cli.md) |
| Find / install a command-line tool | `command -v` check → `mcp__cherry-tools__cli_list` → `mcp__cherry-tools__cli_search` → `mcp__cherry-tools__cli_install` (approval) | [cli.md](references/cli.md) |
| Find / install a new capability skill | `mcp__skills__search_skills` → `mcp__skills__install_skill` (approval) | [skills.md](references/skills.md) |
| Register a new MCP server the user supplied | `mcp__mcp-manager__install_mcp_server` (approval; never invent the config) | [mcp.md](references/mcp.md) |

## When a tool isn't there

Distinguish these cases after checking availability as above:

- **The tool exists but is deferred or already loaded.** It may be missing from initial
  declarations, and a loading search may return nothing. That means no new matching
  tools were loaded, not that the tool does not exist. Re-check tools already available
  and any earlier successful discovery; use script/catalog discovery when your session
  offers it. An empty catalog query means no matches in that query's searched set;
  neither result alone proves absence.
- **The capability is unavailable after resolution.** For example, no knowledge base
  is in scope, or CLI management is disabled for a shell-less agent. Explain what's
  missing and what the user can configure; don't work around it with shell/file tools.
  Use the domain reference's availability conditions under the shared procedure above.
- **The tool is listed but reports a missing dependency** → e.g.
  `mcp__cherry-tools__generate_image` with no painting model. It stays listed and
  returns a note; relay the note and point the user at configuration — don't retry
  blindly or fake success.

On any **tool error result** (bad ID, unsupported channel/file, invalid recipe), read
the message and correct the call; don't silently retry the same arguments. On **declined
approval**, stop and report — never re-attempt the mutation through a different route.

## Out of scope

Not covered here: SDK-native `Read`/`Edit`/`Bash` and orchestration tools; *calling* the
tools of a third-party (user-configured) MCP server — only registering one is in scope,
see [mcp.md](references/mcp.md); the AI-SDK chat `read_file` attachment reader (a
chat-path tool, not exposed on this MCP surface); and the role-specific
`mcp__assistant__*` navigation/diagnosis tools, which belong to the Cherry Assistant and
its own guide.
