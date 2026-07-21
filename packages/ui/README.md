# @cherrystudio/ui

Cherry Studio UI component library for React applications.

## ✨ Features

- 🎨 **Design System**: Cherry Studio primitive palettes, product semantics, and Shadcn-compatible theme mappings
- 🌓 **Dark Mode**: Built-in light and dark theme support
- 🚀 **Tailwind v4**: Built on top of the latest Tailwind CSS v4
- 📦 **Flexible Imports**: Two style integration modes for different adoption paths
- 🔷 **TypeScript**: Complete type definitions and editor support
- 🎯 **Low Collision**: CSS variable isolation without taking over app runtime state by default

---

## 🚀 Quick Start

### Install

```bash
npm install @cherrystudio/ui
# peer dependencies
npm install motion react react-dom tailwindcss
```

> The recommended integration style in this repository is to use the package export entry points:
> `@cherrystudio/ui`
> `@cherrystudio/ui/components`
> `@cherrystudio/ui/icons`
> `@cherrystudio/ui/utils`
> `@cherrystudio/ui/styles/tokens.css`
> `@cherrystudio/ui/styles/theme.css`
>
### Two Integration Modes

#### Mode 1: Full Theme Contract ✨

Use the full Cherry Studio design system so Tailwind theme tokens resolve to Cherry Studio values.

```css
/* app.css */
@import '@cherrystudio/ui/styles/theme.css';
```

**Characteristics:**

- ✅ Use standard Tailwind utility names directly (`bg-primary`, `bg-red-500`, `p-4`, `rounded-lg`)
- ✅ Colors resolve to Cherry Studio design values
- ✅ Uses Tailwind's standard numeric spacing scale
- ✅ Includes Shadcn-derived radii through `rounded-4xl` plus `rounded-full`; smaller Cherry aliases remain available for compatibility
- ⚠️ Overrides the default Tailwind theme contract for the imported app bundle

**Example:**

```tsx
<Button className="bg-primary text-red-500 p-4 rounded-lg">
  {/* bg-primary -> the current primary action semantic */}
  {/* text-red-500 -> Cherry Studio red-500 */}
  {/* p-4 -> Tailwind numeric spacing */}
  {/* rounded-lg -> semantic radius token */}
</Button>

<div className="rounded-4xs">Tiny radius (0.03125rem)</div>
<div className="rounded-xs">Small radius (0.125rem)</div>
<div className="rounded-md">Medium radius (0.5rem)</div>
<div className="rounded-xl">Large radius (0.875rem)</div>
<div className="rounded-full">Full radius (9999px)</div>
```

#### Mode 2: Selective Foundation Consumption 🎯

Import only primitives and existing foundation providers, then decide which values your design system exposes.

```css
/* app.css */
@import 'tailwindcss';
@import '@cherrystudio/ui/styles/tokens.css';

/* Re-export only the parts you need */
@theme inline {
  --color-primary: var(--cs-brand-500); /* Adopt a Cherry Studio foundation value */
  --color-red-500: oklch(...); /* Keep your own red scale */
  --radius-lg: 1rem; /* Keep your own radius */
}
```

**Characteristics:**

- ✅ Does not override the full Tailwind theme
- ✅ Gives access to Cherry Studio foundation values (`var(--cs-brand-500)`, `var(--cs-red-500)`)
- ✅ Lets you choose what to adopt and what to keep
- ✅ Works when you already own the semantic contract and only need selected Cherry Studio foundations
- ⚠️ Does not expose the complete Shadcn or Cherry Studio product contract

**Example:**

```tsx
{/* Use Cherry Studio tokens directly via CSS variables */}
<button style={{ backgroundColor: 'var(--cs-brand-500)' }}>
  Use the Cherry Studio brand color
</button>

{/* Keep your original Tailwind theme untouched */}
<div className="bg-red-500">
  Use the default Tailwind red
</div>

{/* Available CSS variables */}
<div
  style={{
    color: 'var(--cs-brand-500)', // Brand foundation value
    backgroundColor: 'var(--cs-red-500)', // Red-500
    borderRadius: 'var(--cs-radius-lg)', // Radius
  }}
/>
```

