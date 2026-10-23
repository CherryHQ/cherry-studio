# Agent Note: Sandbox capability diagnostics

Status: implemented

English | [中文](2026-10-22-sandbox-diagnostics.zh.md)

## Problem

Editable JavaScript examples cannot establish host-observed file permissions, nested RPC, independent instance ownership, or destination allowlist enforcement. A failed network connection alone is not evidence of isolation.

## Decision

The diagnostics UI runs four fixed groups through the public sandbox manager. Main owns the temporary root and window cancellation, the package owns fixtures and guest RPC, and each MXC lease owns its network proxy. Fixed regression requests supply only a group name. A separate interactive request accepts bounded RPC parameters and callback authorization, or HTTP(S) request and allowlist origins; executable, owner, host methods and filesystem grants remain host-owned. Its completed trace reports actual policy, callback values and responses, without presenting external network failures as isolation verdicts. The diagnostic guest bundles the existing RPC library at build time instead of receiving read access to development dependencies.

macOS proxy mode uses MXC's proxy-only egress and a separate `proxy-chain` server per instance. Each HTTP request or CONNECT tunnel checks an exact host/port grant. Domain resolutions to private or special addresses are rejected; private destinations require an explicit IP grant. Stopping revokes proxy connections. A kill error racing guest exit is accepted only after independent SDK exit confirmation; otherwise ownership remains available for cleanup retry.

## Alternatives considered

- Raw SDK launches inside diagnostics would test a different path from product callers.
- Public websites introduce availability and DNS noise; owned reachable HTTP fixtures provide positive controls and destination counters.
- Enabling unrestricted networking to demonstrate allowlists would not establish OS enforcement.

## Consequences

Windows proxy mode remains unsupported. CONNECT authorizes a TCP endpoint, not TLS identity or application content. The native checks do not prove hard-link isolation, descendant termination, or packaged application acceptance. Stop cancels the active group and prevents subsequent groups from starting. Each group has a 30-second deadline and at most two target instances.

## Verification

- AC1 — `packages/sandbox/tests/acceptance/diagnostics.test.ts` exercises all four groups on native macOS through the public manager, including the bundled guest and cleanup.
- AC2 — `packages/sandbox/tests/contracts/proxy.test.ts` checks HTTP/CONNECT denial, independent proxy grants, private DNS aliases and connection refusal after close; `lease.test.ts` checks kill/exit races and retained cleanup ownership.
- AC3 — Renderer and shared IPC tests check distinct failure/unsupported results, rerun recovery, cancellation of Run all, and rejection of renderer-selected capabilities.

- AC4 — The macOS Electron UI passes all 21 checks, group reruns and manual Stop. The integration exposed raw Node header arrays crashing network monitoring; `MainNetworkDevtoolsService.test.ts` protects correct header normalization and credential redaction. Windows and packaged builds were not exercised.

- AC5 — Interactive acceptance and renderer tests cover edited RPC values, disabled callback authorization, edited network grants, an empty deny-all list, and bounded responses.
