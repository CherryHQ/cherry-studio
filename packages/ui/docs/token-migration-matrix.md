# Theme Token Migration Matrix

This matrix is the source of truth for rebasing the six UI consumer PRs onto
the token foundation. Update it whenever a foundation token is renamed,
removed, changes owner, or changes stability.

The foundation separates three concerns:

- `--color-*`, `--font-*`, `--radius-*`, and `--icon-*`: stable public theme contract;
- `--cs-*` in `tokens/colors/component.css`: owner-only implementation slots;
- `--app-*` and `--provider-*`: renderer App Shell and Provider page-local contracts.

## Consumer PR status

| PR | Scope | Required action | Status |
| --- | --- | --- | --- |
| #16503 | Shared primitives, composites, and broad renderer consumers | Apply shared, component-slot, border, and accent-role mappings | Pending rebase |
| #16505 | Glass shell, sidebar, and navigation | Apply App Shell ownership mappings; remove shared glass aliases | Pending rebase |
| #16508 | Provider Settings | Apply Provider mappings; consume global theme instead of creating a second palette | Pending rebase |
| #16510 | Settings pages | Apply shared border, typography, and accent-role mappings | Pending rebase |
| #16513 | Page reskin and CSS-variable governance | Keep the legacy JSON source; update accepted public contracts and removed aliases | Pending rebase |
| #16860 | Icons and follow-up polish | Apply shared/component/App Shell/Provider mappings according to the owning consumer | Pending rebase |

Change `Pending rebase` only after the PR has rebased onto this foundation and
its diff no longer restores a rejected token source.

## Runtime theme and public semantic roles

| Previous or intermediate contract | Final contract | Owner | Consumer action | PRs |
| --- | --- | --- | --- | --- |
| `--cs-theme-control-accent` | `--cs-theme-accent` | Runtime input | Runtime writer only; product CSS uses a public role | All |
| No readable accent-text input | `--cs-theme-accent-text` / `--color-theme-accent-text` | Runtime input / public contract | Use for accent-colored text and icons on normal surfaces | #16503, #16510, #16513, #16860 |
| `--cs-theme-control-accent-foreground` | `--cs-theme-accent-foreground` | Runtime input | Runtime writer computes contrast against the raw accent | All |
| `--cs-theme-control-accent-hover` | `--cs-control-accent-hover` / `--color-control-accent-hover` | Global semantic | Controls use the public alias | #16503, #16510 |
| `--cs-control-accent-foreground` | `--cs-control-accent-foreground` | Global semantic | Keep only as the control-role mapping of the runtime foreground | #16503, #16510 |
| `--color-control-accent` used for ordinary text/icons | `--color-theme-accent-text` | Public theme | Reclassify non-control foreground usage | #16503, #16505, #16510, #16513, #16860 |
| `--color-control-accent` used for progress/drag/decorative fill | `--color-theme-accent` | Public theme | Reclassify non-control fill, border, and decoration | #16503, #16505, #16510, #16513, #16860 |
| `--color-control-accent` used for checked/on controls | `--color-control-accent` | Public theme | Keep | #16503, #16510, #16860 |
| `--color-link` | `--color-link` | Public theme | Keep; it now resolves through readable Theme Accent Text | #16503, #16513, #16860 |
| `--color-theme-accent-soft` | Removed | None | Do not migrate consumers to it | All |
| Legacy `--color-primary-bg` | Inline compatibility mix from `--color-theme-accent` | Legacy bridge | No new consumers; delete with the legacy bridge later | #16513 |
| `--cs-theme-primary` | `--cs-primary` | Global semantic | Token sources only; product CSS uses `--color-primary` | All |
| `--cs-theme-ring` | `--cs-ring` | Global semantic | Product CSS uses `--color-ring` | All |

### Accent role selection

| Visual role | Public contract |
| --- | --- |
| Checkbox, Switch, Radio, or Slider checked/on fill | `--color-control-accent` |
| Content on a solid checked/on fill | `--color-control-accent-foreground` |
| Link | `--color-link` |
| Accent text, mention, citation, or active icon on a normal surface | `--color-theme-accent-text` |
| Progress, drag indicator, active underline, decorative fill, or border | `--color-theme-accent` |
| Content on a solid raw accent fill | `--color-theme-accent-foreground` |
| Success, warning, info, or error meaning | Matching status family; never an accent token |

## Borders and form controls