`src/styles/contract.css` is an internal composition layer used by the generated `theme.css` entry to preserve the
foundation → runtime input → Shadcn → product import order. It is not a public package export or a supported
consumer entry point.

### CSS Variable Rules

The normative v2 architecture, Shadcn contract, and migration boundary are defined in
[Design Token System](./docs/design-token-system.md). Official Shadcn variables remain unprefixed; approved
Cherry Studio product variables extend the same unprefixed public namespace. Use the
[Variable Catalog](./docs/variable-catalog.md) to select a stable role and distinguish runtime API from internal
providers and tooling-only historical names.

To avoid mixing value sources, semantic variables, theme mappings, and runtime overrides, use these rules:

1. `--background`, `--primary`, `--muted-foreground`, and the other variables in `shadcn.css` are the official Shadcn contract
2. Approved Cherry Studio product semantics are also unprefixed, such as `--success` and `--background-subtle`
3. Historical migration names are tooling-only and must not be recreated as runtime product variables
4. Shared `--cs-*` variables are internal value providers; `--cs-theme-*` is the reserved host-written input subset
5. `--color-*`, `--radius-*`, and `--font-*` are Tailwind adapter output; only the adapter owner declares `--color-*` inside `@theme`, while component, page, and other runtime CSS must neither declare nor consume it
6. `--cs-theme-*` is a controlled host-written input, not a component-facing semantic role or Tailwind utility
7. Component-, page-, and Electron-shell variables stay in their owning stylesheet and are not added to the shared contract merely because they are CSS custom properties

Default consumption rules:

1. Regular application packages should depend on `@cherrystudio/ui/styles/theme.css` by default
2. Components should prefer semantic utilities such as `bg-background`, `text-muted-foreground`, and `bg-success`; custom CSS may use the matching official or product variable
3. Only design-system-adjacent packages that explicitly need foundation-level access should depend on `@cherrystudio/ui/styles/tokens.css`
4. Runtime theme logic should only write to registered inputs such as `--cs-theme-*`, not directly to official semantics or derived `--color-*` variables

### Shadcn CLI Ownership

Use the Shadcn CLI to scaffold or update component source and dependency metadata only. Cherry Studio's authored
theme layers and generator own the shared CSS contract, even though `components.json` points the CLI at the generated
`src/styles/theme.css` entry.

- Do not retain direct CLI edits to `src/styles/theme.css`; `pnpm theme:build` is its only writer.
- Review any CSS proposed by `shadcn add` and place it according to ownership: official semantics in `shadcn.css`,
  Cherry Studio product semantics in `product.css` and `theme-contract.ts`, and component-local styles with the
  component.
- Add Tailwind mappings through the theme generator rather than by hand-editing its output.
- Run `pnpm theme:build` followed by `pnpm theme:check` after accepting a component that changes theme requirements.

## Usage

### Basic Components

```tsx
import { Button, Input } from '@cherrystudio/ui'

function App() {
  return (
    <div>
      <Button variant="default" size="default">Click me</Button>
      <Input
        type="text"
        placeholder="Type here"
        onChange={(event) => console.log(event.currentTarget.value)}
      />
    </div>
  )
}
```

### Modular Imports

```tsx
// Components only
import { Button } from '@cherrystudio/ui/components'

// Utilities only
import { DIALOG_CLOSE_DURATION_MS, toUndefinedIfNull } from '@cherrystudio/ui/utils'
```

## Development

```bash
# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build
pnpm build

# Type check
pnpm type:check

# Validate the variable graph, generated adapter, registry, and renderer authored-CSS boundary
pnpm theme:check

# Run tests
pnpm test
```

### Icon Generation

Use the package command for all icon generation so ESLint fixes and the repository formatter run after the generated files are updated.

In this command, `--type=icons` means general UI icons that are not Provider or Model logos.

```bash
# Generate general icons, Providers, and Models
pnpm icons:generate

# General icons
pnpm icons:generate --type=icons

# Provider icons, Avatars, barrels, and catalogs
pnpm icons:generate --type=providers

# Model icons, Avatars, barrels, and catalogs
pnpm icons:generate --type=models
```

