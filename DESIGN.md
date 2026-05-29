# Cherry Studio Design System

## 1. Visual Theme & Atmosphere

> **Source of truth:** token sources live in `packages/ui/src/styles/tokens/` and Tailwind-facing aliases are generated in `packages/ui/src/styles/theme.css`. Renderer-only bridge aliases live in `src/renderer/assets/styles/tailwind.css`. This document references public aliases only when they are actually exported; for actual values open the relevant token source or generated theme alias.

Cherry Studio is a shadcn/ui-based design system built for an AI conversation application. The design language follows a neutral-first approach — a restrained, systematic palette rooted in pure neutral grays where the interface itself recedes to let content take center stage. The aesthetic is utilitarian-modern: clean surfaces, subtle borders, and restrained use of the exported primary color for true primary actions, creating a tool that feels professional, focused, and endlessly customizable through its robust light/dark mode support.

The typography system is single-track: `var(--font-family-body)` and `var(--font-family-heading)` currently resolve to the same primary UI font token. Code-rendering components own their mono font stack locally. This single-family approach reflects a product with a unified voice — coherent in conversation, precise in code.

What makes Cherry Studio distinctive is its commitment to a calm UI foundation. Primary actions use `var(--color-primary)` as the strongest action color in the chrome, while neutral strong fills are used by shared buttons where that component defines the action hierarchy. New UI should avoid introducing a page-local chromatic brand hue. Other chromatic departures are reserved for semantic feedback: `var(--color-destructive)` for dangerous actions, `var(--color-success)` for positive states, `var(--color-warning)` for caution, `var(--color-info)` for informational surfaces. This creates an interface that feels like a high-quality writing tool — think iA Writer meets VS Code — where the user's content is usually the most colorful thing on screen.

**Key Characteristics:**
- Calm UI foundation: chrome stays mostly neutral; `var(--color-primary)` is reserved for true primary actions and selected states, while semantic accents carry feedback
- Dual-mode system: fully specified light and dark tokens with true inversion (not just darkening)
- Primary action color resolves through `var(--color-primary)`; do not introduce a separate page-local brand hue
- Full semantic color set: `var(--color-destructive)` (red), `var(--color-success)` (green), `var(--color-warning)` (amber), `var(--color-info)` (blue)
- Status palette pairs (base / text / bg / border, with hover + active variants) defined in `tokens/colors/status.css`
- Border-radius scale from `var(--radius-none)` (0) to `var(--radius-round)` (9999px), 10 steps
- Subtle borders via `var(--color-border)` (semi-transparent neutral) for structure, not decoration
- Surfaces stack via color, not shadow: `var(--color-background)` → `var(--color-card)` → `var(--color-popover)`
- 7-level shadow utility system (`--shadow-2xs` through `--shadow-2xl`)
- Floating overlays use concrete Tailwind utilities from the shared primitive unless a token-backed alias exists; do not invent `--color-glass`, `--color-overlay`, or `--blur-*` variables in product code
- Sidebar as a distinct spatial zone with its own complete token set: `var(--color-sidebar)`, `var(--color-sidebar-primary)`, `var(--color-sidebar-accent)`, `var(--color-sidebar-border)`

## 2. Color Palette & Roles

> Token values are defined in `packages/ui/src/styles/tokens/colors/{primitive,semantic,status}.css`. This section names what each token is for; refer to the source files for resolved values.

### Palette Philosophy — Neutrals via Alpha, Colors via Steps

The color system follows one consistent rule:

- **Neutral tokens** (text, borders, secondary fills, hover backgrounds, ghost states) are composed as **black/white + an alpha channel**. Light mode layers `oklch(0 0 0 / x)` on top of the surface; dark mode layers `oklch(1 0 0 / x)` instead. This makes neutrals automatically harmonise with whatever surface they sit on (cards, glass, sidebars) and means light/dark inversion only flips the base ink, not every step of a gray scale.
- **Chromatic tokens** (`--color-primary`, `--color-destructive`, status colors, brand/lime, primitive scales) use **solid `oklch` color steps** — never alpha — because their identity must stay constant on any background.

When you reach for a value:
1. If the role is "tint of the surface" (text, divider, soft fill, hover), use the existing semantic neutral token (`--color-foreground*`, `--color-border*`, `--color-secondary`, `--color-accent`, `--color-ghost-*`). Do not invent `oklch(0 0 0 / 0.x)` literals — the token already encodes the intent.
2. If the role is "this exact color regardless of surface" (brand, error, success), use the corresponding solid token from the `--color-{primary,destructive,success,warning,info,*-base,*-text,*-bg}` set or a primitive scale.

### Primary
- **Primary**: `var(--color-primary)` — exported primary accent for true page actions, selected states, links, and component accents. Shared Button `default` / `emphasis` currently define their own neutral strong fills.
- **Primary Foreground**: `var(--color-primary-foreground)` — contrast text on `bg-primary` surfaces
- **Primary Hover**: `var(--color-primary-hover)`

### Text Colors
- **Foreground**: `var(--color-foreground)` — primary body text
- **Foreground Secondary**: `var(--color-foreground-secondary)` — secondary text, helper labels
- **Foreground Muted**: `var(--color-foreground-muted)` — placeholder, disabled, low-emphasis text
- **Card / Popover / Accent / Secondary Foreground**: `var(--color-card-foreground)` / `var(--color-popover-foreground)` / `var(--color-accent-foreground)` / `var(--color-secondary-foreground)` — contrast text on each surface

### Surface & Background
- **Background**: `var(--color-background)` — primary page background (`#FFFFFF` light / `#0A0A0A` dark)
- **Background Subtle**: `var(--color-background-subtle)` — slightly tinted background variant
- **Card**: `var(--color-card)` — elevated card surfaces
- **Popover**: `var(--color-popover)` — floating panel surfaces (dropdowns, menus, tooltips)
- **Muted**: `var(--color-muted)` — subdued backgrounds, disabled states
- **Accent**: `var(--color-accent)` — hover/active backgrounds for transparent buttons
- **Secondary**: `var(--color-secondary)` — secondary action backgrounds
- **Secondary Hover / Active**: `var(--color-secondary-hover)` / `var(--color-secondary-active)`
- **Ghost Hover / Active**: `var(--color-ghost-hover)` / `var(--color-ghost-active)` — fill on hover for ghost buttons

### Sidebar (Distinct Spatial Zone)
- **Sidebar**: `var(--color-sidebar)` — sidebar surface
- **Sidebar Foreground**: `var(--color-sidebar-foreground)` — text on sidebar
- **Sidebar Accent / Sidebar Accent Foreground**: `var(--color-sidebar-accent)` / `var(--color-sidebar-accent-foreground)` — hover/active state in sidebar (same neutral tint as `--color-secondary`; either token works, but stay consistent within a page)
- **Sidebar Border**: `var(--color-sidebar-border)` — sidebar dividers
- **Sidebar Ring**: `var(--color-sidebar-ring)` — focus ring inside sidebar

### Borders & Rings
- **Border**: `var(--color-border)` — component borders, dividers
- **Border Muted**: `var(--color-border-muted)` — low-emphasis dividers inside dense lists, tables, and grouped settings
- **Border Subtle**: `var(--color-border-subtle)` — very quiet outlines on cards, nested panels, and non-interactive containers
- **Border Hover / Active**: `var(--color-border-hover)` / `var(--color-border-active)`
- **Frame Border**: `var(--color-frame-border)` — page-level wrapping frames and stronger outer chrome
- **Input**: `var(--color-input)` — input field borders
- **Ring**: `var(--color-ring)` — focus ring

