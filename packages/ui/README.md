# @cherrystudio/ui

Cherry Studio UI component library for React applications.

## ✨ Features

- 🎨 **Design System**: Full Cherry Studio design tokens with 17 color families, 11 shades, and semantic theme mappings
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
### Three Integration Modes

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
- ✅ Includes the extended radius scale (`rounded-4xs` through `rounded-3xl`, plus `rounded-round`)
- ⚠️ Overrides the default Tailwind theme contract for the imported app bundle

**Example:**

```tsx
<Button className="bg-primary text-red-500 p-4 rounded-lg">
  {/* bg-primary -> Cherry Studio brand color */}
  {/* text-red-500 -> Cherry Studio red-500 */}
  {/* p-4 -> Tailwind numeric spacing */}
  {/* rounded-lg -> semantic radius token */}
</Button>

<div className="rounded-4xs">Tiny radius (0.03125rem)</div>
<div className="rounded-xs">Small radius (0.125rem)</div>
<div className="rounded-md">Medium radius (0.5rem)</div>
<div className="rounded-xl">Large radius (0.875rem)</div>
<div className="rounded-round">Full radius (999px)</div>
```

#### Mode 2: Semantic CSS Contract

Import the official Shadcn and Cherry Studio product variables without installing Tailwind mappings.

```css
/* app.css */
@import '@cherrystudio/ui/styles/contract.css';
```

**Characteristics:**

- ✅ Exposes official variables such as `--background`, `--primary`, and `--sidebar`
- ✅ Exposes approved product variables such as `--cs-success` and `--cs-chat-user`
- ✅ Preserves the required foundation → Shadcn → product import order
- ✅ Works for CSS Modules, CSS-in-JS, and non-Tailwind consumers

#### Mode 3: Selective Foundation Consumption 🎯

Import only primitives and existing foundation providers, then decide which values your design system exposes.

```css
/* app.css */
@import 'tailwindcss';
@import '@cherrystudio/ui/styles/tokens.css';

/* Re-export only the parts you need */
@theme inline {
  --color-primary: var(--cs-primary); /* Use the Cherry Studio primary color */
  --color-red-500: oklch(...); /* Keep your own red scale */
  --radius-lg: 1rem; /* Keep your own radius */
}
```

**Characteristics:**

- ✅ Does not override the full Tailwind theme
- ✅ Gives access to Cherry Studio foundation values (`var(--cs-primary)`, `var(--cs-red-500)`)
- ✅ Lets you choose what to adopt and what to keep
- ✅ Works when you already own the semantic contract and only need selected Cherry Studio foundations
- ⚠️ Does not expose the complete Shadcn or Cherry Studio product contract

**Example:**

```tsx
{/* Use Cherry Studio tokens directly via CSS variables */}
<button style={{ backgroundColor: 'var(--cs-primary)' }}>
  Use the Cherry Studio brand color
</button>

{/* Keep your original Tailwind theme untouched */}
<div className="bg-red-500">
  Use the default Tailwind red
</div>

{/* Available CSS variables */}
<div
  style={{
    color: 'var(--cs-primary)', // Brand color
    backgroundColor: 'var(--cs-red-500)', // Red-500
    borderRadius: 'var(--cs-radius-lg)', // Radius
  }}
/>
```

### CSS Variable Rules

The normative v2 architecture, Shadcn contract, and migration boundary are defined in
[Design Token System](./docs/design-token-system.md). Official Shadcn variables remain unprefixed; approved
Cherry Studio product variables use `--cs-*`. Use the [Variable Catalog](./docs/variable-catalog.md) to select a
role and verify whether it is stable or migration-only.

To avoid mixing value sources, semantic variables, theme mappings, and runtime overrides, use these rules:

1. `--background`, `--primary`, `--muted-foreground`, and the other variables in `shadcn.css` are the official Shadcn contract
2. Approved Cherry Studio product semantics use `--cs-*`, such as `--cs-success` and `--cs-background-subtle`
3. Product variables marked `migration` are replacement targets only and must not be introduced in new code
4. Primitive and unclassified historical `--cs-*` variables remain internal value providers, not automatic public API
5. `--color-*`, `--radius-*`, and `--font-*` are Tailwind adapter output; prefer the resulting semantic utilities in components
6. `--cs-theme-*` is a controlled runtime input and must resolve into the semantic contract

Default consumption rules:

1. Regular application packages should depend on `@cherrystudio/ui/styles/theme.css` by default
2. Components should prefer semantic utilities such as `bg-background`, `text-muted-foreground`, and `bg-success`; custom CSS may use the matching official or product variable
3. Non-Tailwind consumers should depend on `@cherrystudio/ui/styles/contract.css`
4. Only design-system-adjacent packages that explicitly need foundation-level access should depend on `@cherrystudio/ui/styles/tokens.css`
5. Runtime theme logic should only write to controlled entry variables such as `--cs-theme-*`, not directly to derived `--color-*` variables

## Usage

### Basic Components

```tsx
import { Button, Input } from '@cherrystudio/ui'

function App() {
  return (
    <div>
      <Button variant="primary" size="md">Click me</Button>
      <Input
        type="text"
        placeholder="Type here"
        onChange={(value) => console.log(value)}
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
import { cn, formatFileSize } from '@cherrystudio/ui/utils'
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

# Validate variable ownership, layering, references, and cycles
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

- `variant`: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
- `size`: 'sm' | 'md' | 'lg'
- `loading`: boolean
- `fullWidth`: boolean
- `leftIcon` / `rightIcon`: React.ReactNode

### Input

An input component with error handling and password visibility support.

**Props:**

- `type`: 'text' | 'password' | 'email' | 'number'
- `error`: boolean
- `errorMessage`: string
- `onChange`: (value: string) => void

## Hooks

### useDebounce

Debounces state updates or callback execution.

### useLocalStorage

React hook wrapper for local storage.

### useClickOutside

Detects clicks outside an element.

### useCopyToClipboard

Copies text to the clipboard.

## Utilities

### cn(...inputs)

Class name merge helper built on top of `clsx`.

### formatFileSize(bytes)

Formats byte sizes into readable strings.

### debounce(func, delay)

Debounce helper.

### throttle(func, delay)

Throttle helper.

## License

MIT
