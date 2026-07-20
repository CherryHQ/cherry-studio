# Cherry Studio Shadcn Variable System

> Status: normative v2 contract. Exact renderer aliases have been migrated and their runtime compatibility
> bridges have been removed.

This document defines the new variable system for Cherry Studio. It is intentionally focused on the Shadcn
semantic contract and its migration boundary. Historical names now exist only in the migration registry and
enforcement tooling; they are no longer part of the runtime variable graph.

The executable selection guide and complete public/migration inventory are maintained in
[variable-catalog.md](./variable-catalog.md).

The visual guidance in the repository root `DESIGN.md` describes how the product should look. This document
defines which variables product and shared UI code should use.

## 1. Current systems and target

The repository currently contains multiple variable families with different responsibilities:

| Family | Current role | Target role |
| --- | --- | --- |
| `--cs-{palette}-{step}` | Primitive palette | Internal value provider; unchanged in this PR |
| existing semantic `--cs-*` | Partially standardized and historically mixed semantics | Classified as approved product token or migration source |
| approved product `--cs-*` | Core semantics plus visual-parity coverage | Canonical product API and temporary exact migration targets |
| generated `--color-*` | Tailwind theme variables and some accidental public API | Tailwind adapter output only |
| historical renderer `--app-*` | Removed from runtime | Exact migration sources; forbidden in product code |
| historical renderer legacy names | Removed from runtime | Exact migration sources; forbidden in product code |
| official Shadcn variables | Complete shared contract | Canonical ecosystem-compatible API |

The new system does not create another independent palette. It creates two explicit semantic APIs over the
values already shipped by Cherry Studio:

```text
foundation values
  (--cs-brand-*, existing providers)
              │
              ▼
official Shadcn semantics
  (--background, --primary, ...)
              │
              ▼
Cherry Studio product semantics
  (--cs-success, --cs-{domain}-*, ...)
              │
              ▼
Tailwind @theme inline adapter
  (--color-background, --color-success, ...)
              │
              ▼
semantic utilities
  (bg-background, bg-success, ...)
```

The public entries reflect that graph: `tokens.css` exposes foundations, `contract.css` composes the semantic CSS
contract, and generated `theme.css` adds the Tailwind adapter.

Deprecated aliases do not participate in this flow. The registry maps them directly to official or product
semantics, while the codemod and lint guard prevent their reintroduction. Official and product semantic variables
must never point to `--color-*`, `--app-*`, or legacy variables.

## 2. Scope of the v2 contract

This contract includes:

1. the complete Shadcn color contract for light and dark modes;
2. a `--cs-*` namespace for approved Cherry Studio product semantics;
3. a canonical `--radius` input and Tailwind radius mappings;
4. an explicit Tailwind CSS v4 `@theme inline` adapter;
5. a machine-readable registry and syntax-aware exact-migration codemod;
6. product variables that preserve every value previously owned by renderer compatibility layers;
7. renderer boundary checks that keep removed compatibility layers from returning.

This contract does not include:

- contextual or review-only migration rules that require UI judgment;
- consolidation of migration-only `--cs-*` parity roles before visual verification;
- renaming every primitive to a new reference-token namespace;
- redesigning spacing, typography, shadow, or motion scales;
- adopting DTCG JSON as a required build input;
- changing the current visual palette merely to resemble a Shadcn demo theme.

DTCG may become a future source format. It is not a prerequisite for having a correct Shadcn variable system.

## 3. Layer rules

### 3.1 Existing value layer

Existing `--cs-*` variables remain an authored value source during migration. They may contain primitive values,
approved product semantics, or historical light/dark mappings.

The prefix alone does not make an existing variable public. New code may consume only an approved product token
listed by the generated contract. Primitive and unclassified `--cs-*` variables remain internal migration
sources.

`product.css` is the authored Cherry Studio product layer. Some entries intentionally duplicate nearby roles so
that every historical renderer value has an exact destination. Migrated consumers now reference these parity
tokens directly, but the tokens remain migration-classified and forbidden in new feature code. New code must
prefer an official Shadcn role, then a stable product role. Redundant parity roles may be consolidated only after
their migrated surfaces have been visually verified.

### 3.2 Official Shadcn semantic layer

Unprefixed Shadcn variables are the ecosystem-compatible public theme API:

```css
--background
--foreground
--primary
--primary-foreground
--muted
--muted-foreground
```

Rules:

