# Repositories, pull requests, and merged graphs

Load this reference for repository URLs, multi-repository questions, pull
requests, or graph composition.

## Clone and build

```bash
compass clone https://github.com/OWNER/REPOSITORY
compass clone URL --branch BRANCH --out DIRECTORY
compass update DIRECTORY
```

Cloning uses the network and writes a new checkout. Resolve the destination
before running it and do not overwrite an existing directory.

## Compose graph data

```bash
compass merge-graphs graph-a.json graph-b.json --out merged.json
compass global add path/to/graph.json --as repository-name
compass global list
compass global path
```

Use `merge-graphs` for a concrete merged artifact. Use `global` when maintaining
the local cross-project registry. Preserve repository identity so same-named
symbols are not presented as one source.

## Pull-request workflows

```bash
compass prs
compass prs NUMBER
compass prs --worktrees
compass prs --conflicts
```

PR operations may call external Git hosting tools and read worktree state.
Graph-impact results show shared communities and likely review scope; they do
not prove merge conflicts. Run `compass prs --help` before triage, base-branch,
or mutating options.

For a reproducible risk review of one exact candidate, use the dedicated
command instead of the queue-oriented `prs` workflow:

```bash
compass review --base origin/main --head HEAD
compass review --base main --head feature --format json --output review.json
compass review --pr 42 --repo OWNER/REPOSITORY --format markdown
```

Local mode resolves both revisions to immutable object IDs and never fetches.
GitHub mode reads the pull-request identity, freezes the target, head, and merge
candidate object IDs, and requires the objects to exist locally. Use
`--fingerprint SHA256` when both history realizations must use one exact
extraction profile. Add `--repo OWNER/REPOSITORY --pull-request-number N` in
local mode when the report must carry a forge PR identity.

Choose `--format json` for the canonical
`compass.pr_intelligence.report/1` machine contract, `markdown` for a bounded
review summary, or `sarif` for code-scanning ingestion. `--max-findings` and
`--max-output-bytes` apply only to Markdown and report omissions explicitly.
Use `--output PATH` for an atomic file publication. Run `compass review --help`
for the current option contract.

Risk scores and advisory findings always require reviewer judgment and never
determine the command exit status. In the composite Compass PR risk review
Action, leave `fail-on: none` for report-only operation or select
`fail-on: deterministic` to fail only a proven deterministic gate. Do not turn
indeterminate or incomplete evidence into a merge-blocking conclusion. On
untrusted fork pull requests, keep analysis separate from token-bearing comment
delivery and accept a read-only artifact/summary result when write permission
is unsafe.

`compass merge-driver` is intended for configured merge workflows. Do not invoke
it manually on user files without understanding the base/current/other contract.
