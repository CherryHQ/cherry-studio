# Agent Note: Limit OpenClaw stop to the configured gateway port

Status: implemented

English | [中文](2026-11-07-openclaw-stop-port-isolation.zh.md)

## Problem

OpenClaw stop used `pkill -9 openclaw` on POSIX, terminating unrelated gateways. Windows searched netstat output by a port substring, so stopping port 1879 could also terminate a listener on 18790. E2E cleanup must not stop a developer's separate gateway.

## Decision

Find TCP listeners on the exact configured port. Parse Windows local endpoints and LISTENING states; use lsof's TCP listener filter on POSIX. Deduplicate positive PIDs, exclude the current process, and preserve the existing stopped-port verification.

## Alternatives considered

- Global process-name termination crosses instance boundaries.
- Killing only a spawned child would prevent stopping an already-running gateway managed through the configured port.
- Prefix matching a port can select a different gateway.

## Consequences

Stop still manages the configured gateway endpoint, including externally started gateways, but leaves listeners on other ports alone. No configuration or stored-data migration is required.

## Verification

- Regression — simulated OS listener tables model gateways on 1879 and 18790; stopping 1879 must succeed while 18790 remains alive on both platforms. Both cases failed before the fix. All process termination is mocked in these tests.
- Regression — all 149 OpenClawService tests passed. Real gateway start/stop and CODE-03 plus MP-97 reruns remain pending.
