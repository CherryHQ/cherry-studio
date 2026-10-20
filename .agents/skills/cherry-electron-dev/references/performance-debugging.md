# Performance Debugging

Use this reference for Cherry Studio lag, jank, CPU, memory, leak, startup, and
DevTools investigations.

## Contents

- Bind safely and choose a profile
- Quick renderer metrics
- Interaction trace
- Memory and allocation
- Development-runtime overhead
- Node and main-process checks
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
| Main/helper resource use? | Process sampling, then Node inspector |
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

Triangulate renderer memory instead of relying on one number:

- OS RSS or process footprint includes V8, native allocations, graphics, and
  diagnostic buffers.
- `JSHeapUsedSize` covers only the live V8 heap.
- `Nodes`, `Documents`, `Frames`, and `JSEventListeners` expose retained UI
  structures but not native or performance-entry storage.

Large OS growth with a stable JS heap and stable DOM gauges is not, by itself,
an application heap leak. Check development-runtime instrumentation before
changing product code.

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

## Development-runtime overhead

Development measurements are useful for relative comparisons, but their
absolute memory and CPU are not a production baseline. HMR, source maps,
DevTools, Strict Mode, and framework instrumentation can add or retain work.
Keep visible-DevTools state identical across samples and identify the retaining
system before attributing growth to Cherry Studio.

React 19 development builds emit component Performance Tracks through User
Timing. When a changing prop contains a growing HTML or text string, React can
serialize both previous and current prop values into
`PerformanceMeasure.detail.devtools.properties` on every render. Those entries
remain in the renderer's performance timeline until cleared and can make the
process footprint grow by gigabytes while the JS heap and DOM stay bounded.

Suspect this path when a CPU profile contains `logComponentRender`,
`addValueToProperties`, or `performance.measure`. Inspect entry counts and
string lengths without returning or serializing the retained values:

```js
var timingSummary = await page.evaluate(() => {
  var measures = performance.getEntriesByType("measure")
  var reactMeasures = 0
  var largestProperty = null

  for (var entry of measures) {
    var devtools = entry.detail?.devtools
    if (devtools?.track !== "Components ⚛") continue
    reactMeasures++

    for (var property of devtools.properties ?? []) {
      if (!Array.isArray(property)) continue
      for (var value of property) {
        if (
          typeof value === "string" &&
          value.length > (largestProperty?.length ?? 0)
        ) {
          largestProperty = { component: entry.name, length: value.length }
        }
      }
    }
  }

  return { totalMeasures: measures.length, reactMeasures, largestProperty }
})
```

Do not call `JSON.stringify()` on all performance entries or return their
`detail` objects over CDP; that creates another large copy and contaminates the
measurement.

To distinguish retained diagnostic entries from an application leak:

1. Stop or finish the bounded scenario and capture OS, heap, DOM, and timing
   counts.
2. Save any required trace before cleanup; clearing removes evidence from the
   current User Timing buffer.
3. Run `performance.clearMeasures()` and `performance.clearMarks()` in the
   page.
4. Only for this explicit post-cleanup comparison, run
   `HeapProfiler.collectGarbage` and resample the same gauges.
5. If measures immediately accumulate again, rendering is still active; wait
   for the same idle state and repeat once.

A sharp process-footprint drop after cleanup, with bounded heap and DOM, is
evidence of development instrumentation retention rather than an equivalent
production leak. It is not a product fix: never add content truncation,
memoization, or stream throttling solely to hide this signal. If production
impact matters, verify it independently against the current production bundle
or packaged build and report separately whether that validation was run.

## Node and main-process checks

Identify the busy process before profiling. Sample the tracked process group
several times before, during, and after:

```bash
ps -axo pid=,ppid=,pgid=,%cpu=,rss=,command= | \
  awk '$3 == <TRACKED_PGID>'
```

Separate Electron main, renderer/helper, GPU, Vite, runner, and spawned child
process costs. A Claude Code or MCP child is not part of the Electron main V8
isolate even when it shares the process group; profile the PID that actually
owns the CPU or memory.

### Prefer the built-in main-process diagnostics

For startup, lifecycle, database, DataApi, or IPC latency, first read
[Performance Diagnostics](../../../../docs/references/diagnostics/README.md). Restart the
tracked instance with `CS_DIAGNOSTICS=1` prepended to its existing launch
command only when the restart is justified by the question. The opt-in path
provides:

