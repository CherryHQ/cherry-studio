---
name: cherry-tool-guide
description: Cherry Studio first-party tool routing guide for general agents. Use this WHENEVER a task could be served by Cherry's built-in tools — even if the user never names a tool — including researching current/online information (web search & fetch), answering from the user's own documents and knowledge bases, recalling or saving things across sessions (persistent memory), scheduling recurring or one-time tasks and sending notifications, connecting or repairing IM channels (Telegram/Feishu/Discord/Slack/WeChat/QQ), generating images or reporting produced files, discovering or installing command-line tools, and finding or installing new skills. Consult it BEFORE reaching for shell, Bash, or file tools to do any of these, so you route through the correct mcp__cherry-tools__*, mcp__agent-memory__*, and mcp__skills__* tool instead of inventing a workaround.
version: 1.0.0
---

# Cherry Tool Guide

Cherry Studio injects a set of first-party tools into your session over three MCP
servers. They act on the running app — the user's knowledge bases, IM channels,
schedules, managed CLIs, and skill library — through boundaries only Cherry owns.
Shell and file tools cannot reach those boundaries correctly, so when a task matches
one below, route through the named tool rather than improvising with `Bash`/`Write`.

This guide teaches **routing, sequencing, prerequisites, safety, and recovery**. It
does **not** restate argument shapes: the live tool schema in your session is the
authoritative source for parameter names, enums, and required fields. Read it before
calling. Tool names here are fully qualified (`mcp__server__tool`); the exact names
exposed in your session are authoritative if they ever differ.

## Global rules

- **Check availability first.** Several tools are conditional (see below). If a tool
  is not in your live tool list, its capability is unavailable *in this session* —
  say so honestly and stop; never pretend a call succeeded or fabricate its result.
- **Don't reach around Cherry's mutation boundaries.** Knowledge bases, IM channels,
  schedules, managed CLIs, and skills are mutated only through the tools below.
  Do not shell out to `npm install`, `git clone`, `crontab`, or hand-edit knowledge
  files to accomplish these — the tool does bookkeeping (registration, scoping,
  approval, sync) that a raw shell command skips. Shell is fine for *inspection*
  (e.g. `command -v` to probe PATH) — just not to perform the owned mutation.
- **Honor approval.** `mcp__cherry-tools__kb_manage`, `mcp__cherry-tools__cli_install`,
  and `mcp__skills__install_skill` mutate durable state and are gated by the session's
  approval mode. Call them only once the user's intent is clear; if approval is
  declined, stop and report — do not retry the same effect through the shell.
- **Intent still gates auto-approved effects.** Memory writes, schedule changes,
  notifications, and agent/channel configuration may execute without an approval
  card. Do not call them merely because they are available; first make sure the user
  requested the effect or it is necessary to complete an already-approved task.
- **Get exact arguments from the live schema.** This guide names tools and orders
  them; it deliberately omits parameter details so it can't drift from the schema.

## Routing table

| User intent | Route to |
| --- | --- |
| Look up current/online facts, news, docs | `mcp__cherry-tools__web_search` → `mcp__cherry-tools__web_fetch` |
| Answer from the user's own documents | `mcp__cherry-tools__kb_list` → `mcp__cherry-tools__kb_search` → `mcp__cherry-tools__kb_read` |
| Add / delete / re-index knowledge | `mcp__cherry-tools__kb_manage` (after resolving IDs; needs approval) |
| Recall a past fact, correction, or preference | `mcp__agent-memory__memory` (`search`) before re-asking the user |
| Save durable knowledge vs. a one-off event | `mcp__agent-memory__memory` (`update` vs. `append`) |
| Schedule a recurring / future task | `mcp__cherry-tools__cron` (Cherry scheduling only) |
| Proactively message the user or send a file | `mcp__cherry-tools__notify` |
| Inspect / connect / repair IM channels, rename agent | `mcp__cherry-tools__config` |
| Generate an image | `mcp__cherry-tools__generate_image` (needs a painting model) |
| Declare final deliverable file(s) | `mcp__cherry-tools__report_artifacts` |
| Find / install a command-line tool | `command -v` check → `mcp__cherry-tools__cli_search` → `mcp__cherry-tools__cli_install` (approval) |
| Find / install a new capability skill | `mcp__skills__search_skills` → `mcp__skills__install_skill` |

## Conditional availability

- **Knowledge (`kb_*`)** appears only when the agent has a knowledge base in scope
  (a bound base, or one the user picked for this turn). If it's absent, the agent has
  no documents in scope — tell the user to attach or select a knowledge base; do not
  fall back to web search and imply it came from their documents.
- **Managed CLI (`cli_*`)** is absent for agents with no shell (e.g. the built-in
  Assistant). If it's absent, you cannot install CLIs in this session.
- **`mcp__cherry-tools__generate_image`** is always listed but requires a configured
  painting model. With none configured it returns a note explaining that instead of
  an image — relay it; don't claim an image was produced.
