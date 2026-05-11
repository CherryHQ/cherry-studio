# Cherry Studio Design System

## 1. Visual Theme & Atmosphere

> **Source of truth:** all token values live in `packages/ui/src/styles/tokens/*.css`. This document references tokens by name; for actual values open the relevant token file.

Cherry Studio is a shadcn/ui-based design system built for an AI conversation application. The design language follows a neutral-first approach — a restrained, systematic palette rooted in pure neutral grays where the interface itself recedes to let content take center stage. The aesthetic is utilitarian-modern: clean surfaces, subtle borders, and a deliberate absence of decorative color in the chrome, creating a tool that feels professional, focused, and endlessly customizable through its robust light/dark mode support.

The typography system is single-track: **Geist** serves as the primary UI font for all functional text, delivering a precise, engineering-grade feel at every size. **Geist Mono** is paired for code and technical content. This single-family approach reflects a product with a unified voice — coherent in conversation, precise in code.

What makes Cherry Studio distinctive is its commitment to a calm UI foundation. Primary actions use `var(--color-primary)` — a mode-inverted neutral (`#171717` light / `#FAFAFA` dark) that is the brand identity itself, not a generic accent layered on top. There is intentionally **no chromatic brand color**. Chromatic departures are reserved exclusively for semantic feedback: `var(--color-destructive)` for dangerous actions, `var(--color-success)` for positive states, `var(--color-warning)` for caution, `var(--color-info)` for informational surfaces. This creates an interface that feels like a high-quality writing tool — think iA Writer meets VS Code — where the user's content is always the most colorful thing on screen.

**Key Characteristics:**
- Calm UI foundation: chrome stays in pure neutrals; chromatic accents reserved for semantic feedback
- Dual-mode system: fully specified light and dark tokens with true inversion (not just darkening)
- Primary action color resolves through `var(--color-primary)` — neutral, mode-inverted (no separate brand hue)
- Full semantic color set: `var(--color-destructive)` (red), `var(--color-success)` (green), `var(--color-warning)` (amber), `var(--color-info)` (blue)
- Status palette pairs (base / text / bg / border, with hover + active variants) defined in `tokens/colors/status.css`
- Border-radius scale from `var(--radius-none)` (0) to `var(--radius-round)` (9999px), 10 steps
- Subtle borders via `var(--color-border)` (semi-transparent neutral) for structure, not decoration
- Surfaces stack via color, not shadow: `var(--color-background)` → `var(--color-card)` → `var(--color-popover)`
- 7-level composite shadow system (`--shadow-2xs` through `--shadow-2xl`) plus inset and drop variants
- Glass / overlay tokens defined: `--color-glass`, `--color-glass-border`, `--color-glass-blur`, `--color-overlay` for floating chrome with `backdrop-filter`
- Sidebar as a distinct spatial zone with its own complete token set: `var(--color-sidebar)`, `var(--color-sidebar-primary)`, `var(--color-sidebar-accent)`, `var(--color-sidebar-border)`

## 2. Color Palette & Roles

> Token values are defined in `packages/ui/src/styles/tokens/colors/{primitive,semantic,status}.css`. This section names what each token is for; refer to the source files for resolved values.

### Primary
- **Primary**: `var(--color-primary)` — main action color (buttons, links, emphasis); resolves to `#171717` light / `#FAFAFA` dark
- **Primary Foreground**: `var(--color-primary-foreground)` — contrast text on primary surfaces (`#FAFAFA` light / `#171717` dark)
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
- **Sidebar Primary / Sidebar Primary Foreground**: `var(--color-sidebar-primary)` / `var(--color-sidebar-primary-foreground)` — active sidebar item
- **Sidebar Accent / Sidebar Accent Foreground**: `var(--color-sidebar-accent)` / `var(--color-sidebar-accent-foreground)` — hover state in sidebar
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
**No dedicated brand color.** The previous `--color-brand-*` scale was deliberately removed. `var(--color-primary)` (mode-inverted neutral) carries the brand identity by being the only consistently-emphasized color in the chrome.

### Links
Links inherit `var(--color-primary)` for color and add an underline on hover. There is no separate `--color-link` token by design — primary is the link color.

