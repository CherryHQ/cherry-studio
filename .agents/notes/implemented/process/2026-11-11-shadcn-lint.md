# Agent Note: Shadcn design-system lint integration

Status: implemented

English | [中文](2026-11-11-shadcn-lint.zh.md)

## Problem

The existing lint pipeline does not check Tailwind class validity or undeclared color tokens. Automatic theme discovery at the repository root selects the file-preview stylesheet instead of the renderer entry.

## Decision

Register `@shadcn/lint` in the existing Oxlint configuration for TypeScript in the renderer, shared UI source, and file-preview source. Keep `no-raw-colors` and `no-unknown-classes` explicitly disabled for incremental cleanup before enforcement. Oxlint is pinned to 1.80.0, the plugin minimum. If re-enabled as warnings, the existing `--deny-warnings` command will make these findings block CI. ESLint does not register the plugin, avoiding duplicate diagnostics.

The root `components.json` names the renderer Tailwind entry. Shared component imports use `@cherrystudio/ui`. The UI package retains its own configuration; the plugin uses its Storybook Tailwind entry for class validation because its theme-only stylesheet does not import Tailwind.

The shared ScrollArea contract assigns padding to content rather than root or viewport. The local `cherry-scroll-area/no-container-padding` rule checks both explicit class sites, including the imported `SettingsContentColumn` wrapper; its static-analysis limits are documented in `scripts/lint/README.md`. Existing detected callers move their spacing to content. Session Details keeps nested scroll regions, separates summary spacing from resource lists, and reserves a 12px outer track lane.

## Alternatives considered

- Keep the plugin in ESLint: compatible, but the selected integration consolidates these checks in Oxlint.
- Enable every rule as an error: component overrides, inline dynamic dimensions, and arbitrary values need separate contract review. They are not enabled here.

## Consequences

Use `pnpm exec oxlint --deny-warnings <changed-files>` for scoped checks. Rule severity and import recognition live in `.oxlintrc.json`. The ScrollArea rule blocks CI; the two shadcn rules are currently off. Existing declared primitive palette tokens remain declared tokens; this integration does not enforce semantic-color-only usage or detect visual layout mistakes such as scrollbar placement.

## Verification

The shadcn positive and negative probes below were run with the rules enabled before the final decision to disable them. They demonstrate compatibility, not current enforcement. The padding rule remains enabled.

- Regression — Oxlint CLI probes in all three scopes accepted `flex p-3 bg-card text-muted-foreground rounded-xl` and reported both `flex-cols` and `bg-not-a-real-token` under the expected rules with exit code 1. The same invalid fixture outside the UI scopes produced no diagnostics.
- Regression — scoped Oxlint with `--deny-warnings` on the agent context summary, session details layout, and shared scroll area passed. Full-repository lint is left to CI; existing violations outside these files have not been audited.

- Regression — `pnpm test:scripts scripts/lint/__tests__/scroll-area.test.ts`: padding diagnostics, aliases, variants, viewport props, content/ancestor exceptions, and unrelated or shadowed components.
- Regression — Electron with production Session Details components and synthetic long resource lists: unpadded viewports, 12px separate track lanes, 12px clearance after numbers, and wheel chaining from the inner bottom to the outer viewport. Both themes were captured.

The changed-file Oxlint gate passes after exact exceptions for existing CSS/DOM marker classes and replacement of undeclared foreground utilities with semantic tokens. Negative CLI probes still reject container padding, unknown utilities, and undeclared colors. Web typechecking reports errors in unchanged Markdown files. The new ScrollArea rule passes across the existing ScrollArea consumers; these results do not claim the full CI gate is green.

Layout regression checks measure resource grid columns against the card content width. Settings wrappers keep their original 32px top content spacing with an unpadded root. Normal file previews grow with long content and stretch short content; internally scrolling previews retain a fixed height. Electron measurements verify the full 80px bottom inset for long content.
