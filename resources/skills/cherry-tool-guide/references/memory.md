# Persistent memory

Covers `mcp__agent-memory__memory` — memory that survives across sessions and workspaces
for the same agent.

Get exact argument shapes from the live tool schema — this reference gives routing and
semantics only.

## Availability

Ordinarily present. If absent from your live tool list, persistent memory is unavailable
this session.

## Intent gate

Memory writes may execute **without an approval card**. Don't write merely because the
tool is available — only when the user asked you to remember something, or a durable
fact is genuinely worth persisting for future sessions.

## Three actions

- **`search`** — query the journal of past events/notes. **Search here before re-asking
  the user** something they may have already told you (a correction, a preference, prior
  context). Note: `search` covers the appended journal, **not** the durable fact file.
- **`append`** — log a one-time event, completed task, or session note to the journal.
- **`update`** — overwrite the durable fact file with long-lived knowledge and decisions.

## Choosing `update` vs. `append`

Decide by longevity — *"Will this still matter in six months?"*

- Durable preferences, standing decisions, corrections to how you should work, and
  reusable tool-usage lessons → **`update`**.
- A thing that just happened → **`append`**.

**`update` overwrites the whole fact file.** Preserve existing durable content when you
rewrite it — add to it, don't clobber it. Read/recall the current durable content first
if you're unsure what it holds.

## Recovery

- **Tool error result** → read the message and correct the call; don't silently retry
  the same arguments.