| Previous or intermediate contract | Final contract | Owner | Consumer action | PRs |
| --- | --- | --- | --- | --- |
| `--cs-border-fg-muted` | `--cs-input` | Global semantic | Form-control source role | #16503, #16510, #16860 |
| `--cs-border-foreground-muted` | `--cs-input` | Global semantic | Remove the recipe-named intermediate token | Foundation |
| `--color-border-fg-muted` / `--color-border-foreground-muted` | `--color-input` | Public theme | Input, Textarea, Radio, Combobox, TreeSelect, and input-like shells use `border-input` | #16503, #16510, #16513, #16860 |
| Topic flow legend usage | `--color-border` | Public theme | Use `border-border` | Foundation / #16503 |
| `bg-border-strong` in Resizable | `--cs-resizable-separator-focus` | Component internal | Use `bg-(--cs-resizable-separator-focus)` | #16503, #16860 |
| Provider border usages | Provider border roles below | Provider scope | Do not bind Provider containers to the global input role | #16508, #16860 |

## Shared component implementation slots

Component slots no longer generate stable `--color-*` aliases. The owning
component consumes the `--cs-*` property directly.

| Previous public-looking alias or utility | Final owner-only slot | Consumer action | PRs |
| --- | --- | --- | --- |
| `--cs-control-thumb` / `--color-control-thumb` / `--color-switch-thumb` | `--cs-switch-thumb` | Switch uses `bg-(--cs-switch-thumb)` | #16503, #16860 |
| `--cs-highlight` / Badge `--color-highlight` | `--cs-badge-highlight-border` | Badge uses the direct property; never replace the legacy search-highlight variable | #16503, #16513, #16860 |
| `--color-highlight-surface` / `--color-badge-highlight-surface` | `--cs-badge-highlight-surface` | Badge uses `bg-(--cs-badge-highlight-surface)` | #16503, #16860 |
| `--color-highlight-foreground` / `--color-badge-highlight-foreground` | `--cs-badge-highlight-foreground` | Badge uses `text-(--cs-badge-highlight-foreground)` | #16503, #16860 |
| `--color-button-elevated-*` | `--cs-button-elevated-*` | Button composes its gradient/shadow from direct owner slots | #16503, #16860 |
| `bg-border-strong` | `--cs-resizable-separator-focus` | Resizable uses the direct owner slot | #16503, #16860 |

## App Shell ownership

These values are Electron/window-chrome implementation details. They move out
of `@cherrystudio/ui` and do not receive global `--color-*` aliases.

| Previous shared contract | Final Renderer contract | Consumer action | PRs |
| --- | --- | --- | --- |
| `--color-tabbar-glass-surface` | `--app-nav-item-glass-active-surface` | AppShellTabBar and SidebarList use the direct property | #16505, #16860 |
| `--color-tabbar-glass-border` | `--app-nav-item-glass-active-border` | Same | #16505, #16860 |
| `--color-tabbar-glass-hover` | `--app-nav-item-glass-hover-surface` | Same | #16505, #16860 |
| `--color-tabbar-glass-shadow` | `--app-nav-item-glass-active-shadow` | Same | #16505, #16860 |
| `--color-sidebar-glass-shadow` | `--app-sidebar-glass-shadow` | App sidebar uses the direct property | #16505, #16860 |
| `--color-sidebar-translucent` | `--app-sidebar-translucent` | Native-vibrancy sidebar only | #16505, #16860 |
| `--color-frame-border-translucent` | `--app-frame-border-translucent` | Electron translucent window frame only | #16505, #16860 |

Global `--color-sidebar-*`, `--color-selected`, and
`--color-selected-border` remain public semantic roles; only native-vibrancy
and navigation-glass tuning moves to App Shell ownership.

## Other shared renames

| Previous contract | Final contract | Consumer action | PRs |
| --- | --- | --- | --- |
| `--cs-surface-fg-subtle-solid` | `--cs-surface-hover-subtle-solid` | Token source rename | #16503, #16508, #16510, #16860 |
| `--color-surface-fg-subtle-solid` | `--color-surface-hover-subtle-solid` | Replace hover-surface consumers | #16503, #16508, #16510, #16860 |
| `--cs-font-size-body-13` | `--cs-font-size-body-xs-plus` | Token source rename | #16503, #16510, #16860 |
| `--font-size-body-13` / `text-body-13` | `--font-size-body-xs-plus` / `text-body-xs-plus` | Replace typography consumers | #16503, #16510, #16860 |
| Icon stroke source in typography | `tokens/iconography.css` | Consumer names `--icon-stroke*` remain stable | #16503, #16860 |

## Status source consolidation

| Previous ownership | Final ownership | Consumer action | PRs |
| --- | --- | --- | --- |
| `--cs-success`, `--cs-warning`, `--cs-info` in `semantic.css` | Short aliases in `status.css` | Public `--color-success`, `--color-warning`, and `--color-info` remain stable | All |
| Light `--cs-warning-base: amber-400` | Light `--cs-warning-base: amber-500` | Use `--color-warning-text` for warning body text | #16503, #16508, #16510, #16860 |
| Error feedback expressed as destructive action | `--color-error-*` | Use error family for feedback; keep destructive for dangerous actions | All |

