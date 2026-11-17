# Agent Note: Full anti-slop adoption and incremental cleanup

Status: proposed

English | [中文](2026-11-18-anti-slop-lint.zh.md)

## Problem

The initial local integration selects only three anti-slop rules. The requested target is all generic upstream rules in the existing lint gate, followed by cleanup of existing violations. The initial `scripts/lint/vendor/` nesting also obscures the plugin's tooling role.

## Proposal

Register all 18 generic anti-slop rules and native `oxc/no-accumulating-spread` as errors in the existing Oxlint gate. Preserve existing lint scope and unrelated rules. Omit the Effect-specific plugin sources because this repository does not use Effect. New findings are existing migration work, not grounds to disable rules, downgrade severity, add directory exemptions or introduce fabricated type evidence.

Place the copied plugin at `scripts/lint/anti-slop/`, retain its exact upstream revision and MIT notices, and keep `@oxlint/plugins` pinned to the exact Oxlint version. Upstream explicitly supports copying source and has no official npm package; its package exports uncompiled TypeScript, which Node does not strip inside `node_modules`. A Git dependency would require an extra compilation or loading mechanism. The initial integration keeps the supported local-source mechanism without the redundant outer vendor directory. The plugin's own third-party notices retain their upstream layout.

Inventory findings by rule and file, then clean bounded modules while preserving their observable contracts. Apply spacing fixes only within the selected batch and keep semantic review distinct from formatting. Replace unsafe types with actual domain evidence or existing schemas; retain field omission, callback ordering, proxy receiver semantics and test isolation. Do not disguise module mocking under aliases to evade the rule. Cleanup of all repository debt is an ongoing migration; the first implementation covers a tested initial batch and explicitly reports remaining findings. The Spec stays proposed until the full repository migration is complete.

## Alternatives considered

- Keep only compatible rules: the user explicitly requests full adoption and cleanup.
- Use an unofficial npm package or Git dependency: adds another release owner or a compilation mechanism rather than using upstream's supported installation.
- Rewrite the whole repository in one unreviewable change: boundary and test migrations need contract-specific verification.

## Acceptance criteria

- AC1 — All 18 generic upstream rules and the native accumulator-spread companion are errors in the existing lint configuration; real CLI probes verify rejection and supported code. (verification: unit)
- AC2 — The plugin loads from `scripts/lint/anti-slop/` with matching pinned dependencies, unchanged upstream generic production source, no unused Effect plugin, and retained license/provenance records. (verification: unit)
- AC3 — A bounded initial cleanup batch passes targeted lint and existing tests for its affected contracts; subsequent batches retain the same verification discipline. (verification: unit)
- AC4 — The remaining rule inventory and verification limits are reported accurately; documentation describes full adoption and the incomplete migration. (verification: docs gate)

## Risks

Full adoption initially exposes existing violations, so the repository lint gate can remain red until migration finishes. Unknown-input restrictions, module mocks, reflection and type assertions require domain-specific changes rather than mechanical replacements. Spacing fixes can interact with formatting and need a second-pass stability check. AST and lexical-scope rules do not prove cross-file type safety or universal performance improvement. The initial batch does not claim full-repository validation or complete migration.
