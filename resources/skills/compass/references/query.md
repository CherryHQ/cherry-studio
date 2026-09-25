# Query and navigate

Load this reference for codebase questions when a graph exists.

## Natural-language traversal

```bash
compass query "where is authentication enforced?"
compass query "who calls PaymentGateway.charge?"
compass query "path from CheckoutController.create to PaymentGateway.charge"
compass query "payment retries" --traverse
compass query "payment retries" --dfs
compass query "payment retries" --text-budget 1500
compass query "payment retries" --cursor '<TOKEN>'
compass query "payment retries" --context call
compass query "authentication flow" --direction both --scope package:auth
compass query "what uses charge?" --direction incoming --context call --format json
```

Plain questions against a current typed graph use bounded structured discovery.
`--direction`, `--scope`, `--context`, `--dfs`, and discovery bounds compose in
that contract. Historical discovery resolves `--at REV` once and reads the
selected immutable realization's trusted `compass.graph/1` artifact.

`--text-budget` bounds only the rendered page; it does not change the semantic
response. Keep the 2,000-token default for a focused question. Read the final
`Pagination:` line and repeat the unchanged question, graph selector, and
semantic discovery options with `--cursor <TOKEN>`. The presentation-only text
budget may change between pages. Continue until `next=none` before an
exhaustive claim. The cursor binds the request, graph, semantic-result digest,
and next stable entry, so changed inputs fail clearly. If enough evidence
arrives earlier, disclose that additional pages remain.

`--context VALUE` filters relationships by their stored evidence context, such
as `call`, `import`, or `route`, before traversal. It does not select a node,
file, package, community, or subsystem. Use repeatable `--scope KIND:VALUE` for
an explicit OR scope. Supported kinds are `community`, `source`, `package`, and
`node`; every scope must resolve canonically, and Compass never guesses a kind.
Use `--direction auto|incoming|outgoing|both` to override or expose direction
selection. Inspect direction, ambiguity, completeness, domain truncation, and
pagination before relying on the response. `--traverse`, `--budget`, and
`--page` select legacy traversal and cannot be mixed with discovery controls.

Before retrying a weak result, derive a small vocabulary set from the request:
exact symbol spellings, file or crate names, domain nouns, and likely community
labels already present in `GRAPH_REPORT.md`. Retry with one concrete anchor at a
time. Do not add technologies or components unsupported by the repository.

Use a non-default graph or immutable commit explicitly:

```bash
compass query "authentication flow" --graph other/graph.json
compass query "authentication flow" --at HEAD~20
```

`--graph` and `--at` are mutually exclusive.

For agent-controlled follow-up, use the versioned Agent View projection:

```bash
compass query "who calls PaymentGateway.charge?" --format agent-json
compass callers PaymentGateway.charge --format agent-json
```

Read `status.resultState`, `answer`, and `caveats` before `primaryResults`,
`paths`, or `relationships`. `no_match`, `needs_resolution`, and `no_path`
must remain non-answers; fallback candidates are leads only. Check both
`sourceExecution` and `projection` for truncation and treat `coverage:
unknown` as unknown rather than complete. Use exact `nextActions` arguments and
IDs rather than rebuilding shell commands. Agent View JSON is
`compass.query.agent-view/1`; raw `--format json` remains the full audit
result, and human text headings are presentation rather than a parser
contract.

## Focused graph operations

```bash
compass ask "who calls PaymentGateway.charge?"
compass ask "what depends on authorizePayment?"
compass search PaymentGateway
compass callers PaymentGateway.charge
compass callees CheckoutController.create
compass impact authorizePayment --max-depth 3
compass explore CheckoutController PaymentGateway --root .
compass node route:/checkout CheckoutController.create
compass explain PaymentGateway
compass explain PaymentGateway --budget 8000 --page 2
compass architecture --format agent-json
compass path CheckoutHandler PaymentGateway
compass affected authorizePayment --depth 3
compass tree
```

- `ask` requires deterministic routing of a direct natural-language question
  to a bounded typed operation such as search, callers, callees, impact, or
  node trail. Treat the reported operation and any ambiguity as part of the
  result.
- `search` resolves typed symbols by exact or fuzzy name.
- `callers` returns one attributable incoming usage hop across calls, routes,
  references, imports, exports, and aliases. `callees` walks one outgoing call
  hop.
- `impact` traverses a bounded transitive radius and excludes heuristic
  evidence by default.
- `explore` returns related source and paths together under source and response
  byte limits.
- `node` exposes the evidence trail and provenance between two symbols.
- `explain` reports a matched node and connected context; follow its pagination
  metadata when connections or ambiguous candidates span multiple pages.
- `node` reports a directed evidence trail. A `direction_mismatch` diagnostic
  includes a `compass path SOURCE TARGET` next action when a connection exists
  only by ignoring edge direction.
- `path` ranks an undirected traversal while preserving stored relationship
  direction in its displayed arrows.
- `affected` follows impact relations and returns a review candidate set.
- `tree` combines repository structure with graph metadata.

If a label is ambiguous, retry with the exact node ID, symbol spelling, or source
file returned by `query`.

Prefer a shorter query with one concrete identity over a long prose prompt
containing several unrelated questions. Split multi-part investigations so the
evidence for each claim stays attributable.

## Exact CompassQL

CompassQL is a deterministic, read-only openCypher subset. Use it for exact
patterns, parameters, stable JSON, or automation:

```bash
compass query --cql \
  "MATCH (caller)-[:CALLS]->(target)
   WHERE target.label = 'authorizePayment()'
   RETURN caller.id, target.id
   LIMIT 20"

compass query --cql \
  'MATCH (caller)-[:CALLS]->(target)
   WHERE target.label = $target
   RETURN caller.id' \
  --param target='authorizePayment()' \
  --format json
```

Use `PROFILE` only when query-plan details are needed. Run
`compass query --help` and consult the repository's CompassQL support document
before using syntax beyond known supported clauses or changing execution limits.
Natural-query `--page` does not apply to CompassQL. For large row sets, paginate
with a stable `ORDER BY` plus `SKIP` and `LIMIT`; change only the offset between
requests.

For reusable automation, prefer `--file`, `--params-file`, and JSON or JSONL
output over shell interpolation. Use parameters for values rather than splicing
untrusted text into CompassQL. Keep timeout, row, path-depth, expanded-relation,
and memory limits enabled; raise one only when the bounded query demonstrably
needs it. The REPL and stdin modes are interactive/input transports, not extra
query capabilities.

## Query Program IR

Use `compass program` when the question concerns normalized functions, call
evidence, or capability completeness rather than graph topology:

```bash
compass program coverage
compass program show <symbol-id>
compass program explain-call src/lib.rs:240
compass program query \
  "MATCH (f) WHERE f.kind = 'program_function' RETURN f.symbol_id, f.coverage"
```

The Program IR CompassQL projection is offline and read-only. Check the
capability state before using a result as change-impact evidence: `partial`,
`indeterminate`, and `failed` results require qualification or stronger
evidence. Function nodes expose `call_resolution_state` and
`impact_eligible`; only resolved targets create `CALLS` edges, and an
unresolved call never proves that no downstream target exists.

## Evidence discipline

Query output is scoped evidence, not a generated narrative. Verify material
claims against `source_file` and `source_location`. Distinguish:

- a direct extracted relation,
- a resolved or inferred relation with confidence,
- an ambiguous candidate,
- no path represented in the current graph.

Do not translate “no result” into “impossible.” Check graph freshness and query
spelling first.