- **`mcp__cherry-tools__notify`** needs at least one connected channel. With none, it
  reports that no channel is connected — route the user to
  `mcp__cherry-tools__config` / settings rather than retrying.

## Workflows

### Web research

Fire `mcp__cherry-tools__web_search` for each distinct question — issue several in
parallel when researching multiple topics rather than serializing them. Search returns
snippets and URLs; call `mcp__cherry-tools__web_fetch` only on the few URLs whose full
text you actually need. Fetching every result wastes context — be selective. If search
returns nothing useful, refine the query before fetching.

### Knowledge base

When the answer should come from the user's own documents, stay inside the knowledge
tools — do not substitute web search. Typical order:

1. `mcp__cherry-tools__kb_list` — enumerate the bases in scope, or outline one base to
   see its documents and their IDs.
2. `mcp__cherry-tools__kb_search` — semantic search across the scoped bases for the
   passages that answer the question.
3. `mcp__cherry-tools__kb_read` — read a specific document, or grep it for a pattern,
   once search has pointed you at it.

`mcp__cherry-tools__kb_manage` mutates a base (e.g. add/delete/re-index content). It is
approval-gated, and deletion is destructive: **resolve the exact base/document IDs first** with
`mcp__cherry-tools__kb_list` / `mcp__cherry-tools__kb_search`, then call
`mcp__cherry-tools__kb_manage` and let the approval prompt run. Never
guess an ID, and never edit the underlying files directly to achieve the same effect.

### Persistent memory — `mcp__agent-memory__memory`

This memory survives across sessions and workspaces for the same agent. Three actions:

- `search` — query the journal of past events/notes. **Search here before re-asking the
  user** something they may have already told you (a correction, a preference, prior
  context). Note: `search` covers the appended journal, not the durable fact file.
- `append` — log a one-time event, completed task, or session note to the journal.
- `update` — overwrite the durable fact file with long-lived knowledge and decisions.

Choose `update` vs. `append` by longevity: *"Will this still matter in six months?"*
Durable preferences and standing decisions → `update`; a thing that just happened →
`append`. Because `update` **overwrites the whole fact file**, preserve existing durable
content when you rewrite it — add to it, don't clobber it.

### Scheduling & notification

`mcp__cherry-tools__cron` schedules work **inside Cherry** — never use OS `crontab`,
`at`, or a background shell loop for user-facing schedules; Cherry owns execution,
delivery, and lifecycle. Use it to `add` a recurring or one-time job, `list` existing
jobs, or `remove` one. A job needs exactly one trigger shape (recurring expression,
interval, or a single future timestamp) — consult the schema for which fields express
that. Jobs can deliver their results to channels.

`mcp__cherry-tools__notify` proactively sends the user a message and/or a workspace file
through connected channels — use it to push a result, status update, or produced file
without waiting to be asked. File support varies by channel (some forward any file, some
images only, some none yet); the tool reports per-channel outcomes. If it says no
channel is connected, set one up via `mcp__cherry-tools__config` first.

### Channels & self-config

`mcp__cherry-tools__config` inspects and manages the agent's own configuration.
**Always `status` first** — it lists current channels (with connection state), the
model, and the adapter types you can add, so you act on real IDs instead of guessing.
Then:

- `add_channel` — connect a new IM channel (Telegram, Feishu, Discord, Slack, WeChat,
  QQ). Credential-based types need their fields; WeChat/Feishu can use QR mode.
- `update_channel` / `remove_channel` — change or delete an existing channel by ID.
- `reconnect_channel` — re-establish a channel that dropped; for WeChat/Feishu this
  re-issues a QR code to re-scan (expired session or failed initial setup).
- `rename` the agent, or `complete_bootstrap` / `reset_bootstrap` onboarding.

When a channel needs a QR scan, the tool returns the QR image — display it to the user
and let them scan; the connection completes out of band.

### Images & artifacts

`mcp__cherry-tools__generate_image` renders an image from a prompt using the configured
painting model. If no painting model is configured, it returns an explanatory note, not
an image — relay that and point the user to configure one; don't fake success.

`mcp__cherry-tools__report_artifacts` declares your final deliverable file(s) so Cherry
can surface them to the user. Produce the file first (with your normal tools), then call
`mcp__cherry-tools__report_artifacts` to register it as a deliverable. It's a declaration,
not a transfer — to actually push a file to the user through a channel, use
`mcp__cherry-tools__notify`.

### Managed CLIs

Cherry keeps CLIs in an isolated managed environment. Before installing anything:

1. **Probe the real PATH** — `mcp__cherry-tools__cli_list` reports only Cherry-managed
   binaries and does **not** see the system PATH, so a tool it calls "unavailable" may
   already exist. Run `command -v <name>` (shell inspection is fine) before installing a
   duplicate. Use `mcp__cherry-tools__cli_list` to see what Cherry already manages.