- names express UI intent, never a palette or a component implementation;
- surface roles use a matching `*-foreground` when content can be placed on the surface;
- light and dark modes override the same names, never `*-light` or `*-dark` variants;
- `muted-foreground` is canonical; `foreground-muted` must not be added;
- official variables may temporarily alias existing `--cs-*` values;
- official variables must not reference Tailwind `--color-*` output;
- runtime customization enters through an approved input and resolves into canonical output.

### 3.3 Cherry Studio product semantic layer

Product concepts that Shadcn does not define use the `--cs-*` namespace:

```text
--cs-background-subtle
--cs-success
--cs-success-foreground
--cs-chat-user
--cs-chat-user-foreground
--cs-window-titlebar-height
```

Naming grammar:

```text
--cs-{domain?}-{role}-{variant?}-{state?}
```

Rules:

- use a flat role only for product-wide semantics such as `--cs-success`;
- include a domain for application concepts such as `--cs-chat-user`;
- preserve surface/foreground pairs;
- place state last, for example `--cs-chat-user-hover`;
- reference official Shadcn variables when a product role should follow TweakCN themes;
- do not encode palette names or add a token for a single use site;
- new product variables require addition to the explicit generated allowlist.

Product variables have an explicit stability level:

| Stability | Meaning | New code |
| --- | --- | --- |
| `stable` | Long-term Cherry Studio semantics not covered by Shadcn | Allowed when no official Shadcn role fits |
| `migration` | Exact destination for historical rendering behavior | Forbidden; migration tooling only |

`CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS` and `CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS` are disjoint, explicit
allowlists. Tailwind exposure is a separate concern and does not make a migration variable stable.

Example:

```css
--cs-product-selection: var(--primary);
--cs-product-selection-foreground: var(--primary-foreground);
```

This is a pattern example rather than a variable added by this PR. TweakCN can change `--primary` without knowing
the Cherry-specific variable, and a product role authored this way follows it automatically. Product roles that
must preserve a Cherry-specific appearance may intentionally own mode-aware values instead.

### 3.4 Tailwind adapter

