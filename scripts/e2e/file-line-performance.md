# File line navigation performance

Run the component benchmark against an isolated development Electron instance verified
and recorded using `.agents/skills/cherry-electron-dev/references/electron-instance.md`:

```sh
node scripts/e2e/file-line-performance.mjs <pre-feature-commit>
```

The baseline commit must precede line navigation and expose the same `FileEditor` props.
The script verifies PID, cwd and CDP listener ownership (requires `lsof`), uses the exact
recorded main window, mounts a temporary fixed-size harness, then removes it. Electron
remains running. Do not interact with the app during measurement. The generated baseline
module stays under `.context` and only its worker URL is relocated for Vite.

## Measurements

- 4000 ordinary lines, 50000 ordinary lines, and 4000 lines with a wrapped long line every
  seven lines. JSON records UTF-8 byte size as well as line count.
- Plain mount: compare baseline/current editors in alternating order, discard two warmups
  per variant, retain 20 samples per variant. Source is already in memory. This measures
  editor mounting, not disk reads, first-use module loading or Agent pane routing.
- Jump: alternate line 42 and a distant line, discard two warmups, retain 100 samples.
  Timing starts immediately before updating the location prop, ends one animation frame
  after the target line is visible and selected. It includes React/layout work but excludes
  input dispatch, IPC and Playwright polling. It approximates paint opportunity, not a
  compositor presentation timestamp.
- Burst: update the target on consecutive frames and check the final location still wins
  after 300 ms. Reported latency is only for the final request.
- Memory: capture shadow DOM counts and CDP heap/node/listener gauges after 0/50/100 jumps.
  These are unforced-GC observations, not proof of a leak or its absence.
- After timing, separately instrument FileEditor animation-frame scheduling. Assert no
  pending/new navigation frames after settling and after unmounting during navigation.
  This diagnostic instrumentation is excluded from timing samples.

Results include raw samples, median/P95, machine metadata and long-task entries in
`.context/cherry-electron-dev/file-line-performance/results.json`. A timeout, wrong final
location or continuing navigation task fails the run. Latencies have no arbitrary CI gate;
compare repeated runs on the same hardware before setting a budget. Development builds,
worker startup and React instrumentation affect these values; production claims require
an independent production-build run. The baseline comparison isolates `FileEditor`, not
all changes in the feature PR. Markdown/HTML mode switching remains covered by functional
tests and is outside this benchmark.