- a `boot-whenReady.cpuprofile` with 1000 microsecond V8 samples;
- lifecycle service spans and event-loop lag;
- slow better-sqlite3 queries, DataApi requests, and IPC handlers;
- window construction and ready-to-show timings.

Keep the sampling interval at 1000 microseconds. Sort CPU profiles by self time;
wall time assigned to async service initialization can include sibling work and
is not reliable attribution.

Interpret the combined signals:

| Observation | Likely class | Next evidence |
| --- | --- | --- |
| High CPU and profiler self time | Synchronous JavaScript or native call site | Inspect the hottest stack and bound the same input |
| High event-loop lag | Main thread blocked | Correlate the lag window with CPU, DB, IPC, and logs |
| Long wall time, low CPU, low lag | Async I/O, network, timer, or subprocess wait | Trace start/end timestamps and the external dependency |
| `fires=0` during a long startup phase | Microtask chain never yielded | Trust CPU self time, not timer-based lag |
| Slow better-sqlite3 query plus lag | Synchronous database work | Inspect SQL, row count, query plan, and transaction scope |

### Profile steady-state Node work

For runtime work outside startup, verify that the recorded Node inspector port,
normally `9229`, belongs to the exact Electron main PID. Inspect
`http://127.0.0.1:<INSPECTOR_PORT>/json/list`, attach to that target, and collect
only a bounded reproduction with `Profiler.enable`,
`Profiler.setSamplingInterval({ interval: 1000 })`, `Profiler.start`, and
`Profiler.stop`. Save the returned profile under
`.context/cherry-electron-dev/` and detach the inspector connection afterward.
Do not confuse the main-process inspector with renderer CDP, normally `9222`.

Do not leave the CPU profiler running while waiting for user input or an
unbounded stream. Sampling has overhead, and an oversized profile is harder to
attribute. Compare the same duration and input, and use source-mapped stacks
from the tracked debug instance.

If the exact main PID has high CPU but the V8 profile does not account for it,
capture a short native sample of that PID on macOS:

```bash
sample <ELECTRON_MAIN_PID> 10 -file \
  .context/cherry-electron-dev/main-native-sample.txt
```

This gap points toward Electron, a native addon, another main-process thread,
or the wrong PID—not automatically toward JavaScript. Keep native samples under
`.context`; stacks and paths may be private.

### Diagnose Node memory growth

At matched idle checkpoints, record both OS RSS/footprint and main-isolate
memory from `process.memoryUsage()` through inspector `Runtime.evaluate`. Return
only numeric fields and aggregate resource types; do not return application
objects or message contents over the inspector channel.

```js
(() => {
  var memory = process.memoryUsage()
  var resources = process.getActiveResourcesInfo?.() ?? []
  var resourcesByType = {}
  for (var type of resources) {
    resourcesByType[type] = (resourcesByType[type] ?? 0) + 1
  }
  return { ...memory, resourcesByType }
})()
```

Use repeated, fixed-size cycles and return to the same idle state before each
sample:

- rising `heapUsed` after comparable post-GC checkpoints suggests retained JS
  objects;
- rising `external` or `arrayBuffers` suggests Buffer, typed-array, or native
  backing-store retention;
- rising handle/resource counts suggest timers, sockets, pipes, or requests
  that were not released;
- rising OS footprint with bounded isolate fields points toward Electron/native
  allocations, SQLite/native addons, allocator fragmentation, or another
  process—not proof of a JavaScript leak.

Capture the raw checkpoint first. When a post-GC discriminator is necessary,
call `HeapProfiler.collectGarbage` through the same main-process inspector and
resample after a fixed quiet delay. Compare post-GC checkpoints with each
other; do not compare a forced-GC result with an arbitrary pre-GC peak. A heap
drop without an RSS drop can be allocator retention rather than live objects.

Use `HeapProfiler.startSampling` for bounded allocation attribution. Reserve a
full heap snapshot for cases sampling cannot resolve: it pauses the main
process, can be very large, and may contain tokens, prompts, paths, or other
private data. Never expose the main inspector beyond loopback, and do not add
permanent diagnostic logging or instrumentation until existing evidence shows
which boundary lacks observability.

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