Tailwind theme variables are generated adapter output:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-success: var(--cs-success);
}
```

`inline` is required because the theme variables reference other CSS variables. Components consume the resulting
semantic utilities:

```text
bg-background
text-foreground
bg-primary
text-primary-foreground
text-muted-foreground
border-border
ring-ring
bg-success
text-success-foreground
```

`--color-*` is not a design source and runtime code must not write to it. Existing non-semantic palette utilities
remain available during primitive cleanup, but new shared UI should prefer semantic utilities.

### 3.5 Application domains

Application-only concepts use a Cherry Studio domain rather than a second ownership prefix:

```css
--cs-sidebar-glow-bg
--cs-sidebar-glow-line
--cs-selection-toolbar-height
--cs-window-background
```

The former `--app-*` family has no runtime declarations or references. Historical names such as
`--app-card-foreground` map to official Shadcn variables in the migration registry; true product concepts map to
an approved `--cs-{domain}-*` name. Do not recreate a renderer ownership prefix.

### 3.6 Removed legacy layer

The renderer legacy alias file was deleted after repository-wide exact usage reached zero. Historical names such
as `--color-text-1` remain registry sources so old branches and incoming changes can be migrated deterministically,
but they must not be declared or consumed at runtime. Use `pnpm styles:legacy-vars` to report reintroductions and
`pnpm styles:legacy-vars --fix` to map approved exact cases back to the canonical graph.

## 4. Canonical Shadcn contract

Every variable in this section must resolve in both light and dark modes.

### 4.1 Core colors

| Group | Variables | Meaning |
| --- | --- | --- |
| Page | `background`, `foreground` | Default page surface and readable content |
| Card | `card`, `card-foreground` | Grouped or elevated content |
| Popover | `popover`, `popover-foreground` | Floating content |
| Primary | `primary`, `primary-foreground` | Highest-emphasis action or selection |
| Secondary | `secondary`, `secondary-foreground` | Supporting filled action |
| Muted | `muted`, `muted-foreground` | Quiet surface and secondary readable content |
| Accent | `accent`, `accent-foreground` | Hovered or selected interactive content |
| Destructive | `destructive`, `destructive-foreground` | Dangerous user action |
| Controls | `border`, `input`, `ring` | Structure, control outline, and focus indication |
| Charts | `chart-1` through `chart-5` | Default categorical data series |

The complete sidebar group is:

```text
sidebar
sidebar-foreground
sidebar-primary
sidebar-primary-foreground
sidebar-accent
sidebar-accent-foreground
sidebar-border
sidebar-ring
```

### 4.2 Canonical value providers

The contract preserves current design decisions by using the existing semantic layer as a provider:

| Canonical variable | Initial provider |
| --- | --- |
| `background` | `--cs-background` |
| `foreground` | `--cs-foreground` |
| `card` / `card-foreground` | `--cs-card` / `--cs-card-foreground` |
| `popover` / `popover-foreground` | `--cs-popover` / `--cs-popover-foreground` |
| `primary` / `primary-foreground` | runtime primary input / `--cs-primary-foreground` |
| `secondary` / `secondary-foreground` | `--cs-secondary` / `--cs-secondary-foreground` |
| `muted` / `muted-foreground` | `--cs-muted` / `--cs-muted-foreground` |
| `accent` / `accent-foreground` | `--cs-accent` / `--cs-accent-foreground` |
| `destructive` / `destructive-foreground` | `--cs-destructive` / `--cs-destructive-foreground` |
| `border` / `input` / `ring` | `--cs-border` / `--cs-input` / runtime ring input |
| sidebar group | matching existing `--cs-sidebar-*` values |

Charts are additive because the shared layer currently has no complete chart contract. They use an explicit,
mode-aware five-color sequence and do not change existing component rendering until consumed.

### 4.3 Cherry Studio product color extensions

Only product-wide intent that Shadcn does not express belongs in the shared extension set. The stable core starts
with:

```text
--cs-background-subtle
--cs-background-subtle-foreground
--cs-border-subtle
--cs-border-strong
```

The feedback intents are:

```text
--cs-success
--cs-warning
--cs-info
--cs-error
```

Each intent has the same shape:

```text
--cs-{intent}
--cs-{intent}-foreground
--cs-{intent}-subtle
--cs-{intent}-subtle-foreground
--cs-{intent}-border
```

`destructive` and `error` are distinct. `destructive` styles a dangerous action; `error` communicates system
feedback. They may share palette values without sharing semantics.

Every stable product surface has a declared foreground in `CHERRY_PRODUCT_SURFACE_PAIRS`. A component using a
product surface must use its paired foreground instead of guessing `foreground`, white, or black. Stable product
variables may depend on official Shadcn variables or foundations, but never on migration-only variables.

Hover and active colors are component-state decisions. The shared contract does not multiply every intent into
global `hover` and `active` variables.

The initial parity layer additionally covers existing renderer behavior by domain:

| Domain | Product roles |
| --- | --- |
| Content hierarchy | `text-primary`, `text-secondary`, `text-tertiary`, `text-light` |
| Layered surfaces | `background-soft`, `background-muted`, `background-translucent`, `border-soft`, `border-faint`, `fill-secondary`, `frame-border`, `group-background`, `modal` |
| Rich content | `link`, `code-block`, `inline-code`, `inline-code-foreground` |
| Interaction | `interactive-hover`, `interactive-active` |
| References and highlights | `reference`, `reference-foreground`, `reference-subtle`, `highlight`, `highlight-foreground`, `highlight-accent` |
| Product surfaces | `list-item`, `navbar`, `chat`, plus their documented variants and foregrounds |
| Application shell | `icon`, `sidebar-active-*`, `sidebar-glow-*` |
| Platform compatibility | `system-gray-*`, `icon-contrast`, `primary-soft`, `primary-subtle` |

Every name in this table is prefixed with `--cs-`. The explicit
`CHERRY_PRODUCT_VARIABLE_TOKENS` allowlist is the machine-readable source of the complete set; only the smaller
`CHERRY_PRODUCT_COLOR_TOKENS` subset is exported as Tailwind color utilities. This avoids generating utilities for
roles currently consumed only by custom CSS.

## 5. Radius contract

Shadcn uses one canonical input:

```css
:root {
  --radius: var(--cs-radius-lg);
}
```

Tailwind radius variables derive from that input while preserving the current 6/8/10/14/18/22 px scale:

```css
@theme inline {
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
  --radius-full: 9999px;
}
```

The multipliers match the current Shadcn radius adapter, so a theme that overrides `--radius` scales every
standard radius consistently. Existing smaller and extended radius names remain available for compatibility.
New code uses `rounded-full` instead of `rounded-round`.

Spacing, typography, shadow, and motion keep their current behavior in this PR. They require separate design
decisions and must not block the color contract.

## 6. Modes and runtime customization

Initial supported modes are `:root` and `.dark`.

The current runtime primary input remains supported:

```css
--cs-theme-primary
```

It feeds `--primary`; `--ring` derives from the same runtime color. This preserves user-selected primary colors
without allowing runtime code to mutate `--color-primary` or component variables directly.

Rules:

- every official and product semantic token resolves in every supported mode;
- a mode cannot define only half of a surface/foreground pair;
- runtime inputs always have an authored fallback;
- component code should not add `dark:*` palette substitutions when a semantic token can express the mode;
- Electron window transparency remains an application-shell concern, not the shared `background` default.

## 7. Migration registry

Bulk migration uses a versioned machine-readable registry. A rule distinguishes safe renames from cases that
need UI context.

| Strategy | Meaning | Default action |
| --- | --- | --- |
| `exact` | Same semantic and rendering role | Automatic replacement allowed |
| `contextual` | Target depends on property, component, or state | AST rule plus validation required |
| `review` | Old variable mixes multiple roles | Report only |
| `preserve` | App-only, brand, vendor, generated, or user-authored value | Never replace automatically |

Examples:

| Current family | Target | Strategy |
| --- | --- | --- |
| `--cs-background` | `--background` | `exact` |
| `--cs-foreground` | `--foreground` | `exact` |
| `--color-background` | Tailwind adapter output | `preserve` |
| `--color-text-1` | `--cs-text-primary` | `exact` |
| `--color-text-2` | `--cs-text-secondary` | `exact` |
| `--color-text-3` | `--cs-text-tertiary` | `exact` |
| `--cs-foreground-muted` | muted content or disabled component state | `contextual` |
| duplicated `--app-{shadcn-role}` | matching official Shadcn variable | `exact` |
| product chat, navbar, window, and glow variables | approved `--cs-{domain}-*` concept | `exact` |

The repository codemod reads this registry and parses CSS plus TS/TSX syntax before changing source files. It is
idempotent, skips generated and vendor files, preserves same-named variables owned locally by a file, and changes
only approved `exact` deprecated aliases, including historical `--app-*` names. Contextual and review rules remain
explicit manual work.

Run `pnpm styles:legacy-vars` for a dry-run report, `pnpm styles:legacy-vars --fix` to apply exact replacements,
or `pnpm styles:legacy-vars:strict` to fail when migratable usage remains. The same registry also drives the ESLint
reminder, so migration policy and enforcement cannot maintain separate hard-coded inventories.

## 8. Governance

Adding or changing an official Shadcn variable or approved `--cs-*` product variable is a shared API change.

A proposal must state:

1. the missing semantic role;
2. its light and dark providers;
3. the matching foreground when it is a surface;
4. intended consumers;
5. the Tailwind mapping;
6. migration classification;
7. contract-test and documentation changes.

Do not add a token for one use site, a speculative theme, or a role already represented by the contract. The
visual-parity layer is a temporary exception: it exists only where an exact migration destination is required.
Icons normally inherit `currentColor`; component hover/active states normally stay in component variants.

The generated contract must validate that:

- all required Shadcn variables exist;
- every public product variable has exactly one `stable` or `migration` classification;
- foundation, Shadcn, product, and adapter dependencies remain one-way;
- no variable has duplicate ownership across authored layers;
- every light and dark reference resolves and the variable graph has no cycles;
- every Tailwind semantic color maps to its official or product semantic variable with `@theme inline`;
- no source addition silently expands the canonical API;
- generated CSS matches committed output;
- migration records use a known strategy and do not contain duplicate sources;
- the renderer cannot reintroduce legacy aliases, `--app-*`, or a second Tailwind adapter.

Run `pnpm --filter @cherrystudio/ui theme:check` to validate the canonical graph, committed generated CSS,
migration registry, and renderer boundary together. `theme:build` reruns the canonical graph validation before
writing generated CSS, so an invalid graph cannot silently regenerate the adapter.

## 9. Delivery in this PR

The contract is delivered as independent commits. In addition to the initial architecture, Shadcn variables,
Tailwind adapter, migration registry, and product namespace, the migration phase:

1. adds an authored `product.css` layer with exact light/dark destinations for historical behavior;
2. aligns shared Shadcn providers with the values previously overridden by the renderer;
3. records every deprecated alias as an `exact` migration rule and makes the codemod registry-driven;
4. migrates all repository exact consumers, including consumer tests, to their canonical destinations;
5. deletes `legacy-vars.css`, all `--app-*` aliases, and the duplicate renderer `@theme` adapter;
6. validates that the removed bridges cannot be reintroduced.

The exact pass preserves the same providers previously reached through each alias. Contextual and review rules
remain outside automatic replacement. A parity product token may be redesigned or merged only after all of its
migrated consumers have passed visual verification in both light and dark modes.

## 10. References

- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
- [Tailwind CSS theme variables](https://tailwindcss.com/docs/theme)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) (optional future
  interchange format)
