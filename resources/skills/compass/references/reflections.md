# Saved results and reflections

Load this reference when the user wants durable project knowledge or when an
existing graph has learned lessons.

Before a codebase question, run:

```bash
compass reflect --if-stale
```

When generated, `compass-out/reflections/LESSONS.md` summarizes corroborated
query outcomes. Use only lessons relevant to the current question and verify
them against the current graph or source when correctness matters.

Save a result only when requested or required by repository guidance:

```bash
compass save-result \
  --question "Where is authorization enforced?" \
  --answer-file answer.md \
  --nodes NODE_A NODE_B \
  --outcome useful
```

Supported outcomes distinguish useful answers, dead ends, and corrected results.
Use `--correction` when preserving a correction. Do not store secrets, transient
credentials, or unsupported guesses.

Reflection is not a substitute for graph refresh. If source changed, run
`compass update .` first, then reflect.
