# Add sources and watch changes

Load this reference when the user adds an external source or requests continuous
refresh.

## Watch a local project

```bash
compass watch .
compass watch PATH --debounce 2
compass watch PATH --poll
```

Watch mode rebuilds deterministic changes after its debounce interval. It does
not silently call a semantic model in the background. When semantic media
changes, Compass may write `compass-out/needs_update`; run `compass extract`
interactively with the desired provider to refresh that layer.

Watch is long-lived. Keep the process visible, report startup failures, and stop
it when the user no longer wants monitoring.

## Add an external source

```bash
compass add URL
compass add URL --author "Name" --contributor "Name" --dir ./raw
```

`add` fetches the requested source and writes it locally. It is a network and
filesystem mutation, so confirm that the URL is in scope. Preserve authorship
and contributor metadata when the user provides it.

Adding a source does not make an old graph current. After a successful add, run
the appropriate `compass update` or `compass extract` for the destination.
