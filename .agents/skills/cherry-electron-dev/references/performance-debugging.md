# Performance Debugging

Use this reference for Cherry Studio lag, jank, CPU, memory, leak, startup, or
DevTools investigations.

## Contents

- Safety and target binding
- Choose the smallest profile
- Quick renderer metrics
- Interaction trace
- Memory and allocation checks
- Process and main-process checks
- Startup analysis
- Interpretation and reporting

## Safety and target binding

Follow the parent Skill's instance-binding checks first. Use the recorded PID,
workspace, CDP port, and exact main-window URL. Never find or open a development
instance through the macOS application name `Electron`.

Use the renderer target returned by `/json/list` whose URL is exactly:

```text
http://localhost:5173/windows/main/index.html
```

Connect Playwright to the bound CDP endpoint and resolve the page by URL:

```js
var { chromium } = await import("playwright")
var browser = await chromium.connectOverCDP("http://127.0.0.1:<CDP_PORT>")
var page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((candidate) => candidate.url() === "<MAIN_TARGET_URL>")
if (!page || (await page.title()) !== "Cherry Studio") {
  throw new Error("Bound Cherry Studio main target not found")
}
var cdp = await page.context().newCDPSession(page)
```

Do not call `browser.close()`, `page.close()`, or an Electron quit action.
Detach only the profiling `CDPSession` when finished.

Prefer programmatic CDP because it is repeatable and does not create another
Electron process. If a visible DevTools panel is useful, read the selected
target's `devtoolsFrontendUrl` from `/json/list` and open:

```text
http://127.0.0.1:<CDP_PORT><devtoolsFrontendUrl>
```

Opening that frontend is optional and must not replace the bound CDP session.

## Choose the smallest profile

Use one mode at a time:

| Question | Start with |
| --- | --- |
| Is the renderer busy or memory unusually high? | Quick renderer metrics |
| Which task, script, layout, or paint caused a visible stall? | Interaction trace |
| Does memory grow after repeating the same action? | Repeated checkpoints |
| Which allocations dominate during an action? | Allocation sampling |
| Is the main process or a helper consuming resources? | Process sampling |
| Is startup slow? | Restart-aware startup analysis |

Collect a quiet idle baseline first. Record the exact action, duration, window
size, route, data state, and whether DevTools was visibly open. Visible DevTools
adds overhead, so compare like with like.

## Quick renderer metrics

Enable metrics once per comparison session:

```js
await cdp.send("Performance.enable")
var beforeRaw = await cdp.send("Performance.getMetrics")
var before = Object.fromEntries(
  beforeRaw.metrics.map(({ name, value }) => [name, value])
)
```

Run one bounded idle or interaction window, then collect `after` through the
same session:

```js
var afterRaw = await cdp.send("Performance.getMetrics")
var after = Object.fromEntries(
  afterRaw.metrics.map(({ name, value }) => [name, value])
)
```

Treat these as cumulative counters and compare deltas:

- `TaskDuration`: renderer main-thread task time
- `ScriptDuration`: JavaScript execution time
- `LayoutDuration` and `LayoutCount`: layout work
- `RecalcStyleDuration` and `RecalcStyleCount`: style recalculation
- `V8CompileDuration`: JavaScript compilation

Treat these as point-in-time gauges:

- `JSHeapUsedSize` and `JSHeapTotalSize`
- `Nodes`, `Documents`, `Frames`
- `JSEventListeners`

For a window lasting `elapsedSeconds`, approximate renderer main-thread
utilization as:

```text
100 * delta(TaskDuration) / elapsedSeconds
```

This is an orientation metric, not a complete CPU measurement. Repeat the same
scenario and compare medians when the difference is small.

## Interaction trace

Use a 5-30 second trace around one reproducible slow action. Avoid long,
unbounded recordings.

```js
var traceDone = new Promise((resolve) =>
  cdp.once("Tracing.tracingComplete", resolve)
)
await cdp.send("Tracing.start", {
  categories: [
    "devtools.timeline",
    "v8",
    "blink.user_timing",
    "disabled-by-default-devtools.timeline"
  ].join(","),
  transferMode: "ReturnAsStream"
})
```

