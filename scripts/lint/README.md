# UI lint rules

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
