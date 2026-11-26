# Agent Note: Reproduce heavy conversation workloads in on-demand E2E

Status: implemented

English | [中文](2026-11-26-conversation-performance-e2e.zh.md)

## Problem

High tool counts, long context and large images can stress the live message and history views in ways that seeded history alone does not exercise.

## Decision

Add a macOS on-demand scenario using AIMock at the model and MCP boundaries. The application sends messages, runs local Bash and image reads, persists results, and scrolls the real surfaces. Persisted tool counts, observed request payloads and successful scroll movement gate the case. Frame intervals are recorded as diagnostic evidence.

The separate rich Work scenario generates 120 turns through the live runtime. It adds four 48-call bursts, scrolls to the oldest user message with a real wheel gesture, and uses the jump-to-bottom button to return to the latest reply. The short scenario remains available for focused validation.

## Alternatives considered

A fixed frame-time gate on hosted runners would mix product behavior with CPU scheduling noise. Seeding assistant replies would skip the tool and streaming paths.

## Consequences

The workload is reproducible through the existing on-demand controller. The loopback relay observes full image payloads and substitutes inline content only when handing oversized requests to AIMock. The fixture profile and generated images are disposable.

## Verification

- Regression — The local production Electron run exercises the real chat composer, persisted tool counts and sidebar and message scrolling. Hosted execution is separate. See the [scenario and dispatch guide](../../../../tests/e2e/ondemand/specs/README.md#conversation-performance).
