# Persistent memory

Use server `agent-memory`, tool `memory` for memory that survives across sessions and
workspaces for the same agent. Resolve its callable name from the live session using
the guide's naming rule.

Get exact argument shapes from the live tool schema — this reference gives routing and
semantics only.

## Availability

Ordinarily mounted unless disabled; it may be deferred on some runtimes. Before
claiming absence, check current tools and the discovery your session actually offers,
following the guide's shared availability procedure. If discovery returns nothing,
re-check tools already available and earlier successful discovery: the tool may
already be loaded. Tool discovery is separate from the memory tool's own `search`
action, which queries the journal.

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
