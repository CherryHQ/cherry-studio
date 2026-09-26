# Deferred full-only engine port
## Impeccable detector and live-browser engine
Port status: one referenced asset is absent — the proposed Node engine below is not implemented or invocable. This document is the follow-up design, not an installation instruction.
Dependency preventing mini inclusion: upstream Rust native engine, platform binaries, context/detect/hook implementations and browser instrumentation. Upstream launchers may download an engine. Mini forbids that runtime closure.
Proposed Node interface: `node scripts/impeccable-engine.mjs inspect --input recorded-surface.json --output findings.json`; versioned input contains DOM tree, computed styles, viewport, theme, accessible names and screenshot references, captured by the harness's existing browser capability.
Retain: rule identities, context precedence, mode decisions, deterministic findings with evidence and bounded completed-phase review.
Omit until parity: live native browser acquisition, native process hooks, engine heuristics not backed by fixtures. Never add a new daemon or silently emulate unavailable browser APIs.
Acceptance: pinned engine corpus and recorded-input comparisons for context and detector findings, Windows cmd/PowerShell plus macOS/Linux execution, offline closure, no native executable/interpreter/download, accurate capture provenance. Independent reviewer confirms differences. This proposal is not implemented engine parity.
## Platform SDK execution
SwiftUI/Apple profiling and Android/Flutter builds use their project toolchains; portable instruction content does not make those toolchains Node applications. A Node adapter can invoke an explicitly configured supported toolchain with argument arrays, preserve platform units and return unavailable on unsupported hosts. Acceptance requires actual platform execution; no substitute mock receipt.

