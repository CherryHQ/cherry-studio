# Agent Note: Retire the ESLint execution path

Status: proposed

English | [中文](2026-10-27-eslint-retirement.zh.md)

## Problem

[Root scripts](../../../../package.json), workspace scripts, [Git hooks](../../../../.pre-commit-config.yaml), and [editor settings](../../../../.vscode/settings.json) still run or recommend ESLint alongside Oxlint. The two engines have different ignore sets, overrides, suppression names, and failure policies. Removing the ESLint command without migrating those contracts would silently drop checks.

At source baseline `9d8c53e4ab4c87ee13c0b8def9f97c4f5cfd921e`, resolving the local ESLint configuration across tracked JS/TS files found 8,937 eligible files, 25 distinct active rule/option sets, and 80 enabled rule names: 51 React rules and 29 other rules. These counts describe that revision and local environment, not a permanent rule inventory or proof of CI coverage.

The earlier [retirement PR](https://github.com/CherryHQ/cherry-studio/pull/17722) was closed without merging. Its [benchmark](https://github.com/CherryHQ/cherry-studio/pull/17722#issuecomment-5618465733) recorded a faster cold lint path but a 29% slower warm local median. Neither that measurement nor its rule mappings establishes current behavior.

An isolated macOS arm64 experiment used Oxlint 1.90.0 with the existing `@eslint-react/eslint-plugin` 1.53.1. All 51 enabled React rules had negative controls. A combined run on 14 fixture files produced the same 70 diagnostics as ESLint 9.39.5, including rule, file, position, message, and severity; positive fixtures had no diagnostics. Only plugin rule names were adapted. This does not verify other rules, autofixes, production file scope, other platforms, or performance. The implementation must turn the useful cases into repository-owned regression tests rather than depend on ignored experiment artifacts.

## Proposal

### Scope and ownership

Use Oxlint as the only repository lint execution engine. Retire root and workspace ESLint commands, `eslint.config.mjs`, ESLint-specific editor actions/recommendations, and the ESLint fix hook. Remove direct dependencies used only by the retired engine/configuration. Keep public lint command names, read-only versus fix behavior, explicit file arguments, and the existing validation planner/CI gate structure.

This is a partial successor to the dual-linter choice in [CI and local validation performance](2026-10-01-ci-and-local-validation.md). That note continues to own task selection, orchestration, concurrency, and CI observation. This migration does not change those policies, replace TypeScript with tsrs, remove independently used TS5/TS6 APIs, rewrite business behavior, or upgrade React rule semantics.

ESLint-compatible rule packages are allowed to remain as Oxlint plugins. An indirect `eslint` peer dependency is not an executable fallback: enumerate its dependency owner and distinguish it from direct dependencies and actual command execution. Zero packages containing `eslint` in their name is not an acceptance criterion.

### Rule migration

Use a root Oxlint configuration and repository-owned JS plugin modules under `scripts/lint/`. Keep the current React plugin pinned to 1.53.1 initially. Prefer existing compatible plugin implementations and verified native equivalents; preserve options, warning/error behavior, fixes, exceptions, and file scope. Port a local rule only when a native or compatible plugin implementation cannot preserve its contract. Do not copy historical PR implementations without comparing them with current sources.

Cover both current Oxlint rules and every effective ESLint rule/override, including files with zero current violations. Non-React coverage includes Hooks, unused imports, Zod imports, restricted syntax/imports/globals, renderer/shared/main/package and utility-process boundaries, seeder writes, path brands, lifecycle, transaction helpers, i18n, seven barrel rules, naming, schema keys, and highlighting boundaries. Preserve the transaction options for `ModelService` and `ProviderRegistryService`, explicit public-barrel imports, test exclusions, and dynamic page/barrel discovery.

Native rule names alone are insufficient evidence. In the experiment, `react/no-react-children` also prohibited the intentionally allowed `Children.toArray`, and native `react/no-clone-element` missed a dynamic-import case. React plugin 5.28.8 introduced a typed-parser requirement for `no-implicit-key`, removed some old rules, and changed class-component checks. Keep plugin upgrades separate from engine retirement.

### Failure policy and suppression migration

The existing root command runs Oxlint with `--deny-warnings`, then ESLint without a warning limit. Preserve that effective exit behavior: rules whose warnings currently block must remain blocking, while advisory ESLint warnings remain advisory. Express the existing blocking rules as errors before removing the global warning switch; include active default rules, not just explicitly configured ones. Preserve `CI` and `RENDERER_PAGE_SIBLING_ERROR` severity differences and test them in separate processes.

Migrate effective inline directives to their Oxlint rule IDs while preserving scope and justification. Test file-wide, next-line, block, multiple-rule, and intentional-exception cases. Leave historical prose, external examples, patch contents, and generated-owner inputs alone unless they are active execution inputs. Regenerate owned outputs when necessary instead of hand-editing them. Prevent silently ignored rule IDs or broadened suppressions.

### Integration and verification

Root commands, aiCore, UI, extension-table-plus, icon generation, the staged-file hook, and editor actions must reach the same maintained lint configuration with their existing file scopes and mutation intent. Update active developer instructions and affected bilingual references together. Preserve the current type-aware Oxlint rules and their supported runtime dependency; retiring ESLint does not imply retiring `oxlint-tsgolint`.

Build focused positive/negative fixtures against the production configuration, including outside-scope paths and overrides, rather than a separate test-only rule configuration. Add exit-status and safe-fix cases; checks must fail for real missed violations, false positives, or incorrect file selection. Compare baseline/candidate diagnostics by explicit rule mapping and review intentional location differences. Carry no unreviewed severity reductions or missing rules into the final layer.

Run local tests with explicit test file paths and scoped lint/format checks. Use the existing CI full lint gate for repository-wide coverage and run the focused plugin/CLI tests on Linux, macOS, and Windows. Configuration, plugin, package, lockfile, and fixture changes must select those tests. Measure equivalent baseline/candidate lint scopes in controlled cold and warm runs, reporting cache definitions, repetitions, versions, exit status, and side effects. Do not claim a speedup from the React fixture run; a material performance regression requires an explicit tradeoff decision before the final layer.

## Alternatives considered

- Keep the dual-engine command indefinitely: preserves compatibility but leaves duplicated execution and configuration; retain it only during migration.
- Replace all React rules with native rules immediately: rejected because current fixtures already expose changed coverage.
- Upgrade the React plugin together with Oxlint: rejected because it introduces separate typed-parser and semantic changes.
- Reimplement every plugin rule locally: rejected because it duplicates upstream maintenance and previously caused parity gaps.
- Require zero transitive ESLint/TypeScript packages: rejected for this scope; dependency/API retirement requires its own consumer evidence.

## Acceptance criteria

- AC1 — Every active baseline rule, option, default, environment-sensitive severity, file scope, and suppression has a maintained destination; positive/negative and outside-scope fixtures detect dropped or broadened coverage, including all 51 React rules and transaction-helper exceptions. (verification: lint migration owner; explicit scripts test files and reviewed diagnostic comparison)
- AC2 — Root/workspace lint, fix, icon generation, hooks, editor settings, and CI execute Oxlint without invoking ESLint; direct engine-only dependencies/configuration are removed and any transitive ESLint owner is documented. Read-only commands do not edit tracked sources, and fix commands preserve intended safe fixes and filename scope. (verification: integration owner; dependency audit, command/exit/fix tests, and tracked-file diff)
- AC3 — Blocking Oxlint warnings, advisory ESLint warnings, and local/CI overrides retain their effective exit behavior; renamed directives suppress only the intended rules and ranges. (verification: lint migration owner; isolated environment and suppression regression tests)
- AC4 — Focused tests pass on Linux, macOS, and Windows, and changes to any migration input select those tests; required CI gate names and validation orchestration remain intact. (verification: CI owner; planner fixtures and exact-head platform job results)
- AC5 — Comparable cold/warm baseline and candidate measurements report scope, cache state, versions, repetitions, failures, and side effects; any material regression has an explicit accepted tradeoff before completion. (verification: migration owner and reviewer; controlled benchmark report)
- AC6 — Active instructions and affected references describe the Oxlint-only execution path, bilingual pairs are current, and the final implementation layer maps every AC to actual evidence before moving this note to implemented. (verification: documentation owner; docs impact review, docs gate, and Agent Note transition check)

## Risks

JS plugin APIs remain alpha. A plugin loading successfully does not establish diagnostic or autofix parity. Alias resolution, dynamic directory discovery, ignore precedence, and environment-sensitive severities can lose enforcement without existing-code failures. JS plugins may reduce cold cost while regressing cached local work. Retained plugin peer dependencies and Compiler API consumers can keep legacy packages installed after ESLint execution is gone.

This Spec requires Approval on its exact head before implementation. If a rule cannot be preserved, keep the migration incomplete and bring the concrete behavior change back to this Spec; do not drop the rule to obtain a green gate.
