# Cherry Studio Design System

This document defines Cherry Studio's product-wide visual direction and the rules for choosing shared design
semantics. It is intentionally not a component API reference, a copy of Tailwind classes, or a specification for
individual feature pages.

## Sources of truth

- [Design token system](./packages/ui/docs/design-token-system.md) owns token architecture, namespaces, mappings,
  and migration rules.
- [Variable catalog](./packages/ui/docs/variable-catalog.md) owns the current variable inventory and selection
  order.
- [`@cherrystudio/ui` components](./packages/ui/src/components) own exact variants, dimensions, interaction states,
  motion, and accessibility behavior.
- [Component stories](./packages/ui/stories/components) demonstrate supported component composition and usage.
- [UI semantic contract](./docs/references/ui-semantic-contract.md) owns stable DOM hooks used by Custom CSS,
  tests, inspectors, and automation.

If this document conflicts with an implementation detail, use the relevant source above and update this document
only when the product-wide design intent has changed.

## 1. Design direction

Cherry Studio is a content-first AI workspace. The interface should feel calm, precise, and utilitarian so that
conversation, code, documents, and user-created content remain the visual focus.

The shared direction is:

- **Neutral first:** application chrome is predominantly neutral; color communicates action or meaning.
- **Semantic color:** use product roles such as primary, destructive, success, warning, and info instead of
  page-local hues.
- **Content before decoration:** avoid ornamental containers, gradients, shadows, and color that do not clarify
  structure or state.
- **Surface-based hierarchy:** establish depth with background, card, popover, and sidebar surfaces before adding
  shadows.
- **Shared behavior:** use `@cherrystudio/ui` primitives and composites instead of recreating their appearance or
  interaction locally.
- **Mode independence:** authored UI should work in light and dark modes through semantic tokens, without local
  palette branches.
- **Accessible interaction:** focus, disabled, selected, invalid, and loading states must remain perceivable without
  relying on color alone.

## 2. Documentation ownership

### Global rules belong here

Keep a rule in `DESIGN.md` only when it applies across unrelated product areas and is expected to remain stable as
individual components evolve. Examples include semantic color usage, depth philosophy, focus visibility, and the
preference for shared components.

### Component rules stay with components

Exact height, padding, radius, animation timing, portal behavior, and variant styling belong in the component
implementation. Stories should make supported variants and composition visible. Do not duplicate those values in
this document or create a parallel component specification that must be synchronized manually.

When a shared component cannot express a required behavior, improve its public API after confirming that the need
is reusable. Do not establish a second page-local version through documentation.

### Feature pages own their composition

Individual pages choose layouts that fit their tasks. A page-specific column width, toolbar arrangement, card grid,
or content flow is not a design-system rule. Keep such decisions close to the feature when they need explanation.

Promote a pattern only after it is reused across independent product areas and has a stable shared implementation.
The reusable component then owns its exact layout; this document may describe only the cross-product principle it
represents.

## 3. Color and token selection

Use semantic Tailwind utilities in component code and the corresponding public CSS variables in authored CSS. The
[variable catalog](./packages/ui/docs/variable-catalog.md) is the complete reference.

### Core roles

| Intent | Preferred roles |
|---|---|
| Page and work surface | `background`, `background-subtle` |
| Contained surface | `card`, `card-foreground` |
| Floating surface | `popover`, `popover-foreground` |
| Primary and secondary text | `foreground`, `muted-foreground` |
| Quiet and unavailable content | `foreground-tertiary`, `foreground-disabled` |
| Primary action or selection | `primary`, `primary-foreground` |
| Dangerous action | `destructive`, `destructive-foreground` |
| Feedback | `success`, `warning`, `info`, `error` families |
| Structure and selection | `border`, `border-subtle`, `border-strong`, `border-selected`, `input`, `ring` |
| Navigation zone | `sidebar` family |
| Clickable text | `link` |
| Categorical data | `chart-1` through `chart-5` |

### Selection rules

1. Use a foreground role for text and icons. Foreground tokens are solid colors; do not weaken their semantics with
   color-opacity modifiers.
2. Use semantic neutral roles for borders, subdued fills, hover surfaces, and structural separation.
3. Use chromatic roles only when the color communicates a stable intent: action, selection, feedback, or data
   category.
4. Use the paired subtle foreground and border roles for feedback surfaces, such as
   `bg-error-subtle text-error-subtle-foreground border-error-border`.
