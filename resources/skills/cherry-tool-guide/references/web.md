# Web research

Covers `mcp__cherry-tools__web_search` and `mcp__cherry-tools__web_fetch`, plus the hard
limits of Cherry's web built-ins.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and limits only.

## Availability

Both tools are ordinarily present for general agents. If either is absent from your live
tool list, web capability is unavailable this session — say so; don't approximate it
with shell commands.

## Workflow

1. **`mcp__cherry-tools__web_search`** — fire one call per distinct question. When
   researching several topics, issue the searches **in parallel** rather than
   serializing them. Search returns snippets and URLs, not full pages.
2. **`mcp__cherry-tools__web_fetch`** — call only on the few URLs whose full text you
   actually need. Fetching every result wastes context — be selective.

If a search returns nothing useful, **refine the query before fetching** anything. Don't
fetch low-relevance URLs just because they came back.

## Browser limitation (important)

Cherry's web built-ins **search and fetch only**. They cannot:

- click, hover, or otherwise interact with a page,
- fill or submit forms,
- navigate authenticated / logged-in pages,
- capture screenshots or render dynamic content.

If a task needs any of that and no separate browser-automation tool is exposed in your
session, **tell the user the interaction is unavailable** rather than approximating it
with shell commands or pretending a fetch achieved it.

## Recovery

- **Empty / weak results** → refine the query, try different terms, or widen scope
  before giving up. Don't fetch noise.
- **Tool error result** → read the returned message and correct the call; don't silently
  retry identical arguments.

## Web vs. the user's own documents

If the answer should come from the user's private documents, this is the wrong domain —
use the knowledge tools instead (see [knowledge.md](knowledge.md)). Only fall back to
web search for a *knowledge* miss when the user is fine with public sources, and say
that's what you did.
