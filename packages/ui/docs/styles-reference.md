# Styles Reference

This document is a lightweight index for the active style sources used by `@cherrystudio/ui`.

The v2 architecture and migration contract are defined in
[design-token-system.md](./design-token-system.md). Official Shadcn and approved Cherry Studio product semantics
share the unprefixed public namespace. The full theme entry exposes both through Tailwind utilities.

For variable selection, intended CSS properties, stability, and AI rules, use
[variable-catalog.md](./variable-catalog.md).

## Source Files

Runtime styles and design tokens live under `src/styles`:

- [theme.css](../src/styles/theme.css)
- [contract.css](../src/styles/contract.css) (internal composition layer; not a package export)
- [theme-input.css](../src/styles/theme-input.css) (internal runtime-input layer composed by `contract.css`)
- [shadcn.css](../src/styles/shadcn.css)
- [product.css](../src/styles/product.css)
- [tokens.css](../src/styles/tokens.css)
- [tokens/colors/primitive.css](../src/styles/tokens/colors/primitive.css)
- [tokens/colors/status-legacy.css](../src/styles/tokens/colors/status-legacy.css) (frozen legacy status palette; shrink-only)
- [tokens/colors/providers.css](../src/styles/tokens/colors/providers.css) (semantic `--cs-*` value providers)
- [tokens/radius.css](../src/styles/tokens/radius.css)
- [tokens/spacing.css](../src/styles/tokens/spacing.css)
- [tokens/typography.css](../src/styles/tokens/typography.css)
- [migrations/shadcn-v2.json](../src/styles/migrations/shadcn-v2.json)

## Usage Notes

Do not consume files from `packages/ui/docs` at runtime.

- Use the exported `@cherrystudio/ui/styles/theme.css` or `@cherrystudio/ui/styles/tokens.css` entries for app and
  package integration.
- Treat this document as reference only, not as part of the public runtime contract.
- If you need to inspect shipped style outputs, check `dist/styles/` instead.
