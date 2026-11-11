# UI lint rules

`scroll-area.mjs` is the Oxlint JavaScript plugin for the shared ScrollArea padding contract.
It reports padding in `className` and `viewportProps.className` on recognized imports from
`@cherrystudio/ui`, the shared scroll-area module, or `SettingsContentColumn` from
`@renderer/components/SettingsPrimitives`. Content spacing belongs in
`contentProps.className`; ancestors may still have padding for intentionally inset scroll regions.
The primitive's internal scrollbar track padding is outside this consumer rule.

The rule handles named aliases, namespace imports, same-file const values, conditional classes,
known class helpers, literal templates, and viewport object spreads. It recognizes standard
Tailwind variants and arbitrary padding values. Arbitrary selector variants are skipped because
those can style descendants. It does not resolve re-export chains, unknown function results,
JSX prop spreads, inline styles, or runtime mutations. It reports without an automatic fix:
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