### Border Token Rules
- Use semantic border utilities (`border-border`, `border-border-muted`, `border-border-subtle`, `border-frame-border`, `border-input`, `border-sidebar-border`) instead of hard-coded colors.
- Plain `border`, `border-t`, `border-r`, `border-b`, and `border-l` are acceptable only when the global theme base provides the color fallback; reusable components should still name a semantic border color when the role is known.
- For 0.5px hairline dividers, use an explicit token-backed property such as `[border-bottom:0.5px_solid_var(--color-border)]` or `[border-right:0.5px_solid_var(--color-border-muted)]`.
- Legacy opacity-modified border classes (`border-border/10` through `border-border/80`, plus hover/focus/active variants) are compatibility-mapped in `@cherrystudio/ui/styles/theme.css` so old surfaces do not fall back to `currentColor`.
- Do not introduce new opacity-modified semantic border classes such as `border-border/60`, `border-border/40`, `border-border/30`, or `border-border/15`. Use the semantic border utilities above so the visual role is explicit.

### Semantic Status — Single-token aliases
- **Destructive**: `var(--color-destructive)` — error states, dangerous actions
- **Destructive Hover**: `var(--color-destructive-hover)`
- **Destructive Foreground**: `var(--color-destructive-foreground)`
- **Success**: `var(--color-success)` — positive states, confirmations
- **Warning**: `var(--color-warning)` — caution states, pending actions
- **Info**: `var(--color-info)` — informational states, neutral highlights

### Semantic Status — Full palettes (base / text / bg / border / hover / active)
Defined in `tokens/colors/status.css`. Use these when a status surface needs more than a single accent color (e.g. alert banners, toast bodies, tag pills). All four families share the same shape.

- **Error**: `var(--color-error-base)` · `var(--color-error-text)` · `var(--color-error-text-hover)` · `var(--color-error-bg)` · `var(--color-error-bg-hover)` · `var(--color-error-border)` · `var(--color-error-border-hover)` · `var(--color-error-active)`
- **Success**: same shape as error, prefix `--color-success-*`
- **Warning**: same shape as error, prefix `--color-warning-*`
- **Info**: same shape as error, prefix `--color-info-*`

### Brand
Do not use a page-local chromatic brand color for new UI chrome. `var(--color-brand-*)` exists as a primitive compatibility scale, but new component styling should express action hierarchy through semantic aliases such as `var(--color-primary)` and status through the semantic status tokens.

### Links
Links inherit `var(--color-primary)` for color and add an underline on hover. There is no separate `--color-link` token by design — primary is the link color.

### Floating Scrims
No dedicated public `--color-glass`, `--color-glass-border`, `--color-glass-blur`, or `--color-overlay` aliases are exported today. Use the shared primitive defaults first:
- Dialog overlay: use the shared `Dialog` overlay (`bg-black/50`) and customize only through `overlayClassName` when needed.
- Floating panels: use `bg-popover`, `border-border`, and the appropriate shadow utility (`shadow-md` to `shadow-xl`) rather than a page-local glass token.
- If a reusable translucent surface is needed, add/export a real token first and document it here in the same change.

### Chart Colors
Not yet defined as a dedicated palette. For data visualization, use the primitive color scales (`--color-blue-*`, `--color-green-*`, `--color-amber-*`, etc.) from `tokens/colors/primitive.css`.

### Primitive Color Families
Available primitive scales in `tokens/colors/primitive.css` (each has 11 shades, `*-50` through `*-950`): neutral / stone / zinc / slate / gray / red / orange / amber / yellow / lime / green / emerald / teal / cyan / sky / blue / indigo / violet / purple / fuchsia / pink / rose. Use these as raw building blocks; prefer semantic tokens for UI surfaces.

## 3. Typography Rules

> Token values defined in `packages/ui/src/styles/tokens/typography.css`. The technical contract is the CSS variable; family-name strings appear here for human readability.

### Font Families
- **Body / Heading**: `var(--font-family-body)` / `var(--font-family-heading)` → primary UI font with system-ui fallbacks. Handles functional UI text.
- **Mono**: use the app mono font stack where code-rendering components define one. Code blocks, terminals, technical content.

### Size Scale

| Role | Token | Approx. value |
|------|-------|--------------|
| Body XS | `var(--font-size-body-xs)` | 12px — tags, badges, timestamps, metadata |
| Body SM | `var(--font-size-body-sm)` | 14px — navigation, secondary labels, captions |
| Body MD | `var(--font-size-body-md)` | 16px — standard body text, form inputs, descriptions |
| Body LG | `var(--font-size-body-lg)` | 18px — emphasized body, sub-headings |
| Heading XS | `var(--font-size-heading-xs)` | 20px — minor section titles |
| Heading SM | `var(--font-size-heading-sm)` | 24px — sub-section headings |
| Heading MD | `var(--font-size-heading-md)` | 32px — section headings |
| Heading LG | `var(--font-size-heading-lg)` | 40px — page titles |
| Heading XL | `var(--font-size-heading-xl)` | 48px — hero headlines |
| Heading 2XL | `var(--font-size-heading-2xl)` | 60px — display / landing |

The full Tailwind text scale is also exposed: `--text-xs` through `--text-9xl` (12px → 128px) for large display contexts.

### Weight System

Three weights are exposed as semantic tokens; the rest of the Tailwind weight utility scale (`font-thin` → `font-black`, including `font-semibold`) is available but not part of the token contract.

| Weight | Token | Usage |
|--------|-------|-------|
| Regular | `var(--font-weight-regular)` (400) | Body text, descriptions, secondary labels |
| Medium | `var(--font-weight-medium)` (500) | Navigation, emphasized body, form labels |
| Bold | `var(--font-weight-bold)` (700) | Page titles, strong emphasis, hero headlines |

### Line Heights

| Token | Approx. value | Usage |
|-------|---------------|-------|
| `var(--line-height-body-xs)` | 20px | Body XS / tight labels |
| `var(--line-height-body-sm)` | 24px | Body SM (14px) |
| `var(--line-height-body-md)` | 24px | Body MD (16px) |
| `var(--line-height-body-lg)` | 28px | Body LG (18px) |
| `var(--line-height-heading-xs)` | 32px | Heading XS (20px) |
| `var(--line-height-heading-sm)` | 40px | Heading SM (24px) |
| `var(--line-height-heading-md)` | 48px | Heading MD (32px) |
| `var(--line-height-heading-lg)` | 60px | Heading LG (40px) |
| `var(--line-height-heading-xl)` | 80px | Heading XL (48px) |

> Heading 2XL (60px) currently has no matching `--line-height-heading-2xl` token. For display contexts using `var(--font-size-heading-2xl)`, set a one-off Tailwind line-height utility (e.g. `leading-[72px]`) until a canonical token is added.

### Paragraph Spacing
`var(--paragraph-spacing-body-{xs|sm|md|lg})` and `var(--paragraph-spacing-heading-{xs|sm|md|lg|xl|2xl})` set vertical rhythm between paragraphs and headings.

### Principles
- **One font handles the entire UI**: lean on the body / heading font aliases everywhere unless rendering code, where the code-rendering component's mono font stack takes over.
- **Medium (500) is the pivot point**: regular for content, medium for structural labels, bold for page-level emphasis.
- **Consistent line-height rhythm**: body at ~1.4–1.5×, headings tighter (~1.0–1.3×).

## 4. Component Stylings

> Padding values use `var(--cs-size-*)` directly because `--spacing-*` is currently kept opt-in in `theme.css` to avoid clobbering Tailwind container utilities. Prefer Tailwind utility classes (`px-4 py-2`) in component code; the `--cs-size-*` references below are the underlying contract.

### Buttons

