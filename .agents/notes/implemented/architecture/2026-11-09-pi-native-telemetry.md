# Agent Note: Pi native telemetry

Status: implemented

English | [中文](2026-11-09-pi-native-telemetry.zh.md)

## Problem

Cherry creates `pi.generate_content` and `pi.execute_tool` from host observations while Pi's native telemetry is disconnected. The model span repeats the gateway's AI SDK observation; the host tool span omits native task phases, replay and recovery links.

## Decision

Bridge Pi's `TelemetryContext` to the existing OpenTelemetry provider and local trace storage. Durable receives the bridge through `HarnessOptions.telemetry`. Pi owns submission and task-phase instrumentation; Cherry supplies the developer-gated session parent, serializable propagation and viewer projection. Native phases retain their attributes, events and links, including tool identity and replay outcomes.

AI SDK owns model spans and token usage; HTTP tracing owns wire bodies. Suppress `pi.ai.request` and `pi.ai.poll` while retaining their parent context for descendants. Pass the native phase parent through the gateway's opaque internal usage capture. Billing remains gateway-owned. Remove host-created Pi model and tool spans. No dependency instrumentation patch is needed.

The user approved native telemetry and explicitly required avoiding overlap with the underlying AI SDK trace in the implementation conversation. No separate GitHub Spec approval is claimed.

## Alternatives considered

- Enrich the host-created spans: retains a second lifecycle implementation and duplicates model observations.
- Patch ModelRuntime to emit native model spans: duplicates AI SDK coverage and adds an unnecessary dependency patch.
- Forward public trace headers: exposes attribution to untrusted callers; the existing internal capture already authenticates the owner.

## Consequences

Ordinary Pi 1.5.0 has no native tool-span API; it retains gateway model visibility and tool transcripts without fabricated replacement spans. Native telemetry intentionally excludes message and tool bodies. Tasks persisted before telemetry was enabled have no carrier and cannot reconstruct their original parent. Native carriers freeze their initiating owner rather than follow a mutable active turn. Metrics export is outside this trace integration.

## Verification

- AC1 — `PiDurableRuntimeConnection.test.ts`: real native submissions and tool phases expose tool identity, outcomes and committed-entry events; generation receives the phase parent.
- AC2 — `piTelemetry.test.ts`: serialized carriers retain parent identity and links after adapter recreation with a different session owner.
- AC3 — `gatewayIntegration.test.ts`: native model binding and the production gateway produce one SDK request under the phase, one upstream request and one SQLite usage record; `ApiGatewayService.test.ts` covers frozen ownership and released captures.
- AC4 — `piTelemetry.test.ts`: disabled tracing preserves results; errors preserve identity; final explicit status wins and settled spans reject further updates.

Eight explicitly selected main-process suites passed (171 tests); the final adapter suite passed all seven tests after adding the last-status-wins regression. The production Durable connection test proves native tool phases and generation parents. The native model binding → production gateway → loopback upstream test proves one SDK request under the phase, one upstream request and one SQLite usage row. Carrier tests recreate the adapter with a different session owner and verify the original parent, links and events survive. Disabled tracing and error identity are covered separately.

Node typechecking and changed-file lint/format checks passed. These are in-process integration results; the new telemetry path was not exercised in Electron or against a live provider.
