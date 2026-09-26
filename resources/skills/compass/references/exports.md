# Export graph artifacts

Load this reference when the user needs an interactive visualization, call-flow
report, wiki, Obsidian vault, exchange file, or graph-database representation.

Exports transform an existing graph; they do not rebuild source extraction.

```bash
compass export html
compass export callflow-html
compass export wiki
compass export obsidian
compass export svg
compass export graphml
compass export neo4j
compass export falkordb
```

Use the format that fits the consumer:

- `html`: interactive graph visualization with optional node limits.
- `callflow-html`: architecture-oriented HTML with derived or supplied sections,
  diagrams, report context, language, and output controls.
- `wiki`: agent-crawlable index and community articles.
- `obsidian`: a linked Markdown vault.
- `svg`: portable static visualization.
- `graphml`: exchange with tools such as Gephi or yEd.
- `neo4j` and `falkordb`: local openCypher output by default.

Use `--graph PATH` and `--labels PATH` together when exporting a non-default
graph so labels are not accidentally borrowed from the current project.
`callflow-html` can also consume a report and explicit section definition file;
run its help before setting diagram-size or section limits. If an artifact is
for review, prefer a deterministic explicit `--output` or `--dir`.

Database `--push` options perform network writes. Use them only when requested,
run `compass export --help` first, and keep credentials in their documented
environment variables. Never echo database passwords in commands or reports.

After a wiki export, begin at `compass-out/wiki/index.md`. Report the actual
output path and whether a live push was attempted or only a local file was
generated. After any export, verify that the artifact was newly written rather
than reporting an older file left at the same destination.
