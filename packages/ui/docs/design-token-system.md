# Cherry Studio Shadcn Variable System

> Status: normative v2 contract. Exact renderer aliases and temporary product parity variables have been
> migrated; runtime compatibility bridges have been removed.

This document defines the new variable system for Cherry Studio. It is intentionally focused on the Shadcn
semantic contract and its migration boundary. Historical public usage is recorded in the migration registry and
enforcement tooling. A matching `--cs-*` spelling may remain in the runtime graph only as an internal value
provider; it is not a compatibility alias or component-facing role.

The executable selection guide and complete public/historical inventory are maintained in
[variable-catalog.md](./variable-catalog.md).

The visual guidance in the repository root `DESIGN.md` describes how the product should look. This document
defines which variables product and shared UI code should use.

## 1. Current systems and target

The repository currently contains multiple variable families with different responsibilities:

| Family | Current role | Target role |
| --- | --- | --- |
| `--cs-{palette}-{step}` | Primitive palette | Internal value provider; unchanged in this PR |
| existing semantic `--cs-*` | Partially standardized and historically mixed semantics | Internal value provider or migration source |
| controlled `--cs-theme-*` | Runtime customization mixed into the semantic layer | Host-written input only; never a component-facing role |
| unprefixed product semantics | Consumer-backed Cherry Studio extensions | Stable product API in the shared public namespace |
| generated `--color-*` | Tailwind theme variables and some accidental public API | Tailwind adapter output only |
| retired renderer semantic `--app-*` aliases | Removed from runtime | Exact migration sources; forbidden from returning |
| genuine host/component/page variables | Locally owned implementation details | Remain scoped to the owning stylesheet; never generated globally |
| historical renderer legacy names | Removed from runtime | Exact migration sources; forbidden in product code |
| official Shadcn variables | Complete shared contract | Canonical ecosystem-compatible API |

The new system does not create another independent palette. It creates one public semantic namespace with
separate Shadcn and Cherry Studio ownership inventories over the values already shipped by Cherry Studio:

```text
foundation values
  (--cs-brand-*, existing providers)
              │
              ▼
controlled runtime inputs
  (--cs-theme-primary, --cs-theme-primary-foreground)
              │
              ▼
public semantic contract
  (Shadcn: --background, --primary, ...)
  (Cherry: --success, --chat-user, ...)
              │
              ▼
Tailwind @theme inline adapter
  (--color-background, --color-success, ...)
              │
              ▼
semantic utilities
  (bg-background, bg-success, ...)
```

The supported package entries reflect that graph: `tokens.css` exposes foundations, while generated `theme.css`
exposes the complete semantic contract and Tailwind adapter. Internal `contract.css` composes the runtime-input
and semantic layers in dependency order; it is not a public consumer entry. Runtime inputs are included so the
contract can resolve, but they are not public roles for component consumption.

Deprecated aliases do not participate in this flow. The registry maps them directly to official or product
semantics, while the codemod and migration checker prevent their reintroduction. Official and product semantic
variables must never point to `--color-*`, `--app-*`, or legacy variables.

## 2. Scope of the v2 contract

This contract includes:

1. the complete Shadcn color contract for light and dark modes;
2. a controlled runtime-input boundary between the host theme service and semantic outputs;
3. unprefixed Cherry Studio product semantics in the same public namespace as the Shadcn contract;
4. a canonical `--radius` input and Tailwind radius mappings;
5. an explicit Tailwind CSS v4 `@theme inline` adapter;
6. a machine-readable registry and syntax-aware exact-migration codemod;
7. owner-local values for historical rendering that has no stable shared semantic role;
8. renderer boundary checks that keep removed compatibility layers and authored `--color-*` usage from returning.

This contract does not include:

- contextual or review-only migration rules that require UI judgment;
- promotion of historical or owner-local values without semantic and visual review;
- renaming every primitive to a new reference-token namespace;
- redesigning spacing, typography, shadow, or motion scales;
- adopting DTCG JSON as a required build input;
- changing the current visual palette merely to resemble a Shadcn demo theme.

DTCG may become a future source format. It is not a prerequisite for having a correct Shadcn variable system.

## 3. Layer rules

### 3.1 Existing value layer