Perform the action, then stop and read the trace stream:

```js
await cdp.send("Tracing.end")
var { stream } = await traceDone
var chunks = []
while (true) {
  var part = await cdp.send("IO.read", { handle: stream })
  chunks.push(
    Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8")
  )
  if (part.eof) break
}
await cdp.send("IO.close", { handle: stream })
var fs = await import("node:fs/promises")
await fs.writeFile("<TRACE_PATH>.json", Buffer.concat(chunks))
```

Load the trace in the visible DevTools Performance panel or Chrome trace
viewer. Correlate long tasks with script stacks, rendering, layout, paint, GC,
and user-timing marks. Preserve the raw trace under `.context`; do not commit or
share it because it may contain private UI content or URLs.

## Memory and allocation checks

For suspected leaks:

1. Record heap, node, document, and listener gauges at idle.
2. Repeat the exact action a fixed number of times.
3. Return to the same route and idle state.
4. Record the gauges again.
5. Repeat the cycle to see whether the retained baseline keeps rising.

One larger heap value is not proof of a leak; V8 may defer garbage collection.
Do not force GC unless the investigation explicitly needs a post-GC comparison,
because forced GC changes runtime behavior.

For allocation attribution, use bounded sampling:

```js
await cdp.send("HeapProfiler.enable")
await cdp.send("HeapProfiler.startSampling", {
  samplingInterval: 32768
})
// Perform one bounded scenario.
var { profile } = await cdp.send("HeapProfiler.stopSampling")
var fs = await import("node:fs/promises")
await fs.writeFile("<PROFILE_PATH>.json", JSON.stringify(profile))
```

Take a full heap snapshot only when sampling and repeated gauges are
insufficient. Heap snapshots can pause the renderer, be large, and contain
private application data; state that impact before collecting one.

## Process and main-process checks

Renderer metrics do not identify all Electron process costs. Sample the
recorded process group before, during, and after the scenario:

```bash
ps -axo pid=,ppid=,pgid=,%cpu=,rss=,command= | \
  awk '$3 == <TRACKED_PGID>'
```

Use several samples rather than one. Separate the Electron main process,
renderer/helper processes, Vite, and the runner when interpreting CPU and RSS.

If renderer metrics remain quiet while the main PID is busy, inspect the
recorded main-process inspector port, normally `9229`. Verify its `/json/list`
Node target before attaching. Use a bounded Node CPU profile and correlate it
with the application log. Do not confuse the Node inspector with renderer CDP
port `9222`.

## Startup analysis

Startup profiling requires a restart and therefore is the exception to the
persistent-window rule.

1. Explain why a restart is required.
2. Record the current instance and scenario.
3. Gracefully stop only the tracked instance.
4. Start the same debug command and profile.
5. Preserve startup logs and timestamps.
6. Measure renderer navigation milestones such as `NavigationStart`,
   `DomContentLoaded`, and `FirstMeaningfulPaint`.
7. Update `instance.json` and keep the replacement running.

Distinguish cold native rebuild time, Electron/main-process bootstrap, database
migration, service initialization, renderer load, and first interactive UI.
Do not report the entire `pnpm debug` duration as application startup time.

## Interpretation and reporting

Use evidence patterns, not a single number:

- High `TaskDuration` with high `ScriptDuration`: JavaScript or React work
- High layout/style deltas: DOM size, measurement loops, or CSS invalidation
- Repeated long trace tasks: likely visible jank source
- Rising heap plus nodes/listeners after identical idle cycles: leak suspicion
- Quiet renderer with high main-process CPU: inspect main services or IPC
- High helper/GPU CPU without renderer task growth: inspect media, canvas, GPU,
  or embedded web content

Report:

- exact instance PID, CDP target, route, scenario, and duration
- baseline and scenario metric deltas
- trace/profile artifact paths
- the strongest evidence and remaining uncertainty
- before/after comparison when evaluating a fix

Keep the Electron instance running after collection unless a restart was
explicitly part of the profile.
