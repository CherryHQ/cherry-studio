# Agent Note: Native execution for Pi Durable behavior

Status: proposed

English | [中文](2026-11-22-pi-durable-native-behavior.zh.md)

## Problem

The [shared behavior proposal](2026-10-18-agent-behavior-package.md) routes Pi Durable through the same execution ports as Pi. Pi Durable already owns the scheduler, input queue, task transactions and child ownership. Its adapter recreates call scopes and materializes broad history facts even when a caller only needs to route an input or read a child run's state.

## Proposal

Keep `@cherrystudio/agent-runtime-pi-durable`, `createPiDurableRuntime` and the desktop backend. Register Cherry's tools, goals and child jobs via package-private native hooks, tasks and transactions. The desktop backend continues to supply approvals, questions, model configuration and other desktop services. Share product rules and record codecs where both engines consume them. The existing shared orchestration continues to serve Pi. This proposal supersedes its shared execution-port requirement for Pi Durable.

Move ordinary submission, child state and shutdown off full-history reads first. Keep the native submission receipt and terminal outcome authoritative. Apply accepted observation changes from the native view or commit. Separate cold attachment and recovery from live work so a pure append reads only the changed records and the state that owns them. The desktop retains its existing message and archive contract.

Reuse persisted conversation IDs, task names and versions, input and phase layouts, deduplication keys, memos and provider bindings. Restore model options and child ownership before scheduling resumed work. Existing SQLite databases can open in place. The Timeline archive has its own storage spec.

## Alternatives considered

- Keep the execution ports and optimize each read. This removes individual scans, while new native features continue to need port translation.
- Mount the entire extension in the desktop backend. This would expose the Harness and its recovery and scheduling order across the package boundary.

## Acceptance criteria

- AC1 — Ordinary input routing and child status read native facts with work independent of old message and part counts, and owner close has no conversation scan for empty callbacks (verification: runtime owner, counted long-history tests)
- AC2 — Approvals, edited arguments, cancellation and tool-result offload preserve the desktop behavior through native hooks (verification: runtime owner, real native tool and desktop connection tests)
- AC3 — Goals, child continuations, Stop, reports and usage preserve their outcomes and original ownership through native tasks and transactions (verification: runtime owner, contract and desktop connection tests)
- AC4 — A real SQLite database written by the previous build reopens with the same conversation IDs, checkpoint ancestry, pending inputs and resumable tasks. Existing receipts and memos prevent duplicate effects (verification: runtime owner, cross-build SQLite replay)
- AC5 — The production Durable entry and package declarations are independent of shared execution ports. The Pi adapter continues to load and use them (verification: package owner, import rules, build and adapter regression tests)

## Risks

A different native task version or memo name would break pending work on upgrade. Keep those keys until old records can be read through an explicit compatibility path. Compare child completion and result delivery against native receipts so an idle snapshot alone cannot retire the wrong run.