### Glass & Overlay (floating chrome)
- **Glass**: `var(--color-glass)` — translucent surface for floating panels (`rgba(255,255,255,0.8)` light / `rgba(10,10,10,0.8)` dark)
- **Glass Border**: `var(--color-glass-border)` — hairline border on glass surfaces
- **Glass Blur**: `var(--color-glass-blur)` — recommended `backdrop-filter: blur()` value (`12px`)
- **Overlay**: `var(--color-overlay)` — modal backdrop scrim (`rgba(0,0,0,0.5)` light / `rgba(0,0,0,0.7)` dark)

### Chart Colors
Not yet defined as a dedicated palette. For data visualization, use the primitive color scales (`--color-blue-*`, `--color-green-*`, `--color-amber-*`, etc.) from `tokens/colors/primitive.css`.

### Primitive Color Families
Available primitive scales in `tokens/colors/primitive.css` (each has 11 shades, `*-50` through `*-950`): neutral / stone / zinc / slate / gray / red / orange / amber / yellow / lime / green / emerald / teal / cyan / sky / blue / indigo / violet / purple / fuchsia / pink / rose. Use these as raw building blocks; prefer semantic tokens for UI surfaces.

## 3. Typography Rules

> Token values defined in `packages/ui/src/styles/tokens/typography.css`. The technical contract is the CSS variable; family-name strings appear here for human readability.

### Font Families
- **Sans / Body / Heading**: `var(--font-family-sans)` (= `--font-family-body` = `--font-family-heading`) → **Geist** with system-ui fallbacks. Handles 100% of UI text.
- **Mono**: `var(--font-family-mono)` → **Geist Mono** with system mono fallbacks. Code blocks, terminals, technical content.
- **Serif**: `var(--font-family-serif)` → Georgia / Cambria / Times. Reserved for long-form reading contexts; not used in chrome.

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

### Weight System (full 9-step scale)

| Weight | Token | Usage |
|--------|-------|-------|
| Thin | `var(--font-weight-thin)` (100) | Display only |
| ExtraLight | `var(--font-weight-extralight)` (200) | Display only |
| Light | `var(--font-weight-light)` (300) | Editorial, large display |
| Regular | `var(--font-weight-regular)` (400) | Body text, descriptions, secondary labels |
| Medium | `var(--font-weight-medium)` (500) | Navigation, emphasized body, form labels |
| Semibold | `var(--font-weight-semibold)` (600) | Section headings, button text, structural emphasis |
| Bold | `var(--font-weight-bold)` (700) | Page titles, strong emphasis, hero headlines |
| ExtraBold | `var(--font-weight-extrabold)` (800) | Display only |
| Black | `var(--font-weight-black)` (900) | Display only |

### Line Heights

| Token | Approx. value | Usage |
|-------|---------------|-------|
| `var(--line-height-body-xs)` | 16px | Body XS / tight labels |
| `var(--line-height-body-sm)` | 20px | Body SM (14px) |
| `var(--line-height-body-md)` | 24px | Body MD (16px) |
| `var(--line-height-body-lg)` | 28px | Body LG (18px) |
| `var(--line-height-heading-xs)` | 28px | Heading XS (20px) |
| `var(--line-height-heading-sm)` | 32px | Heading SM (24px) |
| `var(--line-height-heading-md)` | 36px | Heading MD (32px) |
| `var(--line-height-heading-lg)` | 40px | Heading LG (40px) |
| `var(--line-height-heading-xl)` | 48px | Heading XL (48px) |
| `var(--line-height-heading-2xl)` | 60px | Heading 2XL (60px) |

### Letter Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `var(--letter-spacing-tighter)` | -0.05em | Display headings (≥48px) |
| `var(--letter-spacing-tight)` | -0.025em | Headings (≥24px) |
| `var(--letter-spacing-normal)` | 0em | Default body |
| `var(--letter-spacing-wide)` | 0.025em | Subtle emphasis |
| `var(--letter-spacing-wider)` | 0.05em | Small caps, labels |
| `var(--letter-spacing-widest)` | 0.1em | UPPERCASE LABELS |

### Heading Presets (composed)

Four composed heading presets bundle font-family + size + weight + line-height + letter-spacing into a single token group. Use these for new headings to guarantee consistent typography.

