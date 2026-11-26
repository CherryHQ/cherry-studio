# Agent Note: Defer layout reads for collapsed conversation tools

Status: implemented

English | [中文](2026-11-26-collapsed-conversation-tool-measurement.zh.md)

## Problem

When completed tool groups enter the Work message list, Radix Collapsible measures initially hidden panels and Radix Presence reads their animation styles. These synchronous reads can force style and layout while the conversation renders a new reply.

## Decision

Patch Collapsible to skip the initial measurement for hidden, closed panels and measure once the panel opens. Patch Presence to read animation style in its state effect only when mounted. Both patches apply to the CommonJS and ESM builds.

## Alternatives considered

Replacing the accordion in the conversation would duplicate disclosure behavior and leave the same layout reads in other consumers of the shared primitive.

## Consequences

Opening, closing, and reopening panels use the existing Radix measurement and exit animation behavior. Recheck both patches when upgrading Radix.

## Verification

- Regression — `pnpm test:pkg:ui packages/ui/src/components/primitives/__tests__/accordion.test.tsx` checks that an initially closed accordion defers size and animation reads and can be opened, closed, and reopened by keyboard.
- Regression — A local production Electron replay of the 120-turn AIMock Work workload reduced measured hidden tool panel reads from 34 to zero across 27 sampled sends.