Source: `Button` from `@cherrystudio/ui` (`packages/ui/src/components/primitives/button.tsx`).

**Base**
- Layout: inline flex, centered, `gap-2`, no wrapping
- Radius / font / motion: `rounded-md`, `font-normal`, `transition-all`
- Disabled: pointer events disabled, `opacity-40`
- Loading: `data-loading=true`, `cursor-progress`, `opacity-40`, spinner before content
- Focus: ring color from `var(--color-ring)` via the shared button primitive

**Default**
- Background: neutral strong action fill as defined in the shared Button primitive (`bg-neutral-900` light / `bg-neutral-100` dark)
- Text: white in light mode, neutral dark in dark mode
- Shadow: `shadow-xs`
- Hover: neutral hover fill (`hover:bg-neutral-800` light / `dark:hover:bg-neutral-200`)
- Use: Main CTAs outside dialogs ("Send", "Save", "Create")

**Outline**
- Background: transparent
- Text: `var(--color-foreground)`
- Border: 1px solid `var(--color-border)`
- Shadow: none
- Hover: fill `var(--color-accent)`
- Use: Secondary or cancel actions that need a visible boundary

**Secondary**
- Background: `var(--color-secondary)`
- Text: `var(--color-secondary-foreground)`
- Radius: `var(--radius-lg)`
- Shadow: none
- Hover: `var(--color-secondary-hover)`
- Use: Secondary actions ("Cancel", "Back", "Export")

**Emphasis**
- Background: neutral strong action fill as defined in the shared Button primitive (`bg-neutral-900` light / `bg-neutral-100` dark)
- Text: white in light mode, neutral dark in dark mode
- Radius: `var(--radius-lg)`
- Shadow: none
- Hover: neutral hover fill (`hover:bg-neutral-800` light / `dark:hover:bg-neutral-200`)
- Use: Primary action inside Dialog footers; visually strong, flatter than default

**Ghost**
- Background: transparent
- Text: neutral foreground
- Shadow: none
- Hover: fill `var(--color-accent)`, text `var(--color-accent-foreground)`
- Active: `var(--color-ghost-active)`
- Use: Toolbar actions, inline actions, icon buttons

**Destructive**
- Background: `var(--color-destructive)`
- Text: white
- Shadow: `shadow-xs`
- Hover: `var(--color-destructive-hover)`
- Use: Dangerous actions ("Delete", "Remove", "Reset")

**Link**
- Background: none
- Text: neutral foreground
- Hover: neutral muted text + underline
- Use: Inline text links, navigation shortcuts

**Sizes**

| Size | Classes | Use |
|------|---------|-----|
| `default` | `min-h-7.5 gap-1.5 px-2.5 text-[13px]` | Standard buttons |
| `sm` | `min-h-7 gap-1.5 px-2.5 text-xs` | Dense controls |
| `lg` | `min-h-9 px-4 text-sm` | Higher-emphasis actions |
| `icon` | `size-9` | Standard icon button |
| `icon-sm` | `size-7` | Dense icon button |
| `icon-lg` | `size-10` | Large icon button |

**Pill** — shape modifier, not a color variant
- Radius: `var(--radius-round)`
- Use: Tags, filters, toggles, tab indicators

**Icon-only buttons and low-emphasis actions**

Public icon-only buttons should use the shared `Button` primitive first: `variant="ghost"` with `size="icon"` or `size="icon-sm"`. They must provide an `aria-label`; add `Tooltip` / `NormalTooltip` when the icon meaning is not obvious.

**Color hierarchy — ask one question first: is this icon the user's primary reason to be on this page?**

- **Yes** → use the Button ghost variant's default text color (no `text-*` override). The icon *is* the action. (The ghost variant currently renders `text-neutral-900 dark:text-neutral-100`.)
- **No, it's a utility shortcut** → mute it with `text-foreground-muted hover:text-foreground` so it recedes at rest and surfaces on hover.

| Case | Color | Example |
|---|---|---|
| Page-primary action in chrome | (Button ghost variant default, no override) | Mini-apps page top-right `+` and menu — the page exists to launch apps; these icons *are* the action. |
| Secondary utility entry | `text-foreground-muted hover:text-foreground` | Translate page top-right history / settings — user came to translate, not to manage history. |
| Toggle while active | `text-foreground` when active; muted otherwise | Panel-toggle icon while its panel is open. |
| Destructive row action | `text-foreground-muted hover:text-destructive` | Delete X next to a custom language row. |

**Rule of thumb:** if an area shows 3+ icon buttons, at most one should sit at the ghost default. The rest are utilities — mute them. Otherwise the eye has no anchor.

**Do not:**
- Apply a heavy `text-foreground` override to every icon button by reflex — the ghost default is for one action per cluster, not all of them.
- Use `text-primary` as a "more emphasis" replacement for the ghost default; `text-primary` is reserved for selected / branded states, not for raising icon weight.

**Row-level patterns**

- Row-level low-emphasis actions are a distinct pattern: copy, edit, delete, favorite, history, and other secondary actions inside dense rows or work surfaces should stay visually quiet by default (`text-foreground-muted`, no static fill or shadow) and only gain emphasis on hover, focus, active, or pressed state.
- Dangerous row actions should not be permanently red. Keep the trigger low-emphasis, then use `ConfirmDialog` plus a destructive confirm button for the actual destructive decision.
- Favorite / starred actions may use an amber active tint only for favorite semantics. Do not reuse that tint for generic active states.
- The translate page currently has a page-local `IconButton` wrapper for this row-level low-emphasis behavior (`xs` / `sm` / `md`, `ghost` / `destructive` / `star`, `active`, built-in tooltip). Treat that as a pattern to promote into a shared `IconButton` if another page needs the same behavior; do not create more page-local copies.

### Button Hover Interaction Summary

Button hover behavior is variant-specific:

| Variant | Hover Fill | Hover Border | Hover Shadow | Text Change |
|---------|-----------|-------------|-------------|-------------|
| Default | neutral hover fill | — | keeps `shadow-xs` | — |
| Outline | `var(--color-accent)` | existing border | none | — |
| Secondary | `var(--color-secondary-hover)` | — | none | — |
| Emphasis | neutral hover fill | — | none | — |
| Ghost | `var(--color-accent)` | — | none | `var(--color-accent-foreground)` |
| Destructive | `var(--color-destructive-hover)` | — | keeps `shadow-xs` | — |
| Link | — | — | none | muted text + underline |

**Hover rules:**
1. Default and destructive buttons keep the base `shadow-xs`.
2. Outline, secondary, emphasis, and ghost buttons are flat (`shadow-none`) at rest and on hover.
3. Link hover adds underline and a text color change only — no background, no shadow.

### Dialogs

Source: `DialogContent` and related primitives from `@cherrystudio/ui` (`packages/ui/src/components/primitives/dialog.tsx`).

**Shell**
- Surface: `bg-card`
- Text: `text-card-foreground`
- Radius: `rounded-3xl`
- Border: none (`border-0`)
- Padding / gap: `p-6`, `gap-4`
- Shadow: `shadow-xl`
- Motion: fade + zoom transitions, `duration-200`

**Layout**
- Overlay: fixed full-window scrim, `z-[80]`, default `bg-black/50`
- Content: fixed centered, `top-[50%] left-[50%]`, translated by `-50%`
- Width: full width with `max-w-[calc(100%-2rem)]`; desktop default `sm:max-w-lg`
- Consumers should use the default overlay first. If the scrim needs local tuning, pass `overlayClassName`; do not rewrite a page-local Dialog shell.