| Preset | Use | Tokens |
|--------|-----|--------|
| `heading-sm` | Small section title (~30px) | `var(--heading-sm-font-family)` · `--heading-sm-font-size` · `--heading-sm-font-weight` · `--heading-sm-line-height` · `--heading-sm-letter-spacing` |
| `heading-md` | Main section title (~36px) | same shape with `heading-md-*` |
| `heading-lg` | Page title (~48px) | same shape with `heading-lg-*` |
| `heading-xl` | Hero / display (~60px) | same shape with `heading-xl-*` |

All presets ship with bold (700) weight and progressively tighter letter-spacing as the size grows.

### Paragraph Spacing
`var(--paragraph-spacing-body-{xs|sm|md|lg})` and `var(--paragraph-spacing-heading-{xs|sm|md|lg|xl|2xl})` set vertical rhythm between paragraphs and headings.

### Principles
- **One font handles the entire UI**: lean on `var(--font-family-sans)` (Geist) everywhere unless rendering code, where `var(--font-family-mono)` (Geist Mono) takes over.
- **Medium (500) is the pivot point**: regular for content, medium for structural labels, semibold for headings/buttons, bold for page-level emphasis.
- **Consistent line-height rhythm**: body at ~1.4–1.5×, headings tighter (~1.0–1.3×).
- **Negative tracking for headings**: use `letter-spacing-tight` at 24px+, `letter-spacing-tighter` at 48px+.

## 4. Component Stylings

> Padding values use `var(--cs-size-*)` directly because `--spacing-*` is currently kept opt-in in `theme.css` to avoid clobbering Tailwind container utilities. Prefer Tailwind utility classes (`px-4 py-2`) in component code; the `--cs-size-*` references below are the underlying contract.

### Buttons

**Primary**
- Background: `var(--color-primary)`
- Text: `var(--color-primary-foreground)`
- Radius: `var(--radius-lg)` (10px)
- Padding: `var(--cs-size-2xs)` horizontal, `var(--cs-size-4xs)` vertical
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: `var(--color-primary-hover)` + `var(--shadow-xs)`
- Use: Main CTAs ("Send", "Save", "Create")

**Default / Outline**
- Background: transparent
- Text: `var(--color-foreground)`
- Border: 1px solid `var(--color-border)`
- Radius: `var(--radius-lg)`
- Padding: `var(--cs-size-2xs)` horizontal, `var(--cs-size-4xs)` vertical
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: fill `var(--color-accent)` + border `var(--color-border-hover)` + `var(--shadow-xs)`
- Use: Standard actions, form submissions

**Secondary**
- Background: `var(--color-secondary)`
- Text: `var(--color-secondary-foreground)`
- Radius: `var(--radius-lg)`
- Padding: `var(--cs-size-2xs)` horizontal, `var(--cs-size-4xs)` vertical
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: `var(--color-secondary-hover)` + `var(--shadow-xs)`
- Use: Secondary actions ("Cancel", "Back", "Export")

**Ghost**
- Background: transparent
- Text: `var(--color-foreground)`
- Radius: `var(--radius-lg)`
- Padding: `var(--cs-size-2xs)` horizontal, `var(--cs-size-4xs)` vertical
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: fill `var(--color-ghost-hover)` + `var(--shadow-xs)`
- Active: `var(--color-ghost-active)`
- Use: Toolbar actions, inline actions, icon buttons

**Destructive**
- Background: `var(--color-destructive)`
- Text: `var(--color-destructive-foreground)`
- Radius: `var(--radius-lg)`
- Padding: `var(--cs-size-2xs)` horizontal, `var(--cs-size-4xs)` vertical
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: `var(--color-destructive-hover)` + `var(--shadow-xs)`
- Use: Dangerous actions ("Delete", "Remove", "Reset")

**Link**
- Background: none
- Text: `var(--color-primary)`
- Font: `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`
- Hover: underline decoration
- Use: Inline text links, navigation shortcuts

**Pill**
- Radius: `var(--radius-round)`
- Use: Tags, filters, toggles, tab indicators

### Button Hover Interaction Summary

All button hover states share a consistent pattern:

| Variant | Hover Fill | Hover Border | Hover Shadow | Text Change |
|---------|-----------|-------------|-------------|-------------|
| Primary | `var(--color-primary-hover)` | — | `var(--shadow-xs)` | — |
| Default/Outline | `var(--color-accent)` | `var(--color-border-hover)` | `var(--shadow-xs)` | — |
| Secondary | `var(--color-secondary-hover)` | — | `var(--shadow-xs)` | — |
| Ghost | `var(--color-ghost-hover)` | — | `var(--shadow-xs)` | — |
| Destructive | `var(--color-destructive-hover)` | — | `var(--shadow-xs)` | — |
| Link | — | — | — | + underline |

