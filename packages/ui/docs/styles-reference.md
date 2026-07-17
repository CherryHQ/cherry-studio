# Styles Reference

This document is a lightweight index for the active style sources used by `@cherrystudio/ui`.

The v2 architecture and migration contract are defined in
[design-token-system.md](./design-token-system.md). Existing `--cs-*` files remain the temporary value provider;
new shared UI targets the canonical Shadcn variables exposed by the full theme entry.

## Source Files

Runtime styles and design tokens live under `src/styles`:

- [theme.css](../src/styles/theme.css)
- [shadcn.css](../src/styles/shadcn.css)
- [tokens.css](../src/styles/tokens.css)
- [tokens/colors/primitive.css](../src/styles/tokens/colors/primitive.css)
- [tokens/colors/semantic.css](../src/styles/tokens/colors/semantic.css)
- [tokens/colors/status.css](../src/styles/tokens/colors/status.css)
- [tokens/radius.css](../src/styles/tokens/radius.css)
- [tokens/typography.css](../src/styles/tokens/typography.css)
- [migrations/shadcn-v2.json](../src/styles/migrations/shadcn-v2.json)

## Usage Notes

Do not consume files from `packages/ui/docs` at runtime.

- Use `@cherrystudio/ui/styles/theme.css` or `@cherrystudio/ui/styles/tokens.css` for app and package integration.
- Treat this document as reference only, not as part of the public runtime contract.
- If you need to inspect shipped style outputs, check `dist/styles/` instead.
