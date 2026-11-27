# Agent Note: Held reply failures and Durable shutdown

Status: implemented

English | [中文](2026-11-09-agent-terminal-and-durable-shutdown.zh.md)

## Problem

Main holds an intermediate native success while a reply still has undelivered background results. Keeping that first success as the final outcome masks a later error or pause.

Pi Durable shared behavior waits for submitted input to be consumed. Ordered shutdown joins tracked adapter calls before closing the native Harness, so a child waiting behind running work can prevent shutdown from ever reaching native cancellation. Separately, waiting for `native.closed` before reporting source loss hides fatal storage failure until tool cleanup finishes.

## Decision

An unsettled success is provisional. A later error or pause replaces it, and the first non-success remains authoritative. Existing persistence and settlement fences continue to reject late terminal events.

Shared behavior reuses its admission promises to finish native input admission, then aborts only local consumption waits. It does not abort the native submission. An uncertain receipt remains unknown; shutdown never resends the input. Normal shutdown continues to drain admitted relation reads, final observations and archives in their existing order.

The adapter subscribes to the SDK's public close notification. Unexpected native closure immediately seals access and closes feeds with `source-lost`; native cleanup continues independently. Intentional shutdown still closes feeds after final delivery. No SDK patch, extra queue or service is introduced.

## Alternatives considered

- Keep the first terminal outcome: intermediate success can conceal a later failure.
- Close the native Harness before joining all calls: admitted relation reads and final archive delivery can lose their storage source.
- Cancel queued submissions or resend after shutdown: cancellation changes accepted work, while resend can duplicate it.
- Notify only after `native.closed`: blocked cleanup keeps consumers waiting on a failed source.

## Consequences

Failure reaches the product reply before storage cleanup completes. Local input waiters can end with an unknown/closed receipt while the original native input remains queued. Callers reconcile existing native evidence rather than infer cancellation or submit again. These guarantees cover orderly close and fatal-source notification; they do not prove power-loss recovery or exactly-once external tool effects.

## Verification

- Regression — `agentSessionRuntimeState.test.ts`: held success followed by error or pause settles with the non-success outcome; late success and result drainage do not settle twice. Both cases failed before the repair.
- Regression — `shutdown.test.ts`: a real native SQLite Harness closes while a shared-behavior child generation is blocked; reopening finds the original steer still queued with one native request identity. Shutdown failed to complete before the repair.
- Regression — `relations.test.ts`: a real SDK storage scan failure closes observation and pending child access while tool cancellation cleanup is blocked. Notification waited for cleanup before the repair; normal shutdown still delivers admitted relations.
- Regression — Electron with LongCat AI / LongCat-2.5: a real background child holds parent success; an injected runtime error persists the same assistant as error and releases the composer. Closing another real background child with a queued steer retains the native queued record and one product input.
- Regression — Electron native failure injection: with `beforeClose` held, a live product session persists its assistant as error and releases the composer before native cleanup completes. The desktop injection targets the native failure entry; the storage scan regression above covers the real SDK storage boundary.

Focused validation passes 262 Main tests and 81 Durable tests, with three declared Durable skips. Node and package typechecks and the package build pass. Electron artifacts live under `.context/cherry-electron-dev/terminal-shutdown/`; fault injection is distinguished from real provider requests.
