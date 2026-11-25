# Agent Note: Bound native observation history retention

Status: implemented

English | [中文](2026-11-15-native-observation-retention.zh.md)

## Problem

Image-heavy Durable tasks still exhaust main-process memory after the [trace repair](2026-11-14-agent-trace-memory-recovery.md). A native observer can queue 100 complete history snapshots before ordinary overflow. Each snapshot and captured frame is cloned, so a stalled consumer retains repeated image bodies. Durable also clones the full snapshot merely to read inputs or preserve state during publication.

A synthetic experiment using the preview's ThreadFeed holds one consumer while publishing the same 2 MiB image snapshot 40 times. After GC, retained heap grows by about 80 MiB, almost entirely in large objects. This proves a retention mechanism; the incident dump does not identify the exact owners of its retained heap.

Claude's paired queue bypasses ThreadFeed observation. Reusing strings alone still leaves repeated full container copies in its eager recovery frames. A blocked observer with 16,000 tool-result text blocks and 40 control publications exceeds a 16 MiB additional-heap budget before the count limit.

## Decision

Even a drained observer retains its complete baseline, and serializing deep copies duplicates immutable image strings across feeds, observers and product projections. Reuse the existing Claude history copier in the common runtime: copy mutable containers, preserve plain-object cycles and reuse immutable strings. Non-JSON values retain the native-clone fallback. Apply it to feed snapshots, captured metadata and changed product message parts; consumer mutation isolation and complete payloads remain intact.

Keep existing mutation isolation, asynchronous delivery, cursor barriers, critical-frame capture and count limits. Add a conservative 16 MiB pending-size budget per observer, measured without JSON serialization. Cache estimates for immutable delivery records. Size pressure uses the existing gap/current-snapshot recovery path and retains ordered critical frames with publication-time metadata.

One complete oversized frame is allowed, and an unstarted observer keeps its first baseline. Recovery may therefore hold a baseline, critical frames and the latest complete state beyond the nominal budget; the budget prevents repeated obsolete large snapshots, not the size of an individual conversation. If the retained critical backlog exceeds the count or size allowance, report overflow and source-lost rather than discard completion silently. Closing before first callback still delivers the baseline first.

Expose an isolated state-only view on ThreadFeed and use it for Durable input lookup and publication state. It excludes messages; complete snapshot reads and model history remain unchanged. No task is resubmitted or compacted by this repair.

For Claude, share the frozen normalized revision and native metadata captured at publication with observers. Budget the paired queue's additional retained graph, excluding its authoritative current baseline and counting shared object identities once. Keep the 16 MiB limit and single complete oversized-frame allowance. Cache immutable object shapes without retaining discarded graphs. Do not repeatedly charge unchanged history or substitute the latest state for an older control fact.

On unrecoverable Claude control pressure, close only that native owner and notify the desktop outside the blocked observer. The desktop clears queued input, fails the reply and uses its existing session-close barrier. Unconfirmed native exit or undrained writes retain failure state and block replacement. Other owners remain usable; ordinary observer stop and callback errors do not cancel execution.

## Alternatives considered

- Raise V8 heap size: leaves count-bounded multi-MiB snapshots unbounded in practice.
- Share mutable bodies with consumers: violates observer and publisher isolation.
- Drop terminal frames or truncate image history: loses accounting/completion facts or changes model-visible data.
- Add a Main-only trace cap: native observation exists independently of tracing.

## Consequences

Slow observers recover sooner for large histories. Unrecoverable critical-byte pressure can close observation before the old event-count limit; it is an explicit gap, not successful completion. Complete latest state remains available on native reopen. Disk history and model inputs are preserved.

## Verification

- Regression — `packages/agent-runtime/tests/observation.test.ts`: size pressure recovers before 100 events, keeps fast observers progressing, preserves ordered terminal metadata and drain barriers, and closes an oversized critical backlog explicitly. The first three new cases fail before this repair.
- Regression — `packages/agent-runtime/tests/observation.test.ts`: an unstarted observer receives its baseline before source-lost; an oversized latest snapshot remains complete; state-only reads isolate mutations without carrying historical messages.
- Regression — synthetic ThreadFeed experiment: the same 2 MiB / 40-publication scenario retains about 2 MiB after GC with the repair, versus about 80 MiB before. No user data, network or tools are involved.
- Regression — `observation.test.ts` and `MessageProjection.test.ts`: twelve isolated consumers keep complete 4 MiB image strings within a 16 MiB additional-heap budget after GC; before the container-copy repair they retain approximately 52 MiB and 48 MiB. `cloneHistoryData.test.ts` preserves cycles and isolates arrays, typed arrays, dates and error causes; function and symbol payloads remain rejected.
- Regression — Claude `observation.test.ts`: a 16,000-block tool result behind 40 controls stays below 16 MiB additional heap without closing; byte pressure reports before consumer release, and recovery preserves publication-time content, usage identity and mutation isolation. The memory and early-pressure cases fail on the parent revision.
- Regression — Claude `runtime.test.ts`: fatal delivery pressure closes the affected native owner and rejects new input while a second owner still accepts input.
- Regression — `desktopRuntime.integration.test.ts` and `AgentSessionRuntimeService.handoff.test.ts`: the desktop receives a fatal error before the projection consumer resumes; queued input is not resent and the session stays unavailable until close completes.

Windows packaged acceptance under the original workload remains pending; the local memory experiment does not establish that every possible OOM has been eliminated.