## Provider Settings scoped contract

Provider Settings consumes the global theme and owns only page-specific atoms.
It does not override the complete Shadcn palette, chart palette, sidebar theme,
or shared radius/weight scales.

### Provider renames kept as local roles

| Previous Provider name | Final Provider name | Consumer action |
| --- | --- | --- |
| `--drawer-background` / `--provider-drawer-background` | `--provider-color-drawer-background` | Page-owned drawer surface |
| `--section-border` / `--provider-section-border` | `--provider-color-section-border` | Page-owned section divider |
| `--color-drawer-background` | `--color-provider-drawer-background` | Provider-only Tailwind alias |
| `--color-section-border` | `--color-provider-section-border` | Provider-only Tailwind alias |
| `--color-border-default-soft` / `--provider-color-border-default-soft` | `--provider-color-border-subtle` | Quiet Provider outline |
| `--color-border-fg-muted` / `--provider-color-border-foreground-muted` | `--provider-color-border-default` | Default Provider container/control outline |
| `--color-border-fg-hairline` / `--provider-color-border-foreground-hairline` | `--provider-color-border-hairline` | Hairline divider |
| `--color-fg-subtle` | `--provider-color-foreground-subtle` | Low-emphasis Provider foreground |
| `--color-surface-fg-sunken` | `--provider-color-surface-sunken` | Sunken Provider surface |
| `--color-surface-fg-subtle` | `--provider-color-surface-subtle` | Subtle Provider surface |
| `--color-surface-hover-soft` | `--provider-color-surface-hover` | Provider hover surface |
| `--color-surface-warning-soft` | `--provider-color-warning-surface` | Reuse global warning source |
| `--color-border-warning-soft` | `--provider-color-warning-border` | Reuse global warning source |
| `--color-surface-info-soft` | `--provider-color-info-surface` | Reuse global info source |
| `--color-border-info-soft` | `--provider-color-info-border` | Reuse global info source |

The following names remain local and unchanged because committed consumers use
their exact dimensions:

```text
--provider-list-row-gap
--provider-space-inline-md
--provider-space-stack-sm
--provider-radius-4xs
--provider-radius-lg
--provider-radius-xl
--provider-radius-control
--provider-font-size-caption
--provider-font-size-heading-sm
--provider-font-size-body-md
--provider-font-size-body-xs
--provider-line-height-caption
--provider-line-height-body-md
--provider-line-height-section-label
--provider-line-height-body-xs
--provider-padding-x-control
--provider-padding-y-control
--provider-padding-x-control-compact
--provider-padding-y-control-compact
--provider-icon-size-caption
--provider-icon-size-body-xs
--provider-icon-size-model-list-cap
```

### Provider contracts removed or deferred

| Removed group | Replacement or rule |
| --- | --- |
| Scoped `--background`, `--foreground`, card/popover/primary/secondary/accent/destructive/border/input/ring families and their `--color-*` bridges | Consume the global public theme |
| `--chart-1` through `--chart-5` | No Provider chart consumer; use public primitive scales when a chart lands |
| Scoped sidebar family | Consume global `--color-sidebar-*` |
| `--provider-font-size-base` | Use global body typography |
| `--provider-input-background`, `--provider-switch-background` | Use shared Input/Switch contracts |
| Provider font-weight scale | Use global `--font-weight-*` |
| Unused Provider radius steps | Use global radius or add the exact local step with a consumer |
| `--provider-active-*` | Use global selected roles or a concrete Provider component role |
| `--provider-accent*` | Classify as theme-accent text/fill or global neutral accent |
| `--provider-text-muted` | Use global foreground roles |
| Unused inline/stack spacing steps | Add only with a committed consumer |
| Row-title and chip-only typography tokens | Use existing Provider body/caption tiers until a distinct role is proven |
| `--provider-color-surface-foreground-muted` | Use the surviving surface roles |
| `--provider-padding-x-list-group` | Keep layout composition in the consumer |
| `--provider-max-height-scroll-sm` | Keep one-off max height in the owning consumer |

If Provider Settings later becomes a deliberate independent subtheme, add a
separate design decision and a Portal propagation contract before reintroducing
scoped public palette overrides.

## Rebase completion checklist

For each downstream PR:

1. Rebase onto the foundation and take foundation-owned files from the base.
2. Do not restore removed token definitions or generated component aliases.
3. Replace source names and consumer utilities using the tables above.
4. Classify every user-accent usage by text, fill, on-fill foreground, link,
   control, or status role.
5. Keep `--app-*` and `--provider-*` inside their owning renderer boundaries.
6. Update that PR's status at the top of this document when its diff is clean.