**Structure**
- Header: flex column, `gap-2`, centered on mobile and left-aligned from `sm`
- Title: `text-lg leading-none font-semibold`
- Description: `text-muted-foreground text-sm`
- Footer: mobile `flex-col-reverse`, desktop row with `sm:justify-end`
- Close button: shown by default, absolute `top-4 right-4`, low opacity, higher opacity on hover; hide with `showCloseButton={false}` when the surrounding UI supplies its own close affordance

**Actions**
- Use `Button variant="outline"` for cancel/secondary actions.
- Prefer `Button variant="emphasis"` for new neutral Dialog primary actions; existing dialogs using `default` are acceptable during migration, but new work should not introduce a page-local primary style.
- Use `Button variant="destructive"` for dangerous confirmation actions.
- `ConfirmDialog` currently uses `default` for non-destructive confirms and `destructive` for dangerous confirms. Treat that as a migration-compatible composite, not as a reason to invent page-local Dialog button styles.

**Use Dialog for**
- Centered confirmations, focused form flows, command palettes, and blocking decisions.
- Short-to-medium content that should not feel attached to a page edge.
- Cases where the user must either complete or dismiss the interaction before returning to the page.

### Drawers & Page Side Panels

There are two different drawer patterns. Do not collapse them into one generic "side drawer" rule.

**PageSidePanel** — in-page side panel

Source: `PageSidePanel` from `@cherrystudio/ui` (`packages/ui/src/components/composites/page-side-panel/index.tsx`).

Use `PageSidePanel` for page-owned management surfaces such as mini-app display settings, translate settings, and translate history. The panel is positioned inside the nearest page container while its backdrop blocks the full viewport.

- Backdrop: fixed `inset-0`, `z-[60]`, `bg-black/50`, fades over `0.15s`
- Panel: absolute `top-3 bottom-3`, `right-3` or `left-3`, `z-[70]`
- Size / shell: `w-100`, `rounded-3xl`, `bg-card`, `text-card-foreground`, `shadow-xl`, `overflow-hidden`
- Motion: horizontal slide from the chosen side with spring transition (`damping: 30`, `stiffness: 350`)
- Header: `px-6 pt-6 pb-3`, optional header content plus ghost close button
- Body: shared `Scrollbar`, `space-y-4 px-6 py-4`
- Footer: optional, `px-6 pt-3 pb-6`, for sticky action groups
- Accessibility: role `dialog`, `aria-modal=true`, focus moves into the panel on open and returns to the trigger on close

For standard settings panels, pass `title` instead of custom `header`. This renders the shared title style (`font-semibold text-base text-foreground`). Use custom `header` only when the title area needs richer layout.

Use `PageSidePanelSection` and `PageSidePanelItem` as optional content primitives for settings-style panels. The structure is intentionally three-layered:

1. `PageSidePanel` owns only the floating drawer shell: placement, backdrop, title/close chrome, body scroll, and footer.
2. `PageSidePanelSection` owns a settings group: section title, optional right-aligned low-emphasis actions, and group spacing.
3. `PageSidePanelItem` owns a single setting row: title/description stack, trailing control, and optional expanded content below the row.

Use this full shell → section → item stack for settings drawers such as mini-app display settings and translate settings:

- Section: `flex flex-col gap-3` — this `gap-3` is the rhythm between the section title row, its actions, and the preference row group below; it is **not** the spacing between preference rows themselves.
- Preference row group: wrap the row stack inside the section with an extra `<div className="flex flex-col gap-5">` so individual preference rows breathe more than the title-to-rows gap. Existing callers (`TranslateSettings`, `MiniAppDisplaySettings`) follow this convention.
- Item: title/description stack with a trailing `action`; the trailing control may also expand into an optional `children` slot below the row.
- Related sections should be separated by `gap-8`.
- Do not place repeated cards inside the panel unless each card is a genuine repeated entity.

Do not force `PageSidePanelSection` / `PageSidePanelItem` onto non-settings content. List, history, detail, or picker drawers should still use the shared `PageSidePanel` shell, but their body layout should match the task. For example, translate history uses `PageSidePanel` for the drawer chrome and a custom list/detail/empty-state layout inside the body.

**Drawer primitive** — modal edge drawer

Source: `Drawer` primitives from `@cherrystudio/ui` (`packages/ui/src/components/primitives/drawer.tsx`, Vaul-based).

Use `Drawer` for modal edge/bottom sheets, especially mobile-oriented or full-viewport overlays that are not visually nested inside a page workspace.

- Overlay: fixed `inset-0`, `z-50`, `bg-black/50`
- Content: fixed `z-50`, flex column, `bg-background`
- Top / bottom: full width, `max-h-[80vh]`, border on the attached edge, `rounded-b-lg` or `rounded-t-lg`
- Bottom drawer: includes the built-in centered drag handle (`h-2 w-25 rounded-full bg-muted`)
- Left / right: `inset-y-0`, `w-3/4`, `sm:max-w-sm`, border on the attached edge
- Header: `p-4`, `gap-0.5`, centered for top/bottom and left-aligned from `md`
- Footer: `mt-auto flex flex-col gap-2 p-4`
- Title / description: `font-semibold text-foreground`; `text-sm text-muted-foreground`

`Drawer` uses `bg-background` and edge attachment, not the floating `bg-card rounded-3xl shadow-xl` shell of `PageSidePanel`. New drawer work should use `PageSidePanel` or this shared `Drawer` primitive; legacy `antd` drawers are migration targets, not the design contract.

### Cards

**Standard Card**
- Background: `var(--color-card)`
- Text: `var(--color-card-foreground)`
- Border: 1px solid `var(--color-border)`
- Radius: `var(--radius-lg)` to `var(--radius-xl)`
- Padding: `var(--cs-size-2xs)` to `var(--cs-size-xs)` (16–24px)
- Use: Content containers, conversation panels, settings sections

**Popover / Floating**
- Background: `var(--color-popover)`
- Text: `var(--color-popover-foreground)`
- Border: 0.5px hairline `var(--color-border)`
- Radius: `var(--radius-lg)`
- Shadow: `var(--shadow-lg)`
- Use: Dropdowns, menus, tooltips, command palettes

### Popover

Source: `Popover`, `PopoverTrigger`, `PopoverAnchor`, and `PopoverContent` from `@cherrystudio/ui` (`packages/ui/src/components/primitives/popover.tsx`). Use this as the default floating container for dropdowns, compact action menus, filters, and other trigger-bound transient panels.

**Default `PopoverContent`:**
- Background: `var(--color-popover)`
- Text: `var(--color-popover-foreground)`
- Border: 0.5px hairline `var(--color-border)` (`border-[0.5px]`)
- Radius: `var(--radius-lg)`
- Padding: 16px (`p-4`)
- Width: 288px (`w-72`)
- Shadow: `var(--shadow-lg)` (`shadow-lg`)
- Offset from trigger: 4px
- Z-index: 80

**Compact menu popovers:**
- Keep `PopoverContent` from `@cherrystudio/ui`; override layout density with `w-fit min-w-32 rounded-xl p-1.5`.
- Width is content-driven (`w-fit`), floored at 128px (`min-w-32`) so short menus stay legible. This matches `ContextMenu`'s `min-w-[8rem]` baseline in `packages/ui/src/components/primitives/context-menu.tsx`. Do not hard-code widths like `w-40` / `w-44` — they trap trailing whitespace when labels are shorter than the slot.
- Compose menu bodies with `MenuList` and `MenuItem` from `@cherrystudio/ui`.
- Menu rows should use 32px height (`h-8`), `rounded-lg`, `px-2.5`, and `text-sm`.
- Close the popover after a menu action is selected unless the action intentionally opens an inline sub-flow.
- Do not add page-specific theme scopes to portal popovers unless the whole floating surface is intentionally part of that page-local theme.