Existing `--cs-*` variables remain authored internal value sources. They may contain primitive values, semantic
providers, compatibility values, or historical light/dark mappings. The reserved `--cs-theme-*` subset is the
host-written input layer; every other shared `--cs-*` variable is internal and must not be consumed by components.

Public product semantics are unprefixed and listed by the generated contract. This makes the consumer boundary
visible in the name: canonical unprefixed semantics are public, while shared `--cs-*` values are implementation
details.

`product.css` is the authored Cherry Studio product layer. Every entry is stable public API. Historical renderer
values without a durable shared meaning stay with their component, feature, or host owner; they are not promoted
merely to give migration tooling a destination. New code must prefer an official Shadcn role, then a stable
product role.

### 3.2 Controlled runtime-input layer

`theme-input.css` owns the small, explicit set of values that runtime theme code may write:

```css
--cs-theme-primary
--cs-theme-primary-foreground
```

These variables are inputs, not design semantics. The host theme service writes them; `shadcn.css` decides which
official role consumes them. Components must not consume them directly, and the Tailwind generator must not emit
`--color-theme-*` aliases for them. Every input must be registered in `RUNTIME_THEME_INPUT_TOKENS`, have an
authored foundation fallback, and have a real runtime producer plus a semantic consumer.

This boundary deliberately avoids asserting that a user-selected color is permanently identical to Shadcn
`primary`. The host writes the primary surface and its derived contrast-safe foreground as one runtime theme
operation. A future consumer-backed theme model may route the same inputs to different semantic roles without
changing component APIs.

Renderer-only runtime settings are not shared theme inputs. For example, user-selected UI and code fonts are
written as `--app-user-font-family` and `--app-user-code-font-family` and consumed only by the renderer-owned
`font.css`. Such values use the host-local `--app-*` namespace and are not registered in
`RUNTIME_THEME_INPUT_TOKENS`.

### 3.3 Official Shadcn semantic layer

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
- official variables may temporarily alias existing foundation values or a registered runtime input;
- official variables must not reference Tailwind `--color-*` output;
- runtime customization enters through an approved input and resolves into canonical output.

### 3.4 Cherry Studio product semantic layer

Product concepts that Shadcn does not define extend the same unprefixed public semantic namespace:

```text
--background-subtle
--success
--success-subtle
--success-subtle-foreground
--chat-user
```

Naming grammar:

```text
--{domain?}-{role}-{variant?}-{state?}
```

Rules:

- use a flat role only for product-wide semantics such as `--success`;
- include a domain for application concepts such as `--chat-user`;
- add a paired foreground only when current consumers require a shared contrast contract;
- place state last, for example `--chat-user-hover`;
- reference official Shadcn variables when a product role should follow TweakCN themes;
- do not encode palette names or add a token for a single use site;
- new product variables require addition to the explicit generated allowlist.

All product variables are stable, consumer-backed Cherry Studio semantics not covered by Shadcn.
`CHERRY_PRODUCT_VARIABLE_TOKENS` is the explicit runtime allowlist. Tailwind exposure is a separate concern and
does not change API stability.

A product semantic should reference an existing foundation or official semantic when that dependency expresses
its role. It may own a light/dark literal only when no foundation token represents the product-specific value,
the role has concrete consumers, and the literal remains centralized in `product.css`. Literal ownership is not
permission for consumers to hard-code the same value.

Example:

```css
--editor-selection: var(--primary);
--editor-selection-foreground: var(--primary-foreground);
```

This is a pattern example rather than a variable added by this PR. TweakCN can change `--primary` without knowing
the Cherry-specific variable, and a product role authored this way follows it automatically. Product roles that
must preserve a Cherry-specific appearance may intentionally own mode-aware values instead.

### 3.5 Tailwind adapter