5. Use `link` for clickable text. Do not treat `primary` as a generic blue or decorative accent.
6. Use `destructive` for dangerous actions; use the `error` family for error feedback.
7. Use `chart-1` through `chart-5` for ordinary categorical charts. Primitive color scales require an intentionally
   reviewed visualization palette.

Do not hard-code hex, `rgb`, `rgba`, or `oklch` values in product UI. Do not declare or consume generated
`--color-*` variables in authored code. Shared `--cs-*` variables are internal providers, not component-facing
semantics. Follow the token architecture when adding or changing a public role.

## 4. Typography

Use the shared body and heading font families for functional UI. Code-rendering components own their monospace
stack locally.

- Regular weight is the default for content.
- Medium weight establishes navigation and label hierarchy.
- Bold weight is reserved for strong or page-level emphasis.
- Use the shared body and heading size/line-height tokens instead of introducing a page-local type scale.
- Muted, tertiary, and disabled hierarchy comes from foreground roles, not font thinning or opacity.

The canonical values live in `packages/ui/src/styles/tokens/typography.css`; this document does not duplicate the
scale.

## 5. Surfaces, depth, and shape

Use surface color as the primary depth system:

1. `background` is the ground plane.
2. `card` contains related content.
3. `popover` is reserved for transient floating content.
4. `sidebar` defines a distinct navigation zone.

Borders separate adjacent surfaces when color alone is insufficient. Shadows are for floating elements and
intentional interaction feedback, not routine static elevation. Use the shared overlay and floating primitives;
do not invent page-local glass, scrim, or blur tokens.

Use the radius and spacing utilities supplied by the shared Tailwind theme. Let shared components own their shape.
For custom composition, choose a radius according to scale and density: compact controls use smaller shared radii,
containers use larger ones, and `rounded-full` is limited to pills, avatars, and circular controls.

## 6. Interaction and accessibility

### Action hierarchy

- Use shared Button variants to express primary, secondary, low-emphasis, and destructive actions.
- Reserve chromatic primary treatment for the action or selection that truly needs it.
- Keep utility and row-level actions quiet at rest so content retains emphasis.
- Icon-only controls require an accessible label and a tooltip when their meaning is not obvious.
- Dangerous row actions need not remain permanently red; the destructive decision must be clear at confirmation.

### Focus

Keyboard focus must be visible and should reuse a component's existing border, fill, text, underline, or an inset
indicator. Avoid adding a second frame outside the control.

- Text-entry controls may change their existing border while editing or keyboard-focused.
- Buttons, menu items, tabs, links, and selectable rows should use their established hover vocabulary for
  focus-visible feedback.
- Controls that cannot express focus through an existing surface may use an inset ring or inset shadow.
- Do not remove focus feedback, and do not use positive outer ring, outline offset, or focus shadow treatments.

Pointer focus, an open popup, or a pressed control does not automatically justify a theme-colored border.
Persistent states such as selected, checked, active, and invalid may use a border when it communicates that state.

### State and motion

Prefer the loading, disabled, invalid, selected, and open states already exposed by shared components. Motion should
explain a state or spatial transition, remain restrained, and respect `prefers-reduced-motion`. Do not introduce
page-local motion that competes with content or contradicts the shared component behavior.

## 7. Layout and responsive behavior

Use Tailwind's numeric spacing scale and standard breakpoints. Layout should respond to available space and content
priority rather than following a universal page template.

- Preserve a clear reading order as space narrows.
- Collapse secondary navigation and utilities before primary content.
- Avoid nested cards when spacing, a divider, or a surface change communicates grouping sufficiently.
- Keep touch and pointer targets usable at the supported window sizes.
- Let feature pages own task-specific grids, columns, panels, and maximum widths.

A repeated layout should become a shared component or composition API. Documentation alone does not make a
page-specific layout a design-system pattern.

## 8. Review checklist

Before shipping new UI, check that it:

- uses `@cherrystudio/ui` for available primitives and composites;
- uses semantic tokens without hard-coded colors or private token-looking aliases;
- preserves light and dark mode behavior;
- establishes hierarchy through typography, spacing, surfaces, and borders before decoration;
- has clear hover, focus-visible, disabled, loading, selected, and invalid states where applicable;
- provides accessible names for icon-only actions;
- respects reduced motion;
- keeps page-specific implementation choices out of the global design-system contract.