**Glass Panel** (floating chrome with backdrop blur)
- Background: use `bg-popover` unless a real translucent token is introduced
- Border: 1px solid `var(--color-border)`
- Backdrop filter: use Tailwind blur utilities directly only when the component is intentionally translucent
- Radius: `var(--radius-lg)` to `var(--radius-xl)`
- Use: Floating toolbars, header bars over scrollable content, tooltips on imagery

### Page-Level Patterns

These patterns reflect the current v2 pages and should be treated as valid design-system usage, not exceptions.

**Tool Gallery / Code Tools**
- Use a focused, centered gallery on `bg-background` with a constrained width (`max-w-5xl` style scale) and responsive card grid.
- Prominent tool-entry cards may use `bg-card`, `border-border`, `p-4`, and `var(--radius-2xl)` to create a launchpad feel without adding shadows.
- Selection should use border/ring feedback (`border-border-active`, `ring-ring`) rather than a new chromatic accent.
- Hero or product icons may be circular (`radius-round`) and use `shadow-lg` only when they behave as a visual anchor, not as repeated card elevation.

**Mini App Launchpad / Settings Drawer**
- The launchpad should stay sparse: small icon buttons in the top action area, centered search, then an app grid with compact launchpad tiles.
- Settings and visibility management belong in `PageSidePanel` with grouped sections and dense list rows. Use the shared `Drawer` primitive only for modal edge/bottom sheets.
- Dense mini-app rows should use `rounded-md`, subtle hover fills, and compact icons; avoid converting every row into a card.

**Translation Workspace**
- Translation input/output panes are work surfaces, not cards. Use full-height `bg-background` panes separated by structure and controls.
- Keep the two-pane workspace flat at rest: no card nesting, no static shadows, no decorative color.
- The main translate/confirm action may use `bg-primary text-primary-foreground`; target-language chips and selected language states may use `bg-primary/10` or `text-primary`.
- File upload/drop states should use dashed semantic borders (`border-border-muted` / hover `border-border-hover`) and muted foreground text.
- Toolbar and copy/clear controls should use ghost/icon-button behavior so text content remains the primary visual focus.

### Inputs

- Background: `var(--color-background)`
- Border: 1px solid `var(--color-input)`
- Radius: `var(--radius-md)` (8px)
- Shadow: none — inputs stay flat at rest; per the depth philosophy, shadows are reserved for hover feedback and floating elements
- Focus ring: use Tailwind ring utilities with `var(--color-ring)` (for example `focus-visible:ring-2 focus-visible:ring-ring/50`)
- Font: `var(--font-family-body)` between `var(--font-size-body-sm)` and `var(--font-size-body-md)`, `var(--font-weight-regular)`
- Placeholder: `var(--color-foreground-muted)`

**Search field with trailing action:**
When a search field needs an inline trailing button (e.g. add provider in `ProviderList`), embed a 24×24 icon button inside the search wrap, after the input:

- Size: 24×24 (`size-6`)
- Radius: 8px (`rounded-[8px]`)
- Idle background: `var(--color-muted)` (`bg-muted`)
- Hover background: `var(--color-surface-hover-soft)`
- Foreground: `var(--color-foreground)` at full opacity
- Disabled: `pointer-events-none opacity-30`

Canonical implementation: `providerListClasses.searchInlineAddButton` in `src/renderer/pages/settings/ProviderSettings/primitives/classNames.ts`. The search wrap itself stays the standard input surface (`bg-background`, hairline border, `rounded-xl`).

### Sidebar

Sidebar primitives currently live in `src/renderer/components/Sidebar`, not in `@cherrystudio/ui`. Treat this section as renderer sidebar guidance until a shared `@cherrystudio/ui` sidebar API exists.

The page owns the outer wrapper (width / Scrollbar / padding). Reusable sidebar internals should own spacing, sizing, and active state so individual pages do not hand-roll divergent menus.

**Colors:**
- Background: `var(--color-sidebar)`
- Text: `var(--color-sidebar-foreground)` for body; `var(--color-foreground-muted)` for SectionTitle
- Border-right (when divider needed): `0.5px solid var(--color-border)`
- Active item: `var(--color-sidebar-accent)` background, `var(--color-sidebar-accent-foreground)` text — **icon color stays `var(--color-sidebar-accent-foreground)` on active (no color change)**
- Hover item: `var(--color-sidebar-accent)` background
- Focus ring: `var(--color-sidebar-ring)`

**Type:**
- Header/title rows: `var(--font-size-body-sm)` / `var(--font-weight-medium)`
- Section labels: `var(--font-size-body-xs)` / `var(--font-weight-regular)`
- Menu item labels: `var(--font-size-body-sm)` / `var(--font-weight-regular)`

**Spacing & sizing (canonical, baked into the components):**

| Relationship | Value | Token |
|---|---|---|
| Header / section label / menu item own height | 32px | `var(--spacing-8)` |
| Horizontal inset on all rows (left/right padding) | 12px | `var(--spacing-3)` |
| Gap between section blocks (Header → first Section, Section → next Section) | 12px | `var(--spacing-3)` |
| Gap **inside** a section (section label → item, item → item) | 4px | `var(--spacing-1)` |
| MenuItem corner radius | 10px | `rounded-[10px]` |
| MenuItem icon size | 16px | `[&_svg]:size-4` |
| MenuItem icon ↔ label gap | 12px | `gap-3` |

**Page-level wrapper guidance (set on the container, NOT on the components):**
- Recommended sidebar column width: 220px
- Recommended container padding: 8px horizontal, 12px vertical (`px-2 py-3`)

> If a sidebar elsewhere needs different spacing, propose a shared renderer variant before hard-coding page-local overrides.
>
> **Target rule:** once the `SidebarHeader / SidebarSection / SidebarSectionTitle / SidebarMenuItem` family lands in `@cherrystudio/ui`, hand-rolled sidebar menus will not be allowed. Until that family ships, compose with `MenuList` + `MenuItem` + project-level className tokens (see `src/renderer/pages/settings/index.tsx` for the canonical token pattern: `settingsSubmenuItemClassName`, `settingsSubmenuItemLabelClassName`, `settingsSubmenuSectionTitleClassName`, `settingsSubmenuDividerClassName`).

### Page Header

Source: `PageHeader` from `@cherrystudio/ui`. The single component for any page or side-panel top title. All settings pages, sidebars, drawers, and content panels that need a heading row **must** use this — never hand-roll `<h2>` with manual padding.

**Anatomy:**
- `title` (required) — heading text, rendered inside an `<h2>` with `truncate` for overflow safety.
- `action` (optional) — right-aligned slot for icon-buttons (filter, add, etc.).

**Type:**
- Title: `var(--font-size-body-sm)` (14px) · `var(--font-weight-medium)` · `leading-4` · `text-foreground`

**Spacing & sizing (baked in — must not be overridden per-page):**

| Relationship | Value | Token |
|---|---|---|
| Bar height | 32px | `h-8` |
| Margin top (gap above) | 12px | `mt-3` |
| Margin bottom (gap below) | 8px | `mb-2` |
| Left padding (title aligns with menu item icon column) | 20px | `pl-5` |
| Right padding (action sits 12px from the column edge) | 12px | `pr-3` |
| Title ↔ action gap | 8px | `gap-2` |

**Rules:**
- Action buttons should be 24×24 (`size-6`); they sit centered inside the 32px bar.
- Title text comes from i18next; do not hard-code strings.
- The asymmetric padding is intentional: `pl-5` (20px) aligns the title's left edge with the icon column of menu items below — wrapper `px-2.5` (10px) + item `px-2.5` (10px) = 20px. Do not change to symmetric padding.
- Two adjacent `PageHeader` instances (left nav + right panel) are guaranteed to be vertically aligned because spacing tokens are identical; the title line box starts 20px from the column top.