2. `mcp__cherry-tools__cli_search` — look up the exact `name`/`tool` recipe from the
   registry. Never guess the executable name or recipe.
3. `mcp__cherry-tools__cli_install` — install using the recipe from search (or one
   translated from trusted docs). This is approval-gated. **Do not** substitute
   `npm install -g`, `pipx install`, `cargo install`, or a manual download — those
   bypass Cherry's managed environment; `mcp__cherry-tools__cli_install` accepts the
   same backends.

### Skills

`mcp__skills__search_skills` searches skill marketplaces and returns candidates with
quality/source metadata and an opaque `install_source` string. Present the relevant
matches to the user (with their source/quality) and let them choose. Install **only
after** the user signals intent: call `mcp__skills__install_skill` with the exact
`install_source` from a search result, passed verbatim. Never construct that string
yourself, and never run `npx skills add`, `git clone`, or any shell command to install —
Cherry clones, installs the single skill, and registers it in one call.

## Failure & recovery

- **Tool not in your list** → the capability is unavailable this session (for example,
  no knowledge base is in scope or CLI management is disabled). Explain what's missing
  and what the user can do; don't work around it with shell/file tools. A disconnected
  channel is different: `mcp__cherry-tools__notify` remains listed and reports the
  missing connection when called.
- **Empty or weak results** → refine the query, try another base, or widen scope before
  escalating. Only fall back to web search for a *knowledge* miss if the user is fine
  answering from public sources — and say that's what you did.
- **Missing configuration** (no painting model, no channel) → tell the user how to
  configure it (settings, or `mcp__cherry-tools__config` for channels) instead of
  retrying blindly.
- **Approval declined** → stop and report. Do not re-attempt the mutation through a
  different route (shell, file edit).
- **Tool error result** → the tool returns an error message explaining the problem
  (bad ID, unsupported channel/file, invalid recipe). Read it and correct the call;
  don't silently retry the same arguments.

## End-to-end examples

**Answer from the user's documents**
> "What did our Q3 architecture doc say about the caching layer?"

`mcp__cherry-tools__kb_list` to confirm a base is in scope and find the doc →
`mcp__cherry-tools__kb_search` for "caching layer" →
`mcp__cherry-tools__kb_read` the top hit (or grep it) → answer with a citation. Do not
web-search; this is private knowledge.

**Schedule a report and notify on completion**
> "Every weekday morning, summarize my unread items and send it to Telegram."

`mcp__cherry-tools__config` (`status`) to confirm a Telegram channel is connected →
`mcp__cherry-tools__cron` (`add`) a recurring weekday job whose prompt builds the
summary, delivering to that channel. The
scheduled run does the work and delivery; you don't hand-roll an OS cron entry.

**Connect an IM channel**
> "Hook me up to Slack so you can message me there."

`mcp__cherry-tools__config` (`status`) to see supported types and existing channels →
`mcp__cherry-tools__config` (`add_channel`, type Slack) with the required credentials
from the schema → confirm it shows connected in a follow-up `status`. Later,
`mcp__cherry-tools__notify` to message the user there.

**Install a missing CLI**
> "I need `ripgrep` available for searches."

`command -v rg` to check the real PATH → if absent, `mcp__cherry-tools__cli_list` to see
if Cherry already manages it → `mcp__cherry-tools__cli_search` "ripgrep" for the exact
recipe → `mcp__cherry-tools__cli_install` with that recipe (approval runs). Never
`brew install`/`cargo install` it yourself.

**Find and install a capability skill**
> "Is there a skill for reviewing React performance?"

`mcp__skills__search_skills` "react performance" → present the best matches with their
source and quality → if the user says install one, `mcp__skills__install_skill` with
that result's exact `install_source`. No `git clone`, no manual copying.

## Coverage note

Covered first-party tools for general agents: `mcp__cherry-tools__web_search`,
`mcp__cherry-tools__web_fetch`, `mcp__cherry-tools__report_artifacts`,
`mcp__cherry-tools__generate_image`, `mcp__cherry-tools__kb_list`,
`mcp__cherry-tools__kb_search`, `mcp__cherry-tools__kb_read`,
`mcp__cherry-tools__kb_manage`, `mcp__cherry-tools__cron`,
`mcp__cherry-tools__notify`, `mcp__cherry-tools__config`,
`mcp__cherry-tools__cli_list`, `mcp__cherry-tools__cli_search`,
`mcp__cherry-tools__cli_install`; `mcp__agent-memory__memory`;
`mcp__skills__search_skills`, `mcp__skills__install_skill`.

Intentionally **out of scope** (not covered here): SDK-native `Read`/`Edit`/`Bash` and
orchestration tools; third-party (user-configured) MCP servers; the AI-SDK chat
`read_file` attachment reader (a chat-path tool, not exposed on this MCP surface); and
the role-specific `mcp__assistant__*` navigation/diagnosis tools, which belong to the
Cherry Assistant and its own guide.
