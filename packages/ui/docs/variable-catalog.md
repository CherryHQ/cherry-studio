# Cherry Studio Variable Catalog

This is the operational companion to [design-token-system.md](./design-token-system.md). It tells humans and AI
which public variable to choose, which CSS property it belongs to, and which historical names are tooling-only.

The machine-readable source of truth is `scripts/theme-contract.ts`. If this document and the manifest disagree,
the contract checker fails.

## 1. Selection order

Choose a variable in this order:

1. Use an official Shadcn role when it expresses the intent.
2. Use a `stable` Cherry Studio product role only when Shadcn has no equivalent product concept.
3. If neither fits, keep the value local until a repeated semantic role is proven and reviewed.

For Tailwind components, prefer the semantic utility generated from the variable. For authored CSS, reference the
official or stable product custom property directly.

Never choose a variable because its current color happens to look right. Choose it because its semantic role and
CSS property match.

## 2. Layer and entry map

| Layer | Authored source | May depend on | Public entry |
| --- | --- | --- | --- |
| Foundation values | `tokens/**` | primitives and other foundation values | `styles/tokens.css` |
| Controlled runtime inputs | `theme-input.css` | foundation values | composed internally by `styles/contract.css` |
| Official semantics | `shadcn.css` | foundation values and registered runtime inputs | `styles/contract.css` |
| Product semantics | `product.css` plus approved foundation providers | official semantics and foundations | `styles/contract.css` |
| Tailwind adapter | generated `theme.css` | official and product semantics | `styles/theme.css` |
| Migration policy | `migrations/shadcn-v2.json` | official and product semantics | tooling only; no runtime layer |

The shared dependency direction is one-way. A lower shared layer must never reference `--color-*`, host-local
`--app-*`, or a legacy variable.

## 3. Runtime inputs and local implementation variables

The current registered runtime input is `--cs-theme-primary`. Only host theme logic may write it, and only the
semantic layer may consume it. It is not a stable product variable, component API, or Tailwind color.

Component, page, and Electron-shell custom properties are a separate ownership category:

| Owner | Placement | Shared contract treatment |
| --- | --- | --- |
| Component | Component stylesheet or scoped style | Keep private; do not generate globally |
| Page/feature | Page or feature stylesheet | Keep private; do not generate globally |
| Electron/App Shell | Dedicated renderer host stylesheet; `--app-*` is allowed | Keep private; do not put in the generic Tailwind entry |

The migration registry's historical `--app-*` entries are retired semantic bridges, not a namespace-wide ban on
genuine host-local variables.

## 4. Official Shadcn variables

Official variables are unprefixed so Shadcn tooling and compatible themes such as TweakCN can provide them.

### Surfaces and paired content

| Surface | Foreground | Intended properties | Tailwind example |
| --- | --- | --- | --- |
| `--background` | `--foreground` | `background-color` / `color` | `bg-background text-foreground` |
| `--card` | `--card-foreground` | grouped content surface / content | `bg-card text-card-foreground` |
| `--popover` | `--popover-foreground` | floating surface / content | `bg-popover text-popover-foreground` |
| `--primary` | `--primary-foreground` | primary fill / content on that fill | `bg-primary text-primary-foreground` |
| `--secondary` | `--secondary-foreground` | secondary fill / content on that fill | `bg-secondary text-secondary-foreground` |
| `--muted` | `--muted-foreground` | quiet fill / secondary readable content | `bg-muted text-muted-foreground` |
| `--accent` | `--accent-foreground` | selected or hovered fill / content | `bg-accent text-accent-foreground` |
| `--destructive` | `--destructive-foreground` | dangerous action fill / content | `bg-destructive text-destructive-foreground` |
| `--sidebar` | `--sidebar-foreground` | sidebar zone / default sidebar content | `bg-sidebar text-sidebar-foreground` |
| `--sidebar-primary` | `--sidebar-primary-foreground` | primary sidebar action / content | `bg-sidebar-primary text-sidebar-primary-foreground` |
| `--sidebar-accent` | `--sidebar-accent-foreground` | selected sidebar row / content | `bg-sidebar-accent text-sidebar-accent-foreground` |

Always apply a surface with its paired foreground when the component owns both properties. Do not assume white,
black, or the page foreground will have sufficient contrast.

### Controls, charts, and radius

| Variable | Intended property |
| --- | --- |
| `--border` | Default `border-color` and divider color |
| `--input` | Input and control border color |
| `--ring` | Keyboard focus ring or outline color |
| `--sidebar-border` | Sidebar divider and boundary color |
| `--sidebar-ring` | Focus ring inside the sidebar zone |
| `--chart-1` | First categorical data series |
| `--chart-2` | Second categorical data series |
| `--chart-3` | Third categorical data series |
| `--chart-4` | Fourth categorical data series |
| `--chart-5` | Fifth categorical data series |
| `--radius` | Canonical Shadcn radius input; Tailwind radii derive from it |

The standard Tailwind adapter derives `radius-sm` through `radius-4xl` from `--radius` with the Shadcn
multipliers. Cherry's smaller `4xs` through `xs` aliases and `round` alias are compatibility extensions, not
inputs to the semantic contract.

## 5. Stable Cherry Studio product variables

Stable product variables are allowed in new code when no official Shadcn role expresses the product concept.

### Shared extensions

