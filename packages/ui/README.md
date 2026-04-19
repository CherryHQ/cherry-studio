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
npm install framer-motion react react-dom tailwindcss
```

> The recommended integration style in this repository is to use the package export entry points:
> `@cherrystudio/ui`
> `@cherrystudio/ui/components`
> `@cherrystudio/ui/icons`
> `@cherrystudio/ui/utils`
> `@cherrystudio/ui/styles/*`
>
### Two Integration Modes

#### Mode 1: Full Theme Contract ✨

Use the full Cherry Studio design system so Tailwind theme tokens resolve to Cherry Studio values.

```css
/* app.css */
@import '@cherrystudio/ui/styles/theme.css';
```

**Characteristics:**

- ✅ Use standard Tailwind utility names directly (`bg-primary`, `bg-red-500`, `p-md`, `rounded-lg`)
- ✅ Colors resolve to Cherry Studio design values
- ✅ Includes the extended spacing scale (`p-5xs` through `p-8xl`, 16 semantic sizes)
- ✅ Includes the extended radius scale (`rounded-4xs` through `rounded-3xl`, plus `rounded-round`)
- ⚠️ Overrides the default Tailwind theme contract for the imported app bundle

**Example:**

```tsx
<Button className="bg-primary text-red-500 p-md rounded-lg">
  {/* bg-primary -> Cherry Studio brand color */}
  {/* text-red-500 -> Cherry Studio red-500 */}
  {/* p-md -> semantic spacing token */}
  {/* rounded-lg -> semantic radius token */}
</Button>

{/* Extended utility classes */}
<div className="p-5xs">Tiny spacing (0.5rem)</div>
<div className="p-xs">Extra small spacing (1rem)</div>
<div className="p-sm">Small spacing (1.5rem)</div>
<div className="p-md">Medium spacing (2.5rem)</div>
<div className="p-lg">Large spacing (3.5rem)</div>
<div className="p-xl">Extra large spacing (5rem)</div>
<div className="p-8xl">Maximum spacing (15rem)</div>

<div className="rounded-4xs">Tiny radius (0.25rem)</div>
<div className="rounded-xs">Small radius (1rem)</div>
<div className="rounded-md">Medium radius (2rem)</div>
<div className="rounded-xl">Large radius (3rem)</div>
<div className="rounded-round">Full radius (999px)</div>
```

#### Mode 2: Selective Token Consumption 🎯

Import only the design tokens and decide which theme mappings your app wants to expose.

```css
/* app.css */
@import 'tailwindcss';
@import '@cherrystudio/ui/styles/tokens.css';

/* Re-export only the parts you need */
@theme {
  --color-primary: var(--cs-primary); /* Use the Cherry Studio primary color */
  --color-red-500: oklch(...); /* Keep your own red scale */
  --spacing-md: var(--cs-size-md); /* Reuse Cherry Studio spacing */
  --radius-lg: 1rem; /* Keep your own radius */
}
```

**Characteristics:**

- ✅ Does not override the full Tailwind theme
- ✅ Gives access to all Cherry Studio design tokens through CSS variables (`var(--cs-primary)`, `var(--cs-red-500)`)
- ✅ Lets you choose what to adopt and what to keep
- ✅ Works well when you already have a design system and only want selected Cherry Studio tokens

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
    padding: 'var(--cs-size-md)', // Spacing
    borderRadius: 'var(--cs-radius-lg)', // Radius
  }}
/>
```

### CSS Variable Rules

To avoid mixing tokens, theme mappings, and runtime overrides, use the following rules:

1. `--cs-*` is the design token namespace, sourced from `tokens/*`
2. `--color-*`, `--radius-*`, and `--font-*` are public theme contracts and should be the default choice for components and external consumers
3. `--cs-theme-*` is a runtime override input and should only be used for controlled runtime overrides
4. `--primary` is a compatibility alias kept for shadcn / Tailwind ecosystem compatibility and should not be preferred in new code

Default consumption rules:

1. Regular application packages should depend on `@cherrystudio/ui/styles/theme.css` by default
2. Regular application packages should prefer public contracts such as `--color-*` and should not bind directly to primitive tokens like `--cs-brand-500`
3. Only design-system-adjacent packages that explicitly need token-level access should depend on `@cherrystudio/ui/styles/tokens.css`
4. Runtime theme logic should only write to controlled entry variables such as `--cs-theme-*`, not directly to derived `--color-*` variables

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
pnpm type-check

# Run tests
pnpm test
```

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
