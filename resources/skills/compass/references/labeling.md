# Label communities and regenerate reports

Load this reference when communities have placeholder names, the user requests
better architecture labels, or only labels and related reports need refreshing.

Clustering and labeling are different:

- `compass cluster-only` computes community membership from an existing graph.
- `compass label` names those communities and rewrites label-aware reports and
  visualization artifacts.

## Label safely

```bash
compass label .
compass label . --missing-only
compass label . --backend NAME --model MODEL
```

Labeling can send representative node names and community context to the
selected semantic provider. Confirm provider scope before running it. If no
provider is intended, keep deterministic placeholder labels rather than
pretending semantic names were generated.

Use `--missing-only` when existing curated or previously accepted labels should
survive. A full labeling run may replace them. `--batch-size` and
`--max-concurrency` control request shape and concurrency; they do not change the
underlying community membership.

Run `compass label --help` before changing `--resolution`, `--exclude-hubs`, or
`--min-community-size`. Those options can alter which communities are presented,
so they are not merely cosmetic.

## Inputs and outputs

By default Compass reads the graph under `compass-out/`. Use `--graph PATH` when
labeling a non-default graph, and keep its report/output context separate from
the current project graph. `--no-viz` updates the graph and report without
retaining the HTML visualization.

After a successful run, verify:

1. the command reported the expected number of communities,
2. `GRAPH_REPORT.md` corresponds to the selected graph,
3. label metadata exists in the graph,
4. visualization presence or removal matches `--no-viz`.

Provider failure must be reported. Do not describe fallback placeholders as
model-generated labels. If only some names are missing, prefer a later
`compass label --missing-only` retry over discarding good labels.
