# Agent Note: Reduce redundant snapshot copies

Status: implemented

English | [中文](2026-11-14-snapshot-copy-work.zh.md)

## Problem

Synchronous deep copies repeatedly traversed data that streaming and context readers did not need. Replacing snapshots with mutable references would break asynchronous observation, recovery and archived message isolation. A lint ban alone would leave existing hotspots intact.

## Decision

Preserve the snapshot contracts while selecting data before copying:

- Durable projection reads non-message feed state before publishing the new snapshot, avoiding two copies of the replaced history.
- Pi restoration reads scalar input identities instead of copying each growing prefix. Token updates synchronously capture the active block, retaining full current text and authoritative end corrections; completed tool arguments are captured separately.
- Message projection reuses unchanged isolated messages and parts. Changed text shares immutable strings while mutable metadata is captured. Unobserved child delivery waits for a snapshot read; archive persistence continues, and shutdown flushes the final view.
- Claude live batches include the legacy map only when bindings change. Baseline/recovery always include it; the desktop root consumer retains the last map. Observer capture still isolates every delivery.
- Temporary context selects the user-aligned window before copying rows. An unlimited read still returns isolated full history.
- Usage capture performs one outer clone-and-freeze; flat numeric cost breakdowns use shallow copies.

Use Oxlint's built-in `no-restricted-globals` and `no-restricted-properties` to reject new unannotated `structuredClone` accesses, including tests and static accesses through `globalThis`, `window`, `self` and `global`. Remaining call-site exceptions identify the retained ownership boundary. Reasons are a review requirement; no custom parser enforces their content. See [the lint contract](../../../../scripts/lint/README.md).

## Alternatives considered

- Annotate every old call without repairing hotspots: leaves the confirmed unnecessary work unchanged.
- Use references or delta text alone: can expose later native mutation or lose authoritative block corrections.
- Replace deep copies with another helper or JSON serialization: retains traversal cost and can change supported values.
- Exempt whole files/tests: hides future copies behind broad suppressions.
- Add a custom lint plugin: built-in rules cover the chosen static accesses.

## Consequences

The repairs reduce copied payload volume; they do not eliminate all history scans or all deep copies. Public snapshots and recovery intentionally retain full captures, and changed tool payloads still require isolation. ACP's unadopted desktop adapter retains its recovery-state copies; this is not a claim that those costs are acceptable for desktop adoption. Global-object aliases and dynamic property names remain outside the lint rule's coverage.

## Verification

- Regression — Five focused regressions fail against the previous implementations and pass after the repairs: durable replaced-history volume, Pi restoration volume, projection isolation/reuse, unobserved child delivery and temporary-window selection. Counters wrap the real clone operation; they do not substitute a cheaper implementation.
- Regression — Native scripted Pi tests verify final ordered content and absence of full native delta-envelope copies. Existing stream observation cases cover end corrections and tool interleaving. Claude tests cover unchanged-map omission and isolated late baselines.
- Regression — Actual Oxlint CLI tests exercise the repository configuration, direct/qualified access, destructuring, optional/static computed access, narrow suppressions and local names.
- Regression — Local checks provide deterministic copy-work and contract evidence. No production latency percentage, Electron acceptance or real-provider performance result is claimed. Exact executed checks are recorded in the PR.