### Switch

Source: `Switch` and `DescriptionSwitch` from `@cherrystudio/ui` (`packages/ui/src/components/primitives/switch.tsx`). Current implementation uses a quiet gray off state and a brand/primary on state, matching the settings screenshots.

**Anatomy & sizing:**

| Size | Track | Thumb | Travel | Use |
|------|-------|-------|--------|-----|
| `xs` | 32 × 18 | 16 × 16 | 14px | Dense inline controls |
| `sm` | 36 × 20 | 18 × 18 | 16px | Slightly larger settings rows |
| `md` (default) | 44 × 22 | 19 × 19 | 21px | Standard switch |
| `lg` | 44 × 24 | 20 × 20 | 18px | Hero / marketing surfaces |

**Colors:**

| State | Light | Dark |
|---|---|---|
| Track — off | `bg-gray-500/20` | `bg-gray-500/20` |
| Track — on | `bg-brand-600` | `bg-brand-600` |
| Loading | `bg-brand-300!` | `bg-brand-300!` |
| Thumb glyph | white internal SVG | white internal SVG |

**Other rules:**
- Track carries `shadow-xs`; do not add extra page-local shadow.
- The thumb is rendered by the component's internal white SVG glyph. Do not add custom thumb icons from the call site.
- `loading` state switches root/thumb coloring to `bg-brand-300!` and animates the thumb SVG.
- Focus ring: `focus-visible:ring-[3px] focus-visible:ring-ring/50` (no track border change).

**Don't:**
- Don't pass page-local status colors (`bg-success`, `bg-warning`, etc.) to the track. The component owns its brand on state.
- Don't add inline `style={{ ... }}` overrides for switch dimensions. If a new size is needed, add a variant to `switchRootVariants`/`switchThumbVariants` and document it here.
- Use `<DescriptionSwitch label="..." description="...">` for reusable standalone preference rows. In dense `PageSidePanel` layouts, composing a row label plus a bare `<Switch>` is acceptable when the surrounding row owns spacing and helper text.

## 5. Layout Principles

### Window Chrome

- **Top chrome height**: `var(--app-top-chrome-height)` = 44px. Use this for the main window tab bar and any standalone macOS window top drag area that should visually align with the main app chrome.
- **Navbar content height**: `var(--navbar-height)` defaults to `var(--app-top-chrome-height)`. Only override it for legacy navbar-position modes or inner content calculations that intentionally do not include a top navbar.
- Settings-style floating windows with a transparent macOS shell must keep the outer top inset tied to `var(--app-top-chrome-height)` instead of hard-coded pixel classes such as `h-11` or `h-[50px]`.
- **Settings window sizing** (standalone settings window only): sized to 80% of the main window with a hard floor of 760×560, centered on the main window. The 760×560 floor keeps the ~200px sidebar plus the detail column usable even when the user shrinks the main window. Canonical implementation: `SettingsWindowService` in `src/main/services/SettingsWindowService.ts`.

### Settings Panel Layout

Settings pages (both the in-app `/settings` route and the standalone settings window) share the same two-column shape:

| Column | Width | Composition |
|---|---|---|
| Left submenu | `var(--settings-width)` (200px in the standalone window, 250px default in `responsive.css`) | `PageHeader` (title) → `Scrollbar` → `MenuList` of grouped `MenuItem` rows |
| Right detail | `flex-1` | Page-owned content |

Submenu composition rules:

- Use `PageHeader` from `@cherrystudio/ui` at the top — do not hand-roll a header.
- **Section-title-as-page-title exception**: when a page-level label is itself a *group name* that should match in-list group labels, keep using `PageHeader` and pass `titleClassName="font-normal text-foreground-muted text-xs leading-4"` so the heading swaps to section-title typography while preserving the same 16px line box. The PageHeader's `mt-3 + h-8 + mb-2` outer geometry is preserved, so the label baseline still aligns with the right column's PageHeader heading. See `page-header.stories.tsx` › `SectionTitleStyle` for the canonical example.
- Wrap menu rows in `MenuList` with `gap-1`; group with `MenuDivider` + a section title `<div>` carrying `settingsSubmenuSectionTitleClassName`.
- Each row is a `MenuItem` styled by the canonical settings token pair: `settingsSubmenuItemClassName` on `className` (height / hover / active surface) and `settingsSubmenuItemLabelClassName` on `labelClassName` (`group-data-[active=true]:font-medium` for the bold-on-active label). Both tokens live in `src/renderer/pages/settings/index.tsx`.
- Provider-style nested lists (`ProviderList`) follow the same shape: `PageHeader` + search field with trailing action + scroll body. They use their own scoped tokens in `ProviderSettings/primitives/classNames.ts` but keep the 200px column convention.

### Spacing System

> Defined in `tokens/spacing.css`. The full Tailwind numeric scale (`--spacing-*`) is exposed plus semantic legacy aliases (`--cs-size-*`). In component code prefer Tailwind utilities (`p-4`, `gap-6`); in raw CSS use the tokens below.

**Numeric scale (Tailwind-aligned, 4px base unit):**
- 0, px (1px), 0.5 (2px), 1 (4px), 1.5 (6px), 2 (8px), 2.5 (10px), 3 (12px), 3.5 (14px), 4 (16px), 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96 — exposed as `--spacing-N`.
- Total: 35 numeric tokens covering 0–384px including .5 micro-steps.

**Semantic aliases** (shorthand for component code):

| Token | Approx. value |
|-------|---------------|
| `var(--cs-size-5xs)` | 4px |
| `var(--cs-size-4xs)` | 8px |
| `var(--cs-size-3xs)` | 12px |
| `var(--cs-size-2xs)` | 16px |
| `var(--cs-size-xs)` | 24px |
| `var(--cs-size-sm)` | 32px |
| `var(--cs-size-md)` | 40px |
| `var(--cs-size-lg)` | 48px |
| `var(--cs-size-xl)` | 56px |
| `var(--cs-size-2xl)` | 64px |
| `var(--cs-size-3xl)` | 72px |
| `var(--cs-size-4xl)` | 80px |
| `var(--cs-size-5xl)` | 88px |
| `var(--cs-size-6xl)` | 96px |
| `var(--cs-size-7xl)` | 104px |
| `var(--cs-size-8xl)` | 112px |

### Common Spacing Patterns

| Context | Token range | Tailwind |
|---------|-------------|----------|
| Inline spacing (icon to text) | `var(--cs-size-5xs)` – `var(--cs-size-4xs)` | `gap-1` to `gap-2` |
| Component internal padding | `var(--cs-size-4xs)` – `var(--cs-size-2xs)` | `p-2` to `p-4` |
| Card padding | `var(--cs-size-2xs)` – `var(--cs-size-xs)` | `p-4` to `p-6` |
| Section gaps | `var(--cs-size-xs)` – `var(--cs-size-lg)` | `gap-6` to `gap-12` |
| Page section spacing | `var(--cs-size-lg)` – `var(--cs-size-6xl)` | `py-12` to `py-24` |

### Grid & Container

- Max content widths: Tailwind utilities (`max-w-sm` through `max-w-7xl`)
- Screen breakpoints: Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px)

### Border Radius Scale

> ⚠️ **Cherry remaps the Tailwind default radius scale.** `rounded-md` resolves to 8px (Tailwind default: 6px), `rounded-lg` to 10px (default: 8px), `rounded-xl` to 14px (default: 12px), and `rounded-3xl` to 22px (default: 24px). When copying components from shadcn examples, Tailwind tutorials, or any third-party Tailwind library, expect a 2–4px visual difference until the radius is consciously chosen against the table below.

