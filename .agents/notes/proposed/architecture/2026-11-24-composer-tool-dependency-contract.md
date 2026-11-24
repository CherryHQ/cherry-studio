# Agent Note: Composer tool dependency contracts

Status: proposed

English | [中文](2026-11-24-composer-tool-dependency-contract.zh.md)

## Problem

`defineTool` relates each tool's dependency tuples to its callbacks, but the heterogeneous registry erases those tuples. `ComposerToolRuntime` then builds subsets and asserts that they contain every state/action key. A generic helper invoked after erasure cannot recover that association. Its model assertion also hides legitimate model-free reconciliation.

The current readable-key classifier includes the internal `toolsRegistry` and `triggers` objects in `ToolStateMap`, although provider state does not contain them. Existing built-ins do not request those keys; their declared dependencies are complete.

## Proposal

Derive public state and actions from their actual provider owners, excluding expansion and registry internals. Default dependency tuples to empty; require the corresponding declaration for a nonempty tuple.

While `defineTool` still retains each tuple, bind dependency projection and contribution invocation in closures. Use the existing library `pick` to preserve declared values and references. The registry stores common metadata and prepared runtime/reconciliation entry points. Within this injection bridge, only the internal source contains complete provider state/actions; each contribution receives its declared subset. Existing provider hooks and exports retain their complete interfaces.

Prepare menu and runtime together so they share one context. Render the original React component through `createElement`, retaining component identity and hooks. Keep launcher caching, declared-dependency memo comparison and registration cleanup. Host selection remains scope → condition → model eligibility; condition can receive an absent model. Reconciliation keeps a stable callback that reads the latest source and selects tools only by scope; it does not use the Host's condition/model mounting gates. Assistant, model and session remain genuinely optional.

This preserves the decisions in [token restoration](../../implemented/bug-fix/2026-11-03-composer-token-restore.md) and [deferred intent replay](../../implemented/bug-fix/2026-11-07-composer-deferred-intent-replay.md); it does not supersede either note. No toolbar, permission, clipboard or token wire format changes are proposed.

## Alternatives considered

- Add a generic helper after registry erasure: its caller still supplies erased tuples and falsely promises a complete context.
- Make all context fields optional or expose the complete provider: the former loses required dependency types; the latter weakens declared-subset isolation and exposes internal APIs.
- Retain the full-context assertions with comments: that leaves the incorrect state-key classifier and unproved registry association in place.

## Acceptance criteria

- AC1 — Typed tools retain exact declared state/action fields; undeclared or internal fields, missing nonempty dependency declarations and unprepared registry definitions are rejected by renderer typecheck contracts. (verification: renderer; owner: Composer runtime)
- AC2 — Heterogeneous tools receive their own declared values and original references; a tool's menu and runtime share one projected context without exposing the complete provider. (verification: renderer; owner: Composer runtime)
- AC3 — Runtime mounting preserves scope, condition and model eligibility behavior, forwarding absent Assistant/model and Session data without fabricated placeholders. (verification: renderer; owner: Composer runtime)
- AC4 — Attachment and knowledge reconciliation reads current provider state, works without a model and ignores condition/model mounting gates while retaining scope visibility. (verification: renderer; owner: Composer runtime)
- AC5 — Launcher updates and cleanup preserve registration ownership, and mounted runtime hook state survives dependency updates without unrelated state causing a remount. (verification: renderer; owner: Composer runtime)

## Risks

Raw test definitions must use the factory so they exercise the same registration contract. New closures must not create a new React component type per update or invoke hook components as ordinary functions. Broad source spreading or shared Host/reconciliation filtering would change existing behavior.

Type contracts and renderer regressions are verified by remote CI under the current migration workflow. This proposed note does not claim executed tests, successful CI, a real Electron interaction check or completion of the wider assertion migration.
