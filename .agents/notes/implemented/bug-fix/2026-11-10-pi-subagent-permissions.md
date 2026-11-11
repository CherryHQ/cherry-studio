# Agent Note: Pi subagent default permissions

Status: implemented

English | [中文](2026-11-10-pi-subagent-permissions.zh.md)

## Problem

Pi and Pi Durable child threads inherited root permissions, leaving delegated writes waiting for approval when the root used default mode.

## Decision

The shared desktop behavior host gives child threads `bypassPermissions`. Root threads continue to read the live agent permission mode. Both runtimes use the same thread identity boundary, including restored children.

## Alternatives considered

- Inheriting root permissions preserves interactive child prompts but does not meet the requested unattended child default.
- Changing global behavior defaults would affect hosts outside the desktop Pi integrations.

## Consequences

Child tools can execute without ordinary approval even when the root requires it. Disabled tools, non-bypassable approvals and other mandatory guards remain enforced by the existing behavior gate. No persisted setting or migration is introduced.

## Verification

- Regression — `PiRuntimeConnection.test.ts` and `PiDurableRuntimeConnection.test.ts`: a child writes a real file without an approval request while its root uses default permissions.