**Hover rules:**
1. Solid-fill buttons (Primary, Secondary, Destructive) swap to a `*-hover` token to reveal subtle depth.
2. Transparent buttons (Default, Outline, Ghost) gain a fill on hover (`--color-accent` / `--color-ghost-hover`) to show activation.
3. All buttons except Link gain a hover lift via `var(--shadow-xs)`.
4. Link hover adds underline only — no background, no shadow.

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
- Border: 1px solid `var(--color-border)`
- Radius: `var(--radius-lg)`
- Use: Dropdowns, menus, tooltips, command palettes

**Glass Panel** (floating chrome with backdrop blur)
- Background: `var(--color-glass)`
- Border: 1px solid `var(--color-glass-border)`
- Backdrop filter: `blur(var(--color-glass-blur))`
- Radius: `var(--radius-lg)` to `var(--radius-xl)`
- Use: Floating toolbars, header bars over scrollable content, tooltips on imagery

### Inputs

- Background: `var(--color-background)`
- Border: 1px solid `var(--color-input)`
- Radius: `var(--radius-md)` (8px)
- Focus ring: `var(--border-width-2)` `var(--color-ring)`
- Font: `var(--font-family-sans)` between `var(--font-size-body-sm)` and `var(--font-size-body-md)`, `var(--font-weight-regular)`
- Placeholder: `var(--color-foreground-muted)`

### Sidebar

**Building blocks** — use these from `@cherrystudio/ui`; do not re-implement:
`SidebarHeader` (page title) · `SidebarSection` (group container) · `SidebarSectionTitle` (group label) · `SidebarMenuItem` (icon-prefixed nav row).

The page owns the outer wrapper (width / Scrollbar / padding). Internal spacing, sizing, and active state are baked into the components and **must not be overridden per-page**.

**Colors:**
- Background: `var(--color-sidebar)`
- Text: `var(--color-sidebar-foreground)` for body; `var(--color-foreground-muted)` for SectionTitle
- Border-right (when divider needed): `0.5px solid var(--color-border)`
- Active item: `var(--color-secondary)` background, `var(--color-foreground)` text — **icon color stays `var(--color-foreground)` on active (no color change)**
- Hover item: `var(--color-secondary)` background
- Focus ring: `var(--color-sidebar-ring)`

**Type:**
- SidebarHeader: `var(--font-size-body-sm)` / `var(--font-weight-medium)`
- SidebarSectionTitle: `var(--font-size-body-xs)` / `var(--font-weight-regular)`
- SidebarMenuItem label: `var(--font-size-body-sm)` / `var(--font-weight-regular)`

**Spacing & sizing (canonical, baked into the components):**

| Relationship | Value | Token |
|---|---|---|
| Header / SectionTitle / MenuItem own height | 32px | `var(--spacing-8)` |
| Horizontal inset on all rows (left/right padding) | 12px | `var(--spacing-3)` |
| Gap between section blocks (Header → first Section, Section → next Section) | 12px | `var(--spacing-3)` |
| Gap **inside** a section (SectionTitle → Item, Item → Item) | 4px | `var(--spacing-1)` |
| MenuItem corner radius | 10px | `rounded-[10px]` |
| MenuItem icon size | 16px | `[&_svg]:size-4` |
| MenuItem icon ↔ label gap | 12px | `gap-3` |

**Page-level wrapper guidance (set on the container, NOT on the components):**
- Recommended sidebar column width: 220px
- Recommended container padding: 8px horizontal, 12px vertical (`px-2 py-3`)

> If a sidebar elsewhere needs different spacing, propose a new variant before hard-coding overrides. Hand-rolled sidebar menus that do not use `SidebarMenu` components are not allowed in v2.

### Switch

Source: `Switch` and `DescriptionSwitch` from `@cherrystudio/ui` (`packages/ui/src/components/primitives/switch.tsx`). Spec aligns with Figma node 298:4402 — neutral pill track with a clean white thumb, no inner mark, no shadow.

**Anatomy & sizing:**