| Variable | Intended property and role |
| --- | --- |
| `--cs-background-subtle` | Very quiet product-wide surface background |
| `--cs-background-subtle-foreground` | Content on the subtle surface |
| `--cs-border-subtle` | Very quiet `border-color` |
| `--cs-border-strong` | Higher-emphasis structural `border-color` |

### Feedback families

Each family exposes a strong surface pair, a subtle surface pair, and a border:

| Intent | Strong pair | Subtle pair | Border |
| --- | --- | --- | --- |
| Success | `--cs-success` / `--cs-success-foreground` | `--cs-success-subtle` / `--cs-success-subtle-foreground` | `--cs-success-border` |
| Warning | `--cs-warning` / `--cs-warning-foreground` | `--cs-warning-subtle` / `--cs-warning-subtle-foreground` | `--cs-warning-border` |
| Info | `--cs-info` / `--cs-info-foreground` | `--cs-info-subtle` / `--cs-info-subtle-foreground` | `--cs-info-border` |
| Error | `--cs-error` / `--cs-error-foreground` | `--cs-error-subtle` / `--cs-error-subtle-foreground` | `--cs-error-border` |

Use `--destructive` for a dangerous action. Use the `--cs-error*` family for error feedback or validation state.

### Product domains

| Domain | Variables | Intended properties |
| --- | --- | --- |
| Rich-text links | `--cs-link` | Link `color` inside rendered content |
| Code blocks | `--cs-code-block`, `--cs-code-block-foreground` | Block code `background-color` / `color` |
| Inline code | `--cs-inline-code`, `--cs-inline-code-foreground` | Inline code `background-color` / `color` |
| References | `--cs-reference`, `--cs-reference-foreground`, `--cs-reference-subtle` | Reference surface, content, and quiet surface variant |
| Search highlights | `--cs-highlight`, `--cs-highlight-foreground`, `--cs-highlight-accent` | Match surface, content, and active-match surface |
| User message | `--cs-chat-user`, `--cs-chat-user-foreground` | User-message surface and content |
| Active sidebar row | `--cs-sidebar-active-bg`, `--cs-sidebar-active-foreground`, `--cs-sidebar-active-border` | Active surface, content, and border |
| Sidebar glow | `--cs-sidebar-glow-bg`, `--cs-sidebar-glow-line` | Decorative glow fill and line only |

Product colors are not automatically Tailwind colors. Only names in `CHERRY_PRODUCT_COLOR_TOKENS` generate
utilities; custom-CSS domains such as rich text intentionally use `var(--cs-*)` directly.

## 6. Historical migration names

Historical names are recorded only in `migrations/shadcn-v2.json`. They are not declared by `product.css`, are not
part of `CHERRY_PRODUCT_VARIABLE_TOKENS`, and do not produce Tailwind utilities. An `exact` registry rule may point
to an official or stable product variable. A `review`, `contextual`, or `preserve` rule may intentionally have no
target when the old value belongs to a component, feature, host, or one-off visual implementation.

Do not recreate a shared runtime variable merely to give migration tooling a destination. Promote a historical
role only after semantic review establishes a repeated product invariant, an intended CSS property, concrete
consumers, and any required surface/foreground pair.

## 7. Tailwind and CSS usage

Preferred component usage:

```tsx
<section className="bg-card text-card-foreground border-border" />
<aside className="bg-sidebar text-sidebar-foreground" />
<div className="bg-success-subtle text-success-subtle-foreground border-success-border" />
```

Preferred custom CSS usage:

```css
.rich-text a {
  color: var(--cs-link);
}

.reference {
  color: var(--cs-reference-foreground);
  background-color: var(--cs-reference);
}
```

Do not author runtime styles against `--color-*`. Those variables are Tailwind adapter output. Do not recreate or
consume the historical `--app-*` semantic bridges or legacy names in the migration registry. Genuine App Shell
variables must stay in a dedicated host-owned stylesheet and must not masquerade as shared theme semantics.

## 8. Adding or changing a variable

Before adding a variable:

1. Search the official Shadcn contract and stable product list for the same intent.
2. Identify its owner first: shared semantic, runtime input, component, page/feature, or App Shell.
3. State the intended CSS property and concrete current consumers or cross-component invariant. A speculative or
   single local use stays with its owner.
4. A shared product variable is stable public API; historical migration-only values stay with their owner.
5. Add a foreground if the variable represents a public surface.
6. Define a root value and ensure light/dark resolution is intentional.
7. Add shared names to `theme-contract.ts`; add Tailwind exposure only when semantic utilities are required.
8. Add migration metadata when replacing an existing name.
9. Run `theme:build`, then `pnpm --filter @cherrystudio/ui theme:check`; the check also covers generated output,
   migration rules, and the renderer migration boundary.
10. Update this catalog and the relevant visual guidance.

## 9. Rules for AI-generated code

When generating or refactoring UI code:

- use official Shadcn utilities first;
- use only `stable` product variables from this catalog;
- never recreate a historical migration name as runtime compatibility API;
- never infer semantics from a resolved color value or token spelling alone;
- never add light/dark palette branches when an existing semantic variable already resolves the mode;
- never edit generated `theme.css` directly;
- keep component, page, and App Shell implementation variables in their owning stylesheet;
- never introduce a raw color merely because a close token is unavailable—report the missing semantic role;
- preserve the surface/foreground pair when moving or composing a surface.
