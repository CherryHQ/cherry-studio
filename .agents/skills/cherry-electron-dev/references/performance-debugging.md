# Performance Debugging

Use this reference for Cherry Studio lag, jank, CPU, memory, leak, startup, and
DevTools investigations.

## Contents

- Bind safely and choose a profile
- Quick renderer metrics
- Interaction trace
- Memory and allocation
- Process and main-process checks
- Startup analysis
- Interpretation and reporting

## Bind safely and choose a profile

First read [Electron Instance Management](electron-instance.md) and complete
its PID, workspace, CDP, and target checks. Never find or open a development
instance through the macOS application name `Electron`.

Connect Playwright to the recorded CDP port and exact main target:

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

Never call `browser.close()`, `page.close()`, or an Electron quit action.
Detach only the profiling `CDPSession`. For visible DevTools, open the selected
target's frontend without replacing the bound session:

```text
http://127.0.0.1:<CDP_PORT><devtoolsFrontendUrl>
```

Choose the smallest profile:

| Question | Profile |
| --- | --- |
| Renderer load or memory level? | Quick metrics |
| Cause of a visible stall? | 5-30 second trace |
| Memory growth after repetition? | Repeated checkpoints |
| Allocation source? | Allocation sampling |
| Main/helper resource use? | Process sampling |
| Slow startup? | Restart-aware startup analysis |

Collect a quiet idle baseline. Keep action, duration, window size, route, data,
and visible-DevTools state identical between comparisons.

## Quick renderer metrics

```js
await cdp.send("Performance.enable")
var beforeRaw = await cdp.send("Performance.getMetrics")
var before = Object.fromEntries(
  beforeRaw.metrics.map(({ name, value }) => [name, value])
)
// Run one bounded scenario.
var afterRaw = await cdp.send("Performance.getMetrics")
var after = Object.fromEntries(
  afterRaw.metrics.map(({ name, value }) => [name, value])
)
```

Compare deltas for cumulative counters: `TaskDuration`, `ScriptDuration`,
`LayoutDuration`, `LayoutCount`, `RecalcStyleDuration`, `RecalcStyleCount`, and
`V8CompileDuration`. Treat `JSHeapUsedSize`, `JSHeapTotalSize`, `Nodes`,
`Documents`, `Frames`, and `JSEventListeners` as point-in-time gauges.

Approximate renderer main-thread utilization for a window of
`elapsedSeconds`:

```text
100 * delta(TaskDuration) / elapsedSeconds
```

This is orientation, not complete CPU usage. Repeat identical scenarios and
compare medians when differences are small.

## Interaction trace

Trace one reproducible action for 5-30 seconds:

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
// Perform the action.
await cdp.send("Tracing.end")
var { stream } = await traceDone
var chunks = []
while (true) {
  var part = await cdp.send("IO.read", { handle: stream })
  chunks.push(Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"))
  if (part.eof) break
}
await cdp.send("IO.close", { handle: stream })
var fs = await import("node:fs/promises")
await fs.writeFile("<TRACE_PATH>.json", Buffer.concat(chunks))
```

Correlate long tasks with script stacks, layout, paint, GC, and user timing.
Keep raw traces under `.context`; they may contain private UI content or URLs.

## Memory and allocation

For leak suspicion, record heap/nodes/documents/listeners at idle, repeat the
same action a fixed number of times, return to the same idle state, and record
again across multiple cycles. One larger heap value is not proof; V8 may defer
GC. Do not force GC unless a post-GC comparison is explicitly needed.

For bounded allocation attribution:

```js
await cdp.send("HeapProfiler.enable")
await cdp.send("HeapProfiler.startSampling", { samplingInterval: 32768 })
// Perform one bounded scenario.
var { profile } = await cdp.send("HeapProfiler.stopSampling")
var fs = await import("node:fs/promises")
await fs.writeFile("<PROFILE_PATH>.json", JSON.stringify(profile))
```

Use a full heap snapshot only when sampling and gauges are insufficient. Warn
first: it can pause the renderer, be large, and contain private data.

## Process and main-process checks

Sample the tracked process group several times before, during, and after:

```bash
ps -axo pid=,ppid=,pgid=,%cpu=,rss=,command= | \
  awk '$3 == <TRACKED_PGID>'
```

Separate Electron main, renderer/helper, Vite, and runner costs. If renderer
metrics are quiet while main is busy, verify and attach to the recorded Node
inspector target, normally port `9229`. Use a bounded CPU profile and correlate
it with application logs. Do not confuse it with renderer CDP `9222`.

## Startup analysis

Startup profiling requires a restart:

1. Explain and record the current instance/scenario.
2. Gracefully stop only the tracked instance.
3. Start the same debug command and profile.
4. Preserve startup logs and timestamps.
5. Measure navigation milestones such as `NavigationStart`,
   `DomContentLoaded`, and `FirstMeaningfulPaint`.
6. Update `instance.json` and keep the replacement running.

Separate native rebuild, main bootstrap, database migration, service startup,
renderer load, and first interactive UI. Do not treat the whole `pnpm debug`
duration as app startup.

## Interpretation and reporting

- Script-heavy `TaskDuration` suggests JavaScript/React work.
- Layout/style deltas suggest DOM measurement or CSS invalidation.
- Repeated long trace tasks identify likely jank sources.
- Heap plus node/listener growth after identical idle cycles suggests a leak.
- Quiet renderer plus high main CPU points to services or IPC.
- High helper/GPU CPU without renderer task growth points to media, canvas,
  GPU, or embedded web content.

Report exact PID/target/route/scenario/duration, baseline and scenario deltas,
artifact paths, strongest evidence, uncertainty, and before/after comparison
for a fix. Keep Electron running after collection unless restart was explicitly
part of the profile.