> Defined in `tokens/radius.css`. 10 levels exposed via `--radius-*`.

| Token | Approx. value | Usage |
|-------|---------------|-------|
| `var(--radius-none)` | 0 | Square corners |
| `var(--radius-xs)` | 2px | Badges, tags |
| `var(--radius-sm)` | 6px | Chips, small buttons |
| `var(--radius-md)` | 8px | **Default** — buttons, inputs, dropdowns |
| `var(--radius-lg)` | 10px | Cards, panels, secondary/emphasis buttons |
| `var(--radius-xl)` | 14px | Large cards, hero sections |
| `var(--radius-2xl)` | 18px | Feature cards, prominent containers |
| `var(--radius-3xl)` | 22px | Dialogs, PageSidePanel, marketing cards, large modals |
| `var(--radius-round)` | 9999px | Pills, avatars, circular buttons |

## 6. Depth & Elevation

Cherry Studio uses a dual depth system: **surface color layering** for structural hierarchy and **box-shadows** for interactive feedback (hover states, floating elements).

### Surface Color Layers

| Level | Token | Use |
|-------|-------|-----|
| Ground (Level 0) | `var(--color-background)` | Page background |
| Surface (Level 1) | `var(--color-card)` | Cards, main panels |
| Raised (Level 2) | `var(--color-popover)` | Popovers, menus, dropdowns |
| Accent (Level 3) | `var(--color-accent)` | Accent/hover backgrounds, tooltips |
| Sidebar (Ambient) | `var(--color-sidebar)` | Sidebar — distinct from main surface |
| Floating panel | `var(--color-popover)` + border/shadow utilities | Dropdowns, popovers, transient chrome |
| Modal scrim | shared Dialog / Drawer / PageSidePanel overlay (`bg-black/50`) | Behind modals, dimmed backdrops |

**Depth Philosophy**: Surface color layering is the primary depth mechanism — `var(--color-border)` separates same-tone surfaces, and in dark mode progressively lighter neutrals create natural stacking. Shadows are reserved for **interactive feedback** (hover states add a small lift) and **floating elements** (popovers, centered Dialogs, and PageSidePanel use medium-to-heavy lift). The Vaul `Drawer` primitive relies on edge attachment and borders rather than the floating card shell. This keeps the interface feeling flat at rest and responsive on interaction.

## 7. Shadow / Blur / Opacity / Border / Stroke

### Shadow

> Shadow utilities are exposed through the Tailwind theme. Treat them as utility-level design tokens.

**Box shadows (7 levels):**

| Token | Use |
|-------|-----|
| `var(--shadow-2xs)` | Subtle dividers, pressed states |
| `var(--shadow-xs)` | **Button hover** — primary interactive feedback |
| `var(--shadow-sm)` | Cards, small floating elements |
| `var(--shadow-md)` | Dropdowns, tooltips |
| `var(--shadow-lg)` | Large floating panels |
| `var(--shadow-xl)` | Dialogs, PageSidePanel, full-screen overlays |
| `var(--shadow-2xl)` | Hero cards, peak emphasis |

### Blur

Use Tailwind blur/backdrop-blur utilities directly when a component intentionally needs blur. There are currently no public `--blur-*` design-token aliases in `@cherrystudio/ui`.

### Opacity

> Use Tailwind opacity utilities or component-level state classes.

Use Tailwind opacity utilities (`opacity-40`, `opacity-70`, etc.) or component-level state classes. There are currently no public `--opacity-*` design-token aliases in `@cherrystudio/ui`.

### Border Width

> Use Tailwind border-width utilities and semantic border color tokens.

Use Tailwind border-width utilities (`border`, `border-0`, `border-2`, etc.) with semantic border colors. There are currently no public `--border-width-*` design-token aliases in `@cherrystudio/ui`.

### Stroke Width

Use icon-library defaults unless a component has a documented reason to override SVG `stroke-width`.

## 8. Do's and Don'ts

### Do
- Use calm, low-saturation chrome — reserve `var(--color-primary)` for true primary actions/selected states and semantic colors for feedback
- Apply `var(--radius-md)` as the base button radius, `var(--radius-lg)` where the Button variant explicitly rounds itself, and `var(--radius-md)` for inputs
- Use `var(--color-primary)` / neutral strong fills for main CTAs; do not introduce page-local brand hues
- Let dark mode feel genuinely dark: `var(--color-background)` resolves to `#0A0A0A` with layered surfaces stacking lighter
- Use `var(--color-foreground-secondary)` / `var(--color-foreground-muted)` for secondary text
- Keep `var(--shadow-xs)` only on button variants that already carry the base shadow (`default`, `destructive`)
- Use `*-hover` tokens or neutral hover classes according to the Button variant definition
- Use `var(--color-accent)` fill for outline and ghost button hover states
- Use semantic color tokens (`var(--color-success)`, `var(--color-warning)`, `var(--color-info)`, `var(--color-destructive)`) for status feedback, toasts, and badges
- Use the full status palettes (`--color-error-bg`, `--color-error-text`, etc. from `tokens/colors/status.css`) for richer status surfaces
- Use `var(--color-border)`, `var(--color-border-muted)`, and `var(--color-border-subtle)` for neutral structure instead of opacity-modified border utilities
- Use the body / heading font aliases at `var(--font-weight-regular)`/`var(--font-weight-medium)` for body and labels, `var(--font-weight-bold)` for page-level emphasis
- Separate spatial zones (sidebar, main, popover) through surface color layering: `var(--color-sidebar)` vs `var(--color-background)` vs `var(--color-popover)`
- Use heading size and line-height tokens directly for new headings
- Use primitive color scales (`--color-blue-*`, `--color-green-*`, etc.) for charts and data visualization
- Apply `var(--radius-round)` specifically for pills, avatars, and circular buttons
- Use `var(--shadow-md)` to `var(--shadow-lg)` for floating elements (popovers, dropdowns, large panels), and `var(--shadow-xl)` for Dialogs or PageSidePanel surfaces that need stronger separation from the dimmed page
- Use shared overlay/floating primitives first; add real exported tokens before documenting new glass or scrim aliases

### Don't
- Don't use shadows for static elevation — reserve shadows for hover feedback and floating elements
- Don't use `var(--radius-xs)` or `var(--radius-sm)` for buttons or cards — `var(--radius-md)`/`var(--radius-lg)` are the button radii in the shared primitive
- Don't use font weights below `var(--font-weight-regular)` for functional UI text — thin/light/extralight weights are display-only
- Don't apply `var(--color-destructive)` to non-dangerous actions — it's reserved for delete/error/warning only
- Don't use `var(--color-success)` / `var(--color-warning)` / `var(--color-info)` for decorative purposes — they carry semantic meaning
- Don't introduce a page-local chromatic brand color — use semantic tokens or primitive chart colors by role
- Don't darken the sidebar to match the main background — its distinct surface via `var(--color-sidebar)` and dedicated palette creates spatial separation
- Don't use `var(--color-popover)` background for cards or vice versa — each elevation level has its specific token
- **Don't hard-code hex / rgba / oklch values** — always reference semantic tokens so light/dark mode works automatically
- Don't use `border-border/60`, `border-border/40`, `border-border/30`, or `border-border/15` — choose a semantic border token instead
- Don't apply `var(--shadow-xl)` or `var(--shadow-2xl)` to standard UI elements — reserve `var(--shadow-xl)` for Dialogs, PageSidePanel, and full-screen overlays, and `var(--shadow-2xl)` for peak display emphasis
- Don't invent token-looking variables such as `--color-glass`, `--color-overlay`, `--blur-md`, `--opacity-50`, or `--border-width-2` unless they are exported by the theme in the same change

