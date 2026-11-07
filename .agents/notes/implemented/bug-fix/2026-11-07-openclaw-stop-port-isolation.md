# Agent Note: Limit OpenClaw stop to the configured gateway port

Status: implemented

English | [中文](2026-11-07-openclaw-stop-port-isolation.zh.md)

## Problem

OpenClaw stop used `pkill -9 openclaw` on POSIX, terminating unrelated gateways. Windows searched netstat output by a port substring, so stopping port 1879 could also terminate a listener on 18790. Port matching alone also selected unrelated applications on the configured port, including during application shutdown when no gateway had been started. CI also exposed a launched gateway that the command-line fallback could not identify, leaving its listener running when Stop was requested. Two focused Windows runs later stalled during shutdown before OpenClaw cleanup completed: shutdown unnecessarily entered synchronous listener discovery even when the application had never started a gateway.

## Decision

Retain the spawned gateway process handle with its port and clear it when that child exits. For an explicit Stop on the same port, terminate the still-live owned process tree through the existing process-runner utility. An exited child or a handle for another port cannot authorize that explicit endpoint stop.

Application shutdown terminates only a still-live spawned child through that retained handle, even if the configured port has since changed. It performs no external listener discovery or command-line lookup. Externally started gateways remain running.

For explicit Stop of other gateways, find TCP listeners on the exact configured port. Parse Windows local endpoints and LISTENING states; use lsof's TCP listener filter on POSIX. Deduplicate positive PIDs and exclude the current process. Before terminating each candidate, read its command line through POSIX `ps` or Windows CIM. Accept the exact POSIX `openclaw-gateway` process title, an OpenClaw executable running `gateway`, or Node/Bun running an OpenClaw package entrypoint with that command. Missing, unreadable, and unrelated identities are preserved. Keep the existing stopped-port verification.

## Alternatives considered

- Global process-name termination crosses instance boundaries.
- Killing only a spawned child would prevent stopping an already-running gateway managed through the configured port.
- Prefix matching a port can select a different gateway.
- Port occupancy or a generic HTTP health response does not establish the listener's OpenClaw identity.

## Consequences

Explicit Stop still manages identified OpenClaw gateways on the configured endpoint, including externally started gateways. Shutdown releases only the application’s spawned child, avoiding synchronous OS discovery on the quit path. Other ports and unverified listeners remain untouched. If an unverified listener keeps the port occupied, stop reports failure rather than claiming it stopped the gateway. No configuration or stored-data migration is required.

## Verification

- Regression — `pnpm exec vitest run --project main src/main/services/__tests__/OpenClawService.test.ts`: 169/169 passed, including live owned gateways after argv changes, exited/reused PIDs, a different configured port, exact-port isolation, legitimate identities, unrelated and unreadable listeners, misleading arguments, and shutdown without starting a gateway. Two newly added ownership cases failed before the child-handle correction and passed afterward. Six shutdown ownership cases also fail before the shutdown repair and pass afterward: externally started gateways survive, live owned children stop after a port change, and exited/reused child identities cannot authorize termination. All process termination is mocked.
- Review — independent verification of the preceding port-isolation revision confirmed all three review findings resolved, with no new confirmed defect.
- Electron — the earlier port-isolation revision passed a 13-test focused batch including CODE-03. Real CODE-03 passed with the child-handle correction; the focused `openclaw` report and cleanup gates passed, and the owned runtime directory was removed. Hosted and full E2E confirmation remain pending.