| Size | Track | Thumb | Travel | Use |
|------|-------|-------|--------|-----|
| `xs` (default) | 30 × 18 | 16 × 16 | 12px | Standard switch — use everywhere unless a specific reason calls for a larger one |
| `sm` | 36 × 20 | 18 × 18 | 16px | Slightly larger settings rows |
| `md` | 44 × 22 | 19 × 19 | 21px | Legacy-only — do not use in new code |
| `lg` | 44 × 24 | 20 × 20 | 18px | Hero / marketing surfaces |

**Colors:**

| State | Light | Dark |
|---|---|---|
| Track — off | `bg-neutral-200` (#E5E5E5) | `bg-neutral-700` |
| Track — on | `bg-neutral-900` (#171717) | `bg-neutral-100` |
| Thumb (any state) | `bg-white` | `bg-white` |
| Loading spinner color | `text-neutral-400` | inherited |

**Other rules:**
- No `box-shadow` on track or thumb — Figma is shadow-less.
- No decorative SVG / icon inside the thumb in resting state. The thumb is a clean white circle.
- `loading` state replaces the thumb's content with a `lucide-react` `<Loader>` spinner sized to the variant (10–14px). Track also gains `cursor-progress` and `opacity-70`.
- Focus ring: `focus-visible:ring-[3px] focus-visible:ring-ring/50` (no track border change).

**Don't:**
- Don't pass brand or status colors (`bg-brand-*`, `bg-success`, etc.) to the track. Switches are neutral; semantic state lives in surrounding text/icons.
- Don't add inline `style={{ ... }}` overrides for switch dimensions. If a new size is needed, add a variant to `switchRootVariants`/`switchThumbVariants` and document it here.
- Don't put labels next to a bare `<Switch>` by hand. Use `<DescriptionSwitch label="..." description="...">` — it owns the typography ramp and label/description spacing.

## 5. Layout Principles

### Window Chrome

- **Top chrome height**: `var(--app-top-chrome-height)` = 44px. Use this for the main window tab bar and any standalone macOS window top drag area that should visually align with the main app chrome.
- **Navbar content height**: `var(--navbar-height)` defaults to `var(--app-top-chrome-height)`. Only override it for legacy navbar-position modes or inner content calculations that intentionally do not include a top navbar.
- Settings-style floating windows with a transparent macOS shell must keep the outer top inset tied to `var(--app-top-chrome-height)` instead of hard-coded pixel classes such as `h-11` or `h-[50px]`.

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

> Defined in `tokens/radius.css`. 10 levels exposed via `--radius-*`.

| Token | Approx. value | Usage |
|-------|---------------|-------|
| `var(--radius-none)` | 0 | Square corners |
| `var(--radius-xs)` | 2px | Badges, tags |
| `var(--radius-sm)` | 6px | Chips, small buttons |
| `var(--radius-md)` | 8px | **Default** — buttons, inputs, dropdowns |
| `var(--radius-lg)` | 10px | Cards, panels, dialogs |
| `var(--radius-xl)` | 14px | Large cards, hero sections |
| `var(--radius-2xl)` | 18px | Feature cards, prominent containers |
| `var(--radius-3xl)` | 22px | Marketing cards, large modals |
| `var(--radius-4xl)` | 26px | Display surfaces |
| `var(--radius-round)` | 9999px | Pills, avatars, circular buttons |

## 6. Depth & Elevation

Cherry Studio uses a dual depth system: **surface color layering** for structural hierarchy and **box-shadows** for interactive feedback (hover states, floating elements).

### Surface Color Layers

| Level | Token | Use |
|-------|-------|-----|
| Ground (Level 0) | `var(--color-background)` | Page background |
| Surface (Level 1) | `var(--color-card)` | Cards, main panels |
| Raised (Level 2) | `var(--color-popover)` | Popovers, menus, dropdowns |
| Overlay (Level 3) | `var(--color-accent)` | Accent/hover backgrounds, tooltips |
| Sidebar (Ambient) | `var(--color-sidebar)` | Sidebar — distinct from main surface |
| Floating glass | `var(--color-glass)` + `backdrop-filter` | Translucent floating chrome |
| Modal scrim | `var(--color-overlay)` | Behind modals, dimmed backdrops |

**Depth Philosophy**: Surface color layering is the primary depth mechanism — `var(--color-border)` separates same-tone surfaces, and in dark mode progressively lighter neutrals create natural stacking. Shadows are reserved for **interactive feedback** (hover states add a small lift) and **floating elements** (popovers, modals use medium-to-heavy lift). This keeps the interface feeling flat at rest and responsive on interaction.

## 7. Shadow / Blur / Opacity / Border / Stroke

### Shadow

> Defined in `tokens/shadow.css`. Three families: box-shadow, inset-shadow, drop-shadow. All values are composite (multiple shadow layers per token) for natural depth.

**Box shadows (7 levels):**

| Token | Use |
|-------|-----|
| `var(--shadow-2xs)` | Subtle dividers, pressed states |
| `var(--shadow-xs)` | **Button hover** — primary interactive feedback |
| `var(--shadow-sm)` | Cards, small floating elements |
| `var(--shadow-md)` | Dropdowns, tooltips |
| `var(--shadow-lg)` | Modals, large panels |
| `var(--shadow-xl)` | Full-screen overlays |
| `var(--shadow-2xl)` | Hero cards, peak emphasis |

**Inset shadows (5 levels):** `var(--inset-shadow-2xs)` · `var(--inset-shadow-xs)` · `var(--inset-shadow-sm)` · `var(--inset-shadow-md)` · `var(--inset-shadow-lg)` — for pressed inputs, sunken areas.

**Drop shadows (6 levels):** `var(--drop-shadow-xs)` through `var(--drop-shadow-2xl)` — `filter: drop-shadow()` variants for SVGs, irregular shapes.

### Blur

> Defined in `tokens/blur.css`. Backdrop-filter / filter blur radii.

| Token | Value | Use |
|-------|-------|-----|
| `var(--blur-xs)` | 4px | Subtle glass |
| `var(--blur-sm)` | 8px | Light glass |
| `var(--blur-md)` | 12px | **Default** glass / overlay (matches `--color-glass-blur`) |
| `var(--blur-lg)` | 16px | Heavier glass |
| `var(--blur-xl)` | 24px | Backdrop dim |
| `var(--blur-2xl)` | 40px | Modal background |
| `var(--blur-3xl)` | 64px | Maximum diffuse |

### Opacity

> Defined in `tokens/opacity.css`. 21-step scale, 0–100% in 5% increments.

`var(--opacity-0)` (0%) → `var(--opacity-5)` (5%) → … → `var(--opacity-100)` (100%). Use for disabled states, hover dimming, semi-transparent overlays.

### Border Width

> Defined in `tokens/border-width.css`. 8 steps.

| Token | Value | Use |
|-------|-------|-----|
| `var(--border-width-0)` | 0 | No border |
| `var(--border-width-default)` | 1px | **Default** — component edges, dividers, input outlines |
| `var(--border-width-2)` | 2px | Focus rings, emphasis |
| `var(--border-width-3)` | 3px | Heavy emphasis |
| `var(--border-width-4)` | 4px | — |
| `var(--border-width-5)` | 5px | — |
| `var(--border-width-6)` | 6px | — |
| `var(--border-width-8)` | 8px | Decorative / display |

### Stroke Width

> Defined in `tokens/stroke-width.css`. 12 steps for SVG `stroke-width` and icon line weight.

`var(--stroke-width-0)` through `var(--stroke-width-10)` including .5 micro-steps (`--stroke-width-1-5`, `--stroke-width-2-5`, `--stroke-width-3-5`). Default icon stroke is `var(--stroke-width-2)` (2px).

## 8. Do's and Don'ts

### Do
- Use a calm, low-saturation chrome — chromatic accents are reserved for semantic feedback
- Apply `var(--radius-lg)` as the default for buttons, `var(--radius-md)` for inputs
- Use `var(--color-primary)` for main CTAs — the brand identity is intentional and mode-inverted
- Let dark mode feel genuinely dark: `var(--color-background)` resolves to `#0A0A0A` with layered surfaces stacking lighter
- Use `var(--color-foreground-secondary)` / `var(--color-foreground-muted)` for secondary text
- Use `var(--shadow-xs)` on button hover states for tactile feedback
- Use `*-hover` tokens (e.g. `var(--color-secondary-hover)`) on solid-fill button hover to indicate interaction
- Use `var(--color-accent)` / `var(--color-ghost-hover)` fill for transparent button hover (Default, Outline, Ghost)
- Use semantic color tokens (`var(--color-success)`, `var(--color-warning)`, `var(--color-info)`, `var(--color-destructive)`) for status feedback, toasts, and badges
- Use the full status palettes (`--color-error-bg`, `--color-error-text`, etc. from `tokens/colors/status.css`) for richer status surfaces
- Use `var(--color-border)`, `var(--color-border-muted)`, and `var(--color-border-subtle)` for neutral structure instead of opacity-modified border utilities
- Use `var(--font-family-sans)` (Geist) at `var(--font-weight-regular)`/`var(--font-weight-medium)` for body, `var(--font-weight-semibold)`/`var(--font-weight-bold)` for headings
- Separate spatial zones (sidebar, main, popover) through surface color layering: `var(--color-sidebar)` vs `var(--color-background)` vs `var(--color-popover)`
- Use the heading presets (`heading-sm/md/lg/xl`) for new headings — they bundle font / size / weight / line-height / letter-spacing consistently
- Use primitive color scales (`--color-blue-*`, `--color-green-*`, etc.) for charts and data visualization
- Apply `var(--radius-round)` specifically for pills, avatars, and circular buttons
- Use `var(--shadow-md)` to `var(--shadow-lg)` for floating elements (popovers, modals, dropdowns)
- Use glass tokens (`--color-glass` + `backdrop-filter: blur(var(--color-glass-blur))`) for translucent floating chrome

### Don't
- Don't use shadows for static elevation — reserve shadows for hover feedback and floating elements
- Don't use `var(--radius-xs)` or `var(--radius-sm)` for buttons or cards — `var(--radius-lg)` is the button standard
- Don't use font weights below `var(--font-weight-regular)` for functional UI text — thin/light/extralight weights are display-only
- Don't apply `var(--color-destructive)` to non-dangerous actions — it's reserved for delete/error/warning only
- Don't use `var(--color-success)` / `var(--color-warning)` / `var(--color-info)` for decorative purposes — they carry semantic meaning
- Don't introduce a chromatic brand color — the design intentionally has none. Primary is neutral.
- Don't darken the sidebar to match the main background — its distinct surface via `var(--color-sidebar)` and dedicated palette creates spatial separation
- Don't use `var(--color-popover)` background for cards or vice versa — each elevation level has its specific token
- **Don't hard-code hex / rgba / oklch values** — always reference semantic tokens so light/dark mode works automatically
- Don't use `border-border/60`, `border-border/40`, `border-border/30`, or `border-border/15` — choose a semantic border token instead
- Don't apply `var(--shadow-xl)` or `var(--shadow-2xl)` to standard UI elements — heavy shadows break the flat aesthetic

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
| Primary action | `var(--color-primary)` | Hover: `var(--color-primary-hover)`; Text: `var(--color-primary-foreground)` |
| Destructive action | `var(--color-destructive)` | Hover: `var(--color-destructive-hover)`; Text: `var(--color-destructive-foreground)` |
| Success / Warning / Info | `var(--color-success)` / `var(--color-warning)` / `var(--color-info)` | Single-token semantic accents |
| Borders | `var(--color-border)` (hover/active variants available) | Neutral hairline |
| Quiet borders | `var(--color-border-muted)` / `var(--color-border-subtle)` | Dense dividers, nested cards, non-interactive panels |
| Card surface | `var(--color-card)` (text: `--color-card-foreground`) | Layer above background |
| Popover / floating | `var(--color-popover)` (text: `--color-popover-foreground`) | Layer above card |
| Glass / overlay | `var(--color-glass)` + `backdrop-filter: blur(var(--color-glass-blur))` / `var(--color-overlay)` | Translucent chrome / modal scrim |
| Sidebar surface | `var(--color-sidebar)` | Distinct spatial zone with full sub-palette |
| Hover backgrounds | `var(--color-accent)` (outline/default), `var(--color-ghost-hover)` (ghost), `var(--color-secondary-hover)` (secondary) | Choose by variant |
| Status palettes | `var(--color-{error,success,warning,info}-{base,text,bg,border,…})` | See `tokens/colors/status.css` |
| Charts | Primitive scales: `var(--color-blue-500)`, `var(--color-green-500)`, etc. | No dedicated chart palette |
| Heading preset | `var(--heading-{sm,md,lg,xl}-*)` | Composed: font/size/weight/line-height/letter-spacing |
| Shadow | `var(--shadow-xs)` for hover, `var(--shadow-md)` for floating | 7-level scale |
| Blur | `var(--blur-md)` (12px) default for glass | 7-level scale |

### Example Component Prompts
- "Create a chat interface on `var(--color-background)`. Messages in `var(--font-family-sans)` `var(--font-size-body-md)` `var(--font-weight-regular)`, `var(--line-height-body-md)`, `var(--color-foreground)` text. User messages in cards with `var(--color-secondary)` background and `var(--radius-lg)` border-radius. Primary send button on `var(--color-primary)` with `var(--color-primary-foreground)` text and `var(--radius-md)` radius."
- "Design a sidebar navigation: `var(--color-sidebar)` background, 1px right border `var(--color-sidebar-border)`. Nav items in `var(--font-family-sans)` `var(--font-size-body-sm)` `var(--font-weight-medium)`, `var(--color-sidebar-foreground)` text. Active item on `var(--color-sidebar-primary)` with `var(--color-sidebar-primary-foreground)` text. Hover state on `var(--color-sidebar-accent)`."
- "Build a settings card: `var(--color-card)` background, 1px `var(--color-border)`, `var(--radius-lg)`. Title using the `heading-sm` preset. Description in `var(--font-size-body-sm)` `var(--font-weight-regular)`, `var(--color-foreground-secondary)`. Toggles and inputs at `var(--radius-md)`."
- "Create a dark-mode conversation view: `var(--color-background)` page (#0A0A0A). Message cards on `var(--color-card)`. Assistant code blocks in `var(--font-family-mono)` (Geist Mono) at `var(--font-size-body-sm)` on `var(--color-popover)` with `var(--radius-md)`. Borders at `var(--color-border)`."
- "Design a destructive confirmation dialog floating over `var(--color-overlay)` scrim. Dialog body on `var(--color-popover)` with `var(--radius-lg)` and `var(--shadow-lg)`. Warning text in `var(--font-size-body-sm)`, `var(--color-destructive)`. Two buttons: secondary (Cancel) on `var(--color-secondary)`, destructive (Delete) on `var(--color-destructive)` with `var(--color-destructive-foreground)` text."
- "Floating glass toolbar: `var(--color-glass)` with `backdrop-filter: blur(var(--color-glass-blur))`, 1px `var(--color-glass-border)`, `var(--radius-xl)`, `var(--shadow-md)`. Icon buttons inside use Ghost variant."

### Iteration Guide
1. Start from semantic tokens — never hard-code hex / oklch / rgba values.
2. Elevation at rest through surface color layering (`var(--color-background)` → `var(--color-card)` → `var(--color-popover)`); use `var(--shadow-xs)` on hover and `var(--shadow-md)+` for floating elements.
3. Button hover: solid-fill buttons swap to a `*-hover` token, transparent buttons gain `var(--color-accent)` / `var(--color-ghost-hover)` fill, all add a small lift via `var(--shadow-xs)`.
4. `var(--font-family-sans)` (Geist) handles all UI typography; `var(--font-family-mono)` (Geist Mono) for code only.
5. Keep weights at `var(--font-weight-regular)` / `var(--font-weight-medium)` for UI; `var(--font-weight-semibold)` for headings/structural emphasis; `var(--font-weight-bold)` only for page-level titles.
6. `var(--radius-lg)` for buttons, `var(--radius-md)` for inputs, larger (14px+) for cards, `var(--radius-round)` for pills.
7. Semantic accents: `var(--color-destructive)` for danger, `var(--color-success)` for positive, `var(--color-warning)` for caution, `var(--color-info)` for informational.
8. For richer status surfaces use the full palettes in `tokens/colors/status.css` (e.g. `var(--color-error-bg)` + `var(--color-error-text)` + `var(--color-error-border)`).
9. Charts: use primitive `var(--color-blue-*)` / `var(--color-green-*)` / `var(--color-amber-*)` scales — no dedicated chart palette.
10. Glass / overlay surfaces: `var(--color-glass)` + `backdrop-filter: blur(var(--color-glass-blur))`. Modal scrim: `var(--color-overlay)`.
11. New headings: prefer the composed `heading-{sm,md,lg,xl}-*` token group over piecing together font/size/weight/line-height by hand.