## 9. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Sidebar hidden, single-column chat, bottom action bar |
| Tablet | 640–1024px | Collapsible sidebar overlay, condensed spacing |
| Desktop | 1024–1280px | Persistent sidebar + main content area |
| Wide | >1280px | Sidebar + main + optional right panel (settings/info) |

### Collapsing Strategy
- Sidebar: persistent → overlay → hidden (with hamburger toggle)
- Chat layout: full-width with max-width constraint → stacked mobile view
- Card grids: multi-column → 2-column → single-column stacked
- Typography: display sizes scale down ~40% on mobile (48px → 30px)
- Spacing: section gaps compress from 48–96px to 24–48px on mobile
- Navigation: horizontal tabs → bottom bar or hamburger menu

## 10. Agent Prompt Guide

### Quick Token Reference
| Role | Token | Notes |
|------|-------|-------|
| Page background | `var(--color-background)` | `#FFFFFF` light / `#0A0A0A` dark |
| Primary text | `var(--color-foreground)` | Primary body text |
| Secondary / muted text | `var(--color-foreground-secondary)` / `var(--color-foreground-muted)` | Helper, placeholder |
| Primary accent | `var(--color-primary)` | Page-level primary actions, selected states, links, component accents |
| Destructive action | `var(--color-destructive)` | Hover: `var(--color-destructive-hover)`; Text: `var(--color-destructive-foreground)` |
| Success / Warning / Info | `var(--color-success)` / `var(--color-warning)` / `var(--color-info)` | Single-token semantic accents |
| Borders | `var(--color-border)` (hover/active variants available) | Neutral hairline |
| Quiet borders | `var(--color-border-muted)` / `var(--color-border-subtle)` | Dense dividers, nested cards, non-interactive panels |
| Card surface | `var(--color-card)` (text: `--color-card-foreground`) | Layer above background |
| Popover / floating | `var(--color-popover)` (text: `--color-popover-foreground`) | Layer above card |
| Overlay / floating chrome | shared Dialog overlay, `bg-popover`, `border-border`, shadow utilities | Modal scrims, popovers, transient panels |
| Sidebar surface | `var(--color-sidebar)` | Distinct spatial zone with full sub-palette |
| Hover backgrounds | `var(--color-accent)` (outline/default), `var(--color-ghost-hover)` (ghost), `var(--color-secondary-hover)` (secondary) | Choose by variant |
| Status palettes | `var(--color-{error,success,warning,info}-{base,text,bg,border,…})` | See `tokens/colors/status.css` |
| Charts | Primitive scales: `var(--color-blue-500)`, `var(--color-green-500)`, etc. | No dedicated chart palette |
| Shadow | `var(--shadow-xs)` for hover, `var(--shadow-md)` for floating | 7-level scale |

### Example Component Prompts
- "Create a chat interface on `var(--color-background)`. Messages use `var(--font-size-body-md)` `var(--font-weight-regular)`, `var(--line-height-body-md)`, `var(--color-foreground)` text. User messages in cards with `var(--color-secondary)` background and `var(--radius-lg)` border-radius. Primary send button uses the Button `default` variant."
- "Design a sidebar navigation: `var(--color-sidebar)` background, 1px right border `var(--color-sidebar-border)`. Nav items use `var(--font-size-body-sm)` `var(--font-weight-medium)`, `var(--color-sidebar-foreground)` text. Active and hover items use `var(--color-sidebar-accent)` with `var(--color-sidebar-accent-foreground)` text."
- "Build a settings card: `var(--color-card)` background, 1px `var(--color-border)`, `var(--radius-lg)`. Title in `var(--font-size-heading-sm)` with the matching heading line-height. Description in `var(--font-size-body-sm)` `var(--font-weight-regular)`, `var(--color-foreground-secondary)`. Toggles and inputs at `var(--radius-md)`."
- "Create a dark-mode conversation view: `var(--color-background)` page. Message cards on `var(--color-card)`. Assistant code blocks use the code-rendering component's mono font stack at `var(--font-size-body-sm)` on `var(--color-popover)` with `var(--radius-md)`. Borders at `var(--color-border)`."
- "Design a destructive confirmation dialog with the shared Dialog shell: `bg-card`, `text-card-foreground`, `rounded-3xl`, `border-0`, `p-6`, `gap-4`, `shadow-xl`, default overlay. Footer uses outline cancel + destructive delete."
- "Build a page-owned settings side panel with `PageSidePanel`: full-viewport `bg-black/50` backdrop, absolute `top-3 bottom-3 right-3`, `w-100`, `bg-card`, `rounded-3xl`, `shadow-xl`, `title` for the shared `text-base` heading, body `px-6 py-4`, `PageSidePanelSection` groups separated by `gap-8`, and `PageSidePanelItem` rows separated by `gap-5` inside each group. Use only `PageSidePanel` for non-settings history/list/detail drawers, with a task-specific body layout."
- "Build a modal bottom drawer with the shared `Drawer` primitive: `bg-background`, edge-attached bottom content, `max-h-[80vh]`, `rounded-t-lg`, `border-t`, built-in drag handle, header/footer `p-4`. Do not use the floating `PageSidePanel` shell for this."
- "Floating toolbar: `bg-popover`, 1px `var(--color-border)`, `var(--radius-xl)`, `var(--shadow-md)`. Icon buttons inside use the shared `Button` with `variant=\"ghost\"` and `size=\"icon-sm\"`."
- "Dense row actions: use low-emphasis icon-only controls with muted default text, no static fill, tooltip/`aria-label`, hover-only emphasis, and active tint only when the action has persistent state. Promote this pattern into a shared `IconButton` before reusing it across pages."

### Iteration Guide
1. Start from semantic tokens — never hard-code hex / oklch / rgba values.
2. Elevation at rest through surface color layering (`var(--color-background)` → `var(--color-card)` → `var(--color-popover)`); use `var(--shadow-xs)` on hover and `var(--shadow-md)+` for floating elements.
3. Button hover: follow the shared Button variant definitions; only `default` and `destructive` keep the base `shadow-xs`, while outline/secondary/emphasis/ghost remain flat.
4. Public icon-only actions use shared `Button` ghost icon sizes first. For dense row-level low-emphasis actions with tone/active/tooltip behavior, promote a shared `IconButton` before duplicating page-local wrappers.
5. Body / heading font aliases handle UI typography; code-rendering components own mono font stacks.
6. Keep weights at `var(--font-weight-regular)` / `var(--font-weight-medium)` for UI and `var(--font-weight-bold)` for page-level emphasis.
7. `var(--radius-md)` for the base Button and inputs, `var(--radius-lg)` where a Button variant explicitly rounds itself, larger (14px+) for cards, `var(--radius-round)` for pills.
8. Semantic accents: `var(--color-destructive)` for danger, `var(--color-success)` for positive, `var(--color-warning)` for caution, `var(--color-info)` for informational.
9. For richer status surfaces use the full palettes in `tokens/colors/status.css` (e.g. `var(--color-error-bg)` + `var(--color-error-text)` + `var(--color-error-border)`).
10. Charts: use primitive `var(--color-blue-*)` / `var(--color-green-*)` / `var(--color-amber-*)` scales — no dedicated chart palette.
11. Overlay/floating surfaces: use the shared Dialog overlay or `bg-popover` + semantic border + shadow utilities. Add real exported tokens before introducing reusable glass/scrim aliases.
12. New headings: use the `var(--font-size-heading-*)` size tokens with the matching `var(--line-height-heading-*)`.
