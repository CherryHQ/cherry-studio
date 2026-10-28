# Knowledge base

Covers `mcp__cherry-tools__kb_list`, `mcp__cherry-tools__kb_search`,
`mcp__cherry-tools__kb_read`, and `mcp__cherry-tools__kb_manage` — answering from, and
mutating, the user's own documents.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and safety only.

## Conditional availability

The `kb_*` tools appear **only when the agent has a knowledge base in scope** — a bound
base, or one the user picked for this turn. If they're absent, the agent has **no
documents in scope**: tell the user to attach or select a knowledge base. Do **not**
fall back to web search and imply the answer came from their documents.

## Read workflow

When the answer should come from the user's own documents, stay inside the knowledge
tools — do not substitute web search. Typical order:

1. **`mcp__cherry-tools__kb_list`** — enumerate the bases in scope, or outline one base
   to see its documents and their IDs.
2. **`mcp__cherry-tools__kb_search`** — semantic search across the scoped bases for the
   passages that answer the question.
3. **`mcp__cherry-tools__kb_read`** — read a specific document, or grep it for a
   pattern, once search has pointed you at it.

Answer with a citation to the document you used.

## Mutation workflow — `kb_manage`

`mcp__cherry-tools__kb_manage` mutates a base (add / delete / re-index content). It is
**approval-gated**, and **deletion is destructive**. So:

1. **Resolve the exact base/document IDs first** with `mcp__cherry-tools__kb_list` /
   `mcp__cherry-tools__kb_search`. Never guess an ID.
2. Call `mcp__cherry-tools__kb_manage` and let the approval prompt run. Call it only once
   the user's intent is clear.
3. **Never edit the underlying files directly** to achieve the same effect — that skips
   the re-indexing and bookkeeping `kb_manage` performs.

If approval is declined, stop and report — do not retry the mutation through the shell or
file edits.

## Recovery

- **Empty / weak search results** → refine the query, try another base, or widen scope
  before escalating. Only fall back to web search for a knowledge miss if the user is
  fine answering from public sources — and say that's what you did.
- **Tool error result** (bad ID, etc.) → read the message and correct the call; don't
  silently retry the same arguments.

## Example

> "What did our Q3 architecture doc say about the caching layer?"

`mcp__cherry-tools__kb_list` to confirm a base is in scope and find the doc →
`mcp__cherry-tools__kb_search` for "caching layer" → `mcp__cherry-tools__kb_read` the top
hit (or grep it) → answer with a citation. Do not web-search; this is private knowledge.