| Type        | SVG source                            | Generated output                                                                 |
| ----------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `icons`     | `icons/general/*.svg`                 | General React icon components and their barrel                                   |
| `providers` | `icons/providers/{light,dark}/*.svg` | Provider light/dark components, metadata, Avatars, barrels, and catalogs          |
| `models`    | `icons/models/{light,dark}/*.svg`    | Model light/dark components, metadata, Avatars, barrels, and catalogs             |

Generation uses a hash cache and skips unchanged SVG files. Use the optional arguments when a narrower or clean regeneration is needed:

```bash
# Regenerate one provider and its Avatar/catalog entries
pnpm icons:generate --type=providers --only=opencode

# Regenerate multiple models
pnpm icons:generate --type=models --only=claude,gemini

# Ignore the hash cache and regenerate every provider
pnpm icons:generate --type=providers --force
```

- Omitting `--type` generates all three groups in order: `icons`, `providers`, then `models`.
- `--type=icons|providers|models` limits generation to one source and output group.
- `--only=<name[,name]>` limits Provider or Model component and Avatar generation to the listed names.
- `--force` bypasses the SVG hash cache.

Provider and Model generation runs the SVG component stage first and the Avatar/catalog stage second. The `posticons:generate` lifecycle script fixes the generated icon files with ESLint, then runs the repository formatter once after both stages complete. Internal scripts under `scripts/` are still available for pipeline development, but normal usage should go through `pnpm icons:generate`.

## Package Surface

The `packages/ui` workspace contains both runtime code and development-only assets.

- Runtime surface:
  - `src/`
  - `dist/` build output
  - package export entry points declared in `package.json`
- Development assets:
  - `stories/` and `.storybook/`
  - `scripts/` used for icon and theme generation
  - `icons/` source assets used by the generation pipeline
  - `docs/` for migration and reference material

Only the runtime surface should be treated as consumable package API.

## Directory Structure

```text
docs/                    # Migration plans and reference docs
src/
├── components/
│   ├── primitives/     # Primitive components
│   ├── composites/     # Composite components
│   ├── icons/          # Icon runtime exports and catalogs
│   └── index.ts
├── hooks/              # React Hooks
├── lib/                # Internal utilities
├── styles/             # Tokens and theme entry files
├── utils/              # Utility functions
└── index.ts            # Main runtime entry point
scripts/                # Theme and icon generation tooling
stories/                # Storybook stories and sandbox usage
icons/                  # Raw icon assets for code generation
```

## Naming Conventions

All file and directory names under `packages/ui/` follow **kebab-case** (per shadcn CLI convention and project-wide rule §4.5 in [`../../docs/references/naming-conventions.md`](../../docs/references/naming-conventions.md)). This covers `primitives/`, `composites/`, `icons/`, `hooks/`, and `stories/` alike. Exported identifiers inside files remain `PascalCase` for components and `camelCase` for utilities and hooks.

Examples:

- `button.tsx` exports `Button`
- `data-table.tsx` exports `DataTable`
- `error-boundary/index.tsx` exports `ErrorBoundary`
- `use-dnd-reorder.ts` exports `useDndReorder`

## Components

### Button

A button component with multiple variants and sizes.

**Props:**

- `variant`: `default` | `destructive` | `outline` | `secondary` | `emphasis` | `ghost` | `link`
- `size`: `default` | `sm` | `lg` | `icon` | `icon-sm` | `icon-lg` | `icon-navbar`
- `loading`, `loadingIcon`, `loadingIconClassName`: loading-state controls
- `asChild`: render through Radix `Slot`
- all standard React button props

### Input

The Shadcn-compatible native input primitive.

**Props:**

- accepts standard React input props, including native `type`, `value`, and event-based `onChange`
- use `aria-invalid` for invalid-state styling
- use `className` for supported layout composition

## Hooks

### useDndReorder

Keeps drag reordering correct when the rendered list is a filtered subset of the source list.

### useDndState

Reads the active and hovered identifiers from the current dnd-kit context.

## Utilities

### toUndefinedIfNull(value)

Converts `null` to `undefined` at API boundaries.

### toNullIfUndefined(value)

Converts `undefined` to `null` at API boundaries.

### DIALOG_CLOSE_DURATION_MS

Shared duration for coordinating work with the Dialog close animation.

## License

MIT
