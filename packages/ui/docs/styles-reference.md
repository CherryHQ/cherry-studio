# Styles Reference

This document is a lightweight index for the active style sources used by `@cherrystudio/ui`.

## Source Files

Runtime styles and design tokens live under `src/styles`:

- [theme.css](../src/styles/theme.css)
- [tokens.css](../src/styles/tokens.css)
- [tokens/colors/primitive.css](../src/styles/tokens/colors/primitive.css)
- [tokens/colors/theme-input.css](../src/styles/tokens/colors/theme-input.css)
- [tokens/colors/semantic.css](../src/styles/tokens/colors/semantic.css)
- [tokens/colors/status.css](../src/styles/tokens/colors/status.css)
- [tokens/colors/component.css](../src/styles/tokens/colors/component.css)
- [tokens/iconography.css](../src/styles/tokens/iconography.css)
- [tokens/radius.css](../src/styles/tokens/radius.css)
- [tokens/spacing.css](../src/styles/tokens/spacing.css)
- [tokens/typography.css](../src/styles/tokens/typography.css)

## Usage Notes

Do not consume files from `packages/ui/docs` at runtime.

- Use `@cherrystudio/ui/styles/*` for all actual app and package integration.
- Treat this document as reference only, not as part of the public runtime contract.
- If you need to inspect shipped style outputs, check `dist/styles/` instead.
