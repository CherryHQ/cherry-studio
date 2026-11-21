# Agent Note: Full anti-slop adoption and incremental cleanup

Status: proposed

English | [中文](2026-11-18-anti-slop-lint.zh.md)

## Problem

Enabling the complete anti-slop preset at once exposes substantial existing debt and keeps the lint gate red. The migration needs to clear each rule before activating it, while making all generic rules available without unused framework-specific sources.

## Proposal

Keep `no-shape-in-symbol-names` explicitly off. Its substring ban rejects correct geometric terms, schema definitions and persisted property names. Restricting it to bare `Shape` declarations would still impose a naming preference without establishing a domain or safety contract. Preserve its upstream source without a local fork; do not rename correct identifiers solely to satisfy it.

Install all 18 generic anti-slop rules and the native `oxc/no-accumulating-spread` companion. Activate the 17 selected generic rules and the native companion individually only after their findings within the approved scope are cleared and relevant contracts pass verification. The integration layer registers the plugin without activating unfinished rules. Each rule-specific stack layer contains its cleanup and enables that rule as an error. Preserve existing lint scope and unrelated rules. Omit the Effect-specific plugin sources because this repository does not use Effect. Do not weaken an activated production rule, add production directory exemptions or introduce fabricated type evidence to bypass findings. Test files and test-only directories are exempt from `no-unknown-parameters` and `no-chained-type-assertions`: invalid-input fixtures, partial native mocks and historical data can require unknown inputs or chained assertions. Preserve substantive contract fixes; do not expand fixtures solely to eliminate these assertions. All other test lint rules retain their configured scope.

Place the copied plugin at `scripts/lint/anti-slop/`, retain its exact upstream revision and MIT notices, and keep `@oxlint/plugins` pinned to the exact Oxlint version. Upstream explicitly supports copying source and has no official npm package; its package exports uncompiled TypeScript, which Node does not strip inside `node_modules`. A Git dependency would require an extra compilation or loading mechanism. The initial integration keeps the supported local-source mechanism without the redundant outer vendor directory. The plugin's own third-party notices retain their upstream layout.

Inventory findings by rule and file, then clean bounded modules while preserving their observable contracts. Apply spacing fixes only within the selected batch and keep semantic review distinct from formatting. Replace unsafe types with actual domain evidence or existing schemas; retain field omission, callback ordering, proxy receiver semantics and test isolation. Do not disguise module mocking under aliases to evade the rule. Cleanup of all repository debt is an ongoing migration; the first implementation covers a tested initial batch and explicitly reports remaining findings. The Spec stays proposed until the full repository migration is complete.

The ai-core `AiPlugin.transformParams` contract changes from partial patches to complete parameters. Pass each returned value directly to the next plugin; the manager no longer implicitly merges or copies it. Migrate every repository plugin, document how external plugins preserve unchanged fields, and release the public API change as a breaking change. Plugins may return the received parameters unchanged. Omitted fields are removed rather than restored by a merge.

Literal parameter names, including `__proto__`, must remain own data properties on ordinary objects during parameter routing and DSML argument extraction. JSON Schema rewriting must also preserve literal property names and extension keys when removing unsupported keywords. Data-property construction avoids invoking prototype setters; regression coverage protects these contracts.

Plugin and skill Markdown metadata supports YAML and JSON frontmatter. Disable gray-matter's built-in JavaScript engine, including its `js` alias, so parsing metadata cannot execute code. This removes support for JavaScript frontmatter; affected files must migrate their metadata to YAML or JSON. Preserve the existing loose YAML recovery and metadata defaults.

## Alternatives considered

- Disable rules solely because existing code violates them: clear worthwhile rules before activation instead. Exclude `no-shape-in-symbol-names` for its low-value naming policy, not because of migration volume.
- Use an unofficial npm package or Git dependency: adds another release owner or a compilation mechanism rather than using upstream's supported installation.
- Rewrite the whole repository in one unreviewable change: boundary and test migrations need contract-specific verification.

## Acceptance criteria

- AC1 — Each rule is activated as an error only after its findings within the approved scope are cleared; real CLI probes verify the activation. The 17 selected generic rules and the native companion are active when migration is complete; `no-shape-in-symbol-names` remains explicitly off. (verification: unit)
- AC2 — The plugin loads from `scripts/lint/anti-slop/` with matching pinned dependencies, unchanged upstream generic production source, no unused Effect plugin, and retained license/provenance records. (verification: unit)
- AC3 — A bounded initial cleanup batch passes targeted lint and existing tests for its affected contracts; subsequent batches retain the same verification discipline. (verification: unit)
- AC4 — The remaining rule inventory and verification limits are reported accurately; documentation describes full adoption and the incomplete migration. (verification: docs gate)

- AC5 — `transformParams` requires complete parameters, all repository callers are migrated, and contract tests verify chaining and omitted-field removal. Package documentation and a major Changeset explain the breaking migration. (verification: unit)
- AC6 — Plugin and skill metadata parsing never evaluates JavaScript frontmatter or its aliases; YAML and JSON remain readable. Regression tests cover both entry points. (verification: unit)

## Risks

A rule cannot be activated while its existing violations remain. An unconfigured rule is pending migration, not proof that its source is clean. CLI probes must distinguish plugin availability from actual repository enforcement. Unknown-input restrictions, module mocks, reflection and type assertions require domain-specific changes rather than mechanical replacements. Spacing fixes can interact with formatting and need a second-pass stability check. AST and lexical-scope rules do not prove cross-file type safety or universal performance improvement. The initial batch does not claim full-repository validation or complete migration.
