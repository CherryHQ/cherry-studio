# Lint rules

## Anti-slop

The local [anti-slop plugin](anti-slop/UPSTREAM.md) runs in the existing Oxlint
gate, including CI and `lint:fix`. All 18 generic rules and native
`oxc/no-accumulating-spread` are available. `.oxlintrc.json` activates a rule as an
error only after its repository findings are cleared and its contracts verified.
`oxlint` and `@oxlint/plugins` must stay pinned to the same exact version.

Upstream has no official npm package and supports copying its source. The plugin
lives directly under `scripts/lint/anti-slop/`; its source, licenses and provenance
are preserved. Repository lint, formatting and application typechecking exclude
this upstream copy. Its generic entry point can be typechecked separately
with TypeScript import extensions enabled. Effect-specific sources are omitted
because this repository does not use Effect.

`no-shape-in-symbol-names` is deliberately disabled, not pending cleanup. Its
substring ban rejects legitimate geometry, schema and persisted contract names;
restricting only bare `Shape` declarations would still enforce a naming preference
without establishing a better type contract. Keep the upstream implementation
available without a local fork. The enforcement target is the other 17 generic
rules and the native companion.

Unconfigured rules are pending migration, not proof that their source is clean.
Each rule-specific stack layer clears that rule's findings, verifies affected
contracts, and enables it as an error. Do not weaken an activated rule, exempt owned
source directories or disguise module mocks to make it pass. Test files and test-only
directories temporarily disable all anti-slop rules and the native
`oxc/no-accumulating-spread` companion, including the dedicated `scripts/e2e/` and
`scripts/utility-process-smoke/` harnesses. Partial mocks, invalid inputs and historical
fixtures have different constraints from production inputs; keep substantive contract
fixes without expanding fixtures just to satisfy this migration. Other test lint
rules retain their scope. Production activation continues rule by rule. Boundary parsing,
reflection, assertions and test dependencies need contract-specific migration;
replacing omitted fields with `undefined` or changing callback order is not a safe
mechanical cleanup. The [migration Spec](../../.agents/notes/proposed/process/2026-11-18-anti-slop-lint.md)
defines the target and incremental acceptance criteria.

For a migration inventory, copy the complete root configuration and override only
the selected rule. An extending diagnostic configuration does not preserve the
root `ignorePatterns`. Keep generated configurations at the repository root for
relative plugin paths, and record the exact probe commit and effective scope.

Run `pnpm test:scripts scripts/lint/__tests__/anti-slop.test.ts` to verify every
available rule using a focused configuration extending the repository config.
Rule-specific layers also add probes of actual repository enforcement. Use
`pnpm exec oxlint --deny-warnings <changed-files>` for a cleanup batch. Run spacing
autofix only on that batch, then the formatter, and confirm a second pass is stable.
Existing consumer tests must still pass; lint alone does not prove behavior.

These AST/scope rules do not perform cross-file TypeScript type analysis, establish
accumulator ownership or prove that all quadratic work is absent.

## Structured cloning

The built-in Oxlint rules `no-restricted-globals` and `no-restricted-properties`
reject `structuredClone`, including static access and destructuring through
`globalThis`, `window`, `self`, and `global`. The restriction also applies to tests
within the existing lint scope. It does not resolve global-object aliases or dynamic
property names; this is a code-review guardrail, not a security boundary.

Prefer explicit construction or structural sharing. Do not mechanically replace a
deep copy with another deep-copy helper or JSON serialization. When isolation or
transfer semantics require this API, suppress only the specific call and explain
the preserved boundary, expected frequency and data size. Remaining
exceptions preserve explicit isolation or transfer boundaries; they do not certify
that the copy is inexpensive. Streaming paths must select changed data before copying.

```ts
// oxlint-disable-next-line no-restricted-globals -- Capture the small form once per save while editing continues.
const submitted = structuredClone(form.getValues())
```

Qualified access uses `no-restricted-properties` in the suppression instead.
Reasons are required by review convention; the built-in rules do not validate
comment descriptions. Avoid file-wide or directory-wide exceptions.

Run `pnpm test:scripts scripts/lint/__tests__/structured-clone.test.ts` to check
the actual repository configuration against rejected accesses, single-line
exceptions and unrelated local identifiers.

## UI rules

`scroll-area.mjs` is the Oxlint JavaScript plugin for the shared ScrollArea padding contract.
It reports padding in `className` and `viewportProps.className` on recognized imports from
`@cherrystudio/ui`, the shared scroll-area module, or `SettingsContentColumn` from
`@renderer/components/SettingsPrimitives`. Content spacing belongs in
`contentProps.className`; ancestors may still have padding for intentionally inset scroll regions.
The primitive's internal scrollbar track padding is outside this consumer rule.

The same rule checks `DynamicVirtualList`, `GroupedVirtualList`, and
`GroupedSortableVirtualList` from `@renderer/components/VirtualList` or their direct modules.
Their `className` and `scrollerStyle` target the viewport; `scrollAreaClassName` targets
the root. Content spacing uses `contentProps`, which also accounts for the list's offset
when navigating to an item. An explicit `externalScrollElement` delegates the scroll
boundary to its host and is exempt from the wrapper check.

The rule handles named aliases, namespace imports, same-file const values, conditional classes,
known class helpers, literal templates, and resolvable prop/object spreads. It recognizes standard
Tailwind variants, arbitrary padding values/properties, and explicit inline padding styles.
Arbitrary selector variants are skipped because those can style descendants. It does not resolve
re-export chains, imported class maps, unknown function results, or runtime mutations.
It cannot decide whether an ancestor's inset is intentional. It reports without an automatic fix:
class movement can affect nested layouts, virtual lists, and scroll anchoring.

Run the rule tests with `pnpm test:scripts scripts/lint/__tests__/scroll-area.test.ts`.
Use `pnpm exec oxlint --deny-warnings <changed-files>` for integration checks.

The shadcn plugin is installed, but `no-raw-colors` and `no-unknown-classes` are
currently disabled while existing callers are audited incrementally. The ScrollArea
padding rule remains an error. Re-enabling shadcn warnings will block CI under
`--deny-warnings`. Exact class exceptions retained in
`.oxlintrc.json` cover existing global CSS and DOM hooks; they do not allow arbitrary
Tailwind utilities. `outline-dot` and `outline-text` are descendant selector hooks,
not raw outline colors. Undefined color utilities must use the semantic tokens in DESIGN.md.