Tailwind theme variables are generated adapter output:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-success: var(--success);
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
bg-success-subtle
text-success-subtle-foreground
```

`--color-*` is not a design source or an authored CSS API. Runtime code must neither write nor consume it;
authored CSS references the official or stable product variable directly. Existing non-semantic
palette utilities remain available during primitive cleanup, but new shared UI should prefer semantic utilities.

Historical semantic and status utilities are exposed only by the frozen
`COMPATIBILITY_SEMANTIC_COLOR_TOKENS` and `COMPATIBILITY_STATUS_COLOR_TOKENS` lists. Adding a variable to a
foundation stylesheet does not create a Tailwind color automatically. These compatibility lists are shrink-only
and must not be used as the registration path for new component APIs.

### 3.6 Internal ownership boundaries

Shared application concepts use a product domain in the common public namespace rather than an ownership prefix:

```css
--chat-user
--code-block
```

There are also legitimate internal variables that do not belong in this shared list:

- Electron/App Shell values may use `--app-*` in a dedicated host-owned stylesheet;
- component implementation variables stay scoped to the component stylesheet;
- page layout variables stay in the page or feature stylesheet.

These values are implementation contracts, not product theme semantics. They are not declared by
`@cherrystudio/ui`, added to `theme-contract.ts`, or mapped through `@theme`. If an app-shell concept becomes a
cross-package product semantic with real consumers, it must go through the normal stable-token review first.

The retired `--app-*` names in `shadcn-v2.json` are different: they duplicated Shadcn or product semantics and
were removed after migration. Historical names such as `--app-card-foreground` must not return. This does not ban
new, genuinely host-local App Shell variables with a documented owner.

### 3.7 Removed legacy layer

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
| `primary` / `primary-foreground` | paired runtime primary inputs |
| `secondary` / `secondary-foreground` | `--cs-secondary` / `--cs-secondary-foreground` |
| `muted` / `muted-foreground` | `--cs-muted` / `--cs-muted-foreground` |
| `accent` / `accent-foreground` | `--cs-accent` / `--cs-accent-foreground` |
| `destructive` / `destructive-foreground` | `--cs-destructive` / `--cs-destructive-foreground` |
| `border` / `input` / `ring` | `--cs-border` / `--cs-input` / independent mode-aware `--cs-ring` |
| sidebar group | matching existing `--cs-sidebar-*` values |

Charts are additive because the shared layer currently has no complete chart contract. They use an explicit,
mode-aware five-color sequence and do not change existing component rendering until consumed.

### 4.3 Cherry Studio product color extensions

Only product-wide intent that Shadcn does not express belongs in the shared extension set. The stable core starts
with:

```text
--background-subtle
--border-subtle
--border-strong
```

The feedback intents are:

```text
--success
--warning
--info
--error
```

Each intent has the same consumer-backed shape:

```text
--{intent}
--{intent}-subtle
--{intent}-subtle-foreground
--{intent}-border
```

The base intent is an accent color for icons, text, or markers rather than a shared filled surface. The subtle
surface and foreground form the reusable feedback pair. `destructive` and `error` are distinct: `destructive`
styles a dangerous action, while `error` communicates system feedback. They may share palette values without
sharing semantics.

`CHERRY_PRODUCT_SURFACE_PAIRS` lists only product surfaces with a concrete shared foreground contract. Other
background roles deliberately keep text ownership with the consuming component until repeated usage proves a
shared pair. Stable product variables may depend on official Shadcn variables or foundations, but never on
historical names.

Hover and active colors are component-state decisions. The shared contract does not multiply every intent into
global `hover` and `active` variables.

Historical renderer values that represented content hierarchy, layered surfaces, interaction states, shell
colors, or platform constants are not automatically product semantics. Exact official aliases use the official
contract; remaining values stay local to Markdown, RichEditor, Composer, or their other concrete owner. The
migration registry records the retired names and reports cases that still need contextual review.

The explicit `CHERRY_PRODUCT_VARIABLE_TOKENS` allowlist is the machine-readable source of the complete stable
product set; only the smaller `CHERRY_PRODUCT_COLOR_TOKENS` subset is exported as Tailwind color utilities. This
avoids generating utilities for roles consumed only by custom CSS.

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

The current runtime primary inputs are declared in `theme-input.css` and remain supported:

```css
--cs-theme-primary
--cs-theme-primary-foreground
```

`useUserTheme` writes the selected primary and derives its foreground by choosing the black or white value with
the stronger WCAG contrast ratio. `--ring` resolves independently through the mode-aware `--cs-ring` provider, so
an extreme user primary such as white in light mode or black in dark mode cannot also make the focus indicator
disappear. Runtime code still does not mutate official semantics, `--color-primary`, or component variables
directly. Renderer-owned font selection is separate from this shared graph and writes only host-local
`--app-user-*` variables. The current primary connection is a compatibility mapping, not a promise that runtime
selection and Shadcn primary are the same concept forever.

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
| `--color-text-1` | `--foreground` | `exact` |
| `--color-text-2` | no universal target | `review` |
| `--color-text-3` | no universal target | `review` |
| `--cs-foreground-muted` | no universal target | `review` |
| duplicated `--app-{shadcn-role}` | matching official Shadcn variable | `exact` |
| historical chat and navbar roots | no universal target | `review` |
| renderer Sidebar active/glow effects | owner-local implementation variables | `review` |

The repository codemod reads this registry and parses CSS plus TS/TSX syntax before changing source files. It is
idempotent, reports every non-`preserve` migration source, and changes only approved `exact` rules. Generated and
canonical providers, contract fixtures, vendor files, and explicitly listed isolated local themes are excluded;
contextual and review rules remain visible manual work.

Run `pnpm styles:legacy-vars` for a strategy-labelled dry-run report, `pnpm styles:legacy-vars --fix` to apply exact
replacements, or `pnpm styles:legacy-vars:strict` to fail when any non-preserved migration source remains. After a
fix, contextual and review findings intentionally remain. Reporting and replacement share the same registry, so
migration policy and the syntax-aware tooling do not maintain separate hard-coded inventories.

## 8. Governance

Adding or changing an official Shadcn variable or an unprefixed product variable is a shared API change.
Adding a runtime input is a host/semantic boundary change. Local component, page, and App Shell variables are
owned by their local stylesheet and do not enter this process unless they are being promoted to the shared API.

A proposal must state:

1. the missing semantic role;
2. its light and dark providers;
3. the matching foreground when it is a surface;
4. intended consumers;
5. the Tailwind mapping;
6. migration impact and any registry change;
7. contract-test and documentation changes.

Do not add a token for one use site, a speculative theme, or a role already represented by the contract. A stable
role needs concrete current consumers or a documented cross-component invariant; historical value parity alone
is insufficient. Icons normally inherit `currentColor`; component hover/active states normally stay in component
variants.

The generated contract must validate that:

- all required Shadcn variables exist;
- every public product variable belongs to the stable allowlist;
- official and product variable names do not overlap;
- foundation, runtime-input, Shadcn, product, and adapter dependencies remain one-way;
- no variable has duplicate ownership across authored layers;
- every light and dark reference resolves and the variable graph has no cycles;
- every Tailwind semantic color maps to its official or product semantic variable with `@theme inline`;
- no source addition silently expands the canonical API;
- generated CSS matches committed output;
- migration records use a known strategy and do not contain duplicate sources;
- the renderer theme entry cannot reintroduce legacy aliases, own host-local `--app-*` values, or add a second Tailwind adapter;
- renderer runtime code can write only registered shared `--cs-theme-*` inputs; owner-local runtime values use `--app-*`;
- renderer CSS and TypeScript/TSX-authored style strings cannot consume generated `--color-*` adapter variables.

Run `pnpm --filter @cherrystudio/ui theme:check` to validate the canonical graph, committed generated CSS,
migration registry, and renderer boundary together. `theme:build` is deliberately a pure generator that reads
only the inputs needed for generated output; governance remains the responsibility of `theme:check`.

## 9. Delivery in this PR

The contract is delivered as independent commits. In addition to the initial architecture, Shadcn variables,
Tailwind adapter, migration registry, and product namespace, the migration phase:

1. adds an authored `product.css` layer for stable Cherry Studio semantics not covered by Shadcn;
2. aligns shared Shadcn providers with the values previously overridden by the renderer;
3. records deprecated aliases with `exact`, `contextual`, `review`, or `preserve` policy and makes the codemod registry-driven;
4. migrates exact consumers to canonical destinations and localizes parity-only values with their concrete owners;
5. deletes `legacy-vars.css`, the retired `--app-*` semantic aliases, and the duplicate renderer `@theme` adapter;
6. removes temporary product parity variables and validates that the removed bridges cannot be reintroduced.

The exact pass preserves the same providers or authored values previously reached through each alias. Contextual
and review rules remain outside automatic replacement. Visual verification in both light and dark modes remains
required before treating preserved values as a visual redesign baseline.

## 10. References

- [shadcn/ui theming](https://ui.shadcn.com/docs/theming)
- [Tailwind CSS theme variables](https://tailwindcss.com/docs/theme)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/) (optional future
  interchange format)
