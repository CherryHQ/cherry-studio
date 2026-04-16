# Design System Inspired by Cherry Studio

## 1. Visual Theme & Atmosphere

Cherry Studio is a shadcn/ui-based design system built for an AI conversation application. The design language follows a neutral-first approach — a restrained, systematic palette rooted in the neutral gray scale where the interface itself recedes to let content take center stage. The aesthetic is utilitarian-modern: clean surfaces, subtle borders, and a deliberate absence of decorative color in the chrome, creating a tool that feels professional, focused, and endlessly customizable through its robust light/dark mode support.

The typography system is purposefully dual-track: Inter serves as the primary UI font for all functional text, delivering maximum legibility at small sizes, while Nunito Sans provides a softer, friendlier alternative for sans-serif contexts. For code and technical content, Geist Mono is the primary monospace font with JetBrains Mono as the programming-focused alternative. This pairing reflects a product that serves both casual users and developers — approachable in conversation, precise in code.

What makes Cherry Studio distinctive is its commitment to the neutral spectrum as the entire UI foundation. Primary actions use near-black (`#171717`) in light mode and near-white (`#e5e5e5`) in dark mode — the brand identity IS the grayscale itself, not an accent color layered on top. The only chromatic departure is `destructive` red for dangerous actions and a Radix blue chart palette for data visualization. This creates an interface that feels like a high-quality writing tool — think iA Writer meets VS Code — where the user's content is always the most colorful thing on screen.

**Key Characteristics:**
- Neutral-first palette: the entire UI chrome lives within the neutral gray scale
- Dual-mode system: fully specified light and dark tokens with true inversion (not just darkening)
- Primary = near-black/near-white (mode-inverted), not a brand color
- Full semantic color set: destructive (red), success (green), warning (amber), info (blue)
- Brand accent from Radix blue/9 (`#0090ff`) for charts, sidebar highlights, and links
- Dual-track typography: Inter (UI) + Nunito Sans (friendly), Geist Mono + JetBrains Mono (code)
- Generous border-radius scale from 2px (xs) to 9999px (full pill)
- Subtle borders (`#e5e5e5` light / `#404040` dark) for structure, not decoration
- Card surfaces slightly elevated from background in dark mode (neutral/900 vs neutral/950)
- 8-level shadow system (shadow-2xs → shadow-2xl + shadow-inner) for hover feedback and floating elements
- Glass/overlay tokens for frosted-glass panels and modal backdrops
- Sidebar as a distinct spatial zone with its own token set

## 2. Color Palette & Roles

### Primary (Mode-Inverted Neutral)
- **Primary** (`#171717` light / `#e5e5e5` dark): `--primary`, main action color — buttons, links, emphasis
- **Primary Foreground** (`#fafafa` light / `#171717` dark): `--primary-foreground`, text on primary surfaces

### Text Colors
- **Foreground** (`#0a0a0a` light / `#fafafa` dark): `--foreground`, primary body text
- **Muted Foreground** (`#737373` light / `#a3a3a3` dark): `--muted-foreground`, secondary/helper text
- **Card Foreground** (`#0a0a0a` light / `#fafafa` dark): `--card-foreground`, text on card surfaces
- **Accent Foreground** (`#171717` light / `#fafafa` dark): `--accent-foreground`, text on accent surfaces
- **Semantic Foreground** (`#ffffff` both modes): `--semantic-foreground`, text on custom semantic surfaces

### Surface & Background
- **Background** (`#ffffff` light / `#0a0a0a` dark): `--background`, primary page background
- **Card** (`#ffffff` light / `#171717` dark): `--card`, elevated card surfaces
- **Popover** (`#ffffff` light / `#262626` dark): `--popover`, floating panel surfaces
- **Muted** (`#f5f5f5` light / `#262626` dark): `--muted`, subdued backgrounds, disabled states
- **Accent** (`#f5f5f5` light / `#404040` dark): `--accent`, hover/active backgrounds
- **Secondary** (`#f5f5f5` light / `#262626` dark): `--secondary`, secondary action backgrounds
- **Semantic Background** (`#696867` light / `#272625` dark): `--semantic-background`, custom overlays

### Sidebar (Distinct Spatial Zone)
- **Sidebar** (`#fafafa` light / `#171717` dark): `--sidebar`, sidebar surface — slightly tinted vs main background
- **Sidebar Primary** (`#171717` light / Radix blue/10 dark): `--sidebar-primary`, active item in sidebar
- **Sidebar Accent** (`#f5f5f5` light / `#262626` dark): `--sidebar-accent`, hover state in sidebar
- **Sidebar Border** (`#e5e5e5` light / `#404040` dark): `--sidebar-border`, dividers within sidebar

### Borders & Rings
- **Border** (`#e5e5e5` light / `#404040` dark): `--border`, component borders, dividers
- **Input** (`#e5e5e5` light / `#171717` dark): `--input`, form input borders
- **Ring** (`#737373` both modes): `--ring`, focus ring color
- **Semantic Border** (`#898887` light / `#535151` dark): `--semantic-border`, custom semantic borders

### Semantic
- **Destructive** (`#dc2626` light / `#f87171` dark): `--destructive`, error states, dangerous actions
- **Success** (`#16a34a` light / `#4ade80` dark): `--success`, positive states, confirmations — from tw/colors green/600, green/400
- **Success Foreground** (`#ffffff` light / `#052e16` dark): `--success-foreground`, text on success surfaces
- **Warning** (`#f59e0b` light / `#fbbf24` dark): `--warning`, caution states, pending actions — from tw/colors amber/500, amber/400
- **Warning Foreground** (`#ffffff` light / `#451a03` dark): `--warning-foreground`, text on warning surfaces
- **Info** (`#3b82f6` light / `#60a5fa` dark): `--info`, informational states, tips — from tw/colors blue/500, blue/400
- **Info Foreground** (`#ffffff` light / `#172554` dark): `--info-foreground`, text on info surfaces

### Brand & Accent (Radix Blue)
- **Brand** (`#0090ff` both modes): `--brand`, Radix blue/9 — used for chart accents, sidebar-primary (dark), and brand highlights
- **Brand Foreground** (`#ffffff` both modes): `--brand-foreground`, text on brand surfaces
- **Link** (`#2563eb` light / `#60a5fa` dark): `--link`, clickable text links — from tw/colors blue/600, blue/400
- **Link Hover** (`#1d4ed8` light / `#93c5fd` dark): `--link-hover`, hovered link state — from tw/colors blue/700, blue/300

### Chart Colors (Radix Blue Scale)
- **Chart 1–5**: Radix blue/8 through blue/12 — a monochromatic blue progression for data visualization

### Glass & Transparency
- **Glass** (`hsla(0, 0%, 100%, 0.80)` light / `hsla(0, 0%, 10%, 0.80)` dark): `--glass`, frosted glass overlay — use with `backdrop-filter: blur(12px)`
- **Glass Border** (`hsla(0, 0%, 0%, 0.08)` light / `hsla(0, 0%, 100%, 0.08)` dark): `--glass-border`, border on glass surfaces
- **Overlay** (`hsla(0, 0%, 0%, 0.50)` light / `hsla(0, 0%, 0%, 0.70)` dark): `--overlay`, modal/dialog backdrop dim

### Gradients
- **Gradient Subtle**: `neutral/50 → neutral/100` light / `neutral/950 → neutral/900` dark — section background variation
- **Gradient Surface**: `white → neutral/50` light / `neutral/900 → neutral/800` dark — card/panel depth hint

## 3. Typography Rules

### Font Families
- **Primary UI**: `Inter`, clean geometric sans-serif — all buttons, body text, navigation, labels
- **Friendly Sans**: `Nunito Sans`, softer rounded alternative for approachable contexts
- **Primary Mono**: `Geist Mono`, modern monospace for code blocks and technical display
- **Developer Mono**: `JetBrains Mono`, programming-optimized monospace for editor contexts

### Size Scale

| Role | Size | Typical Use |
|------|------|-------------|
| Micro | 12px (xs) | Tags, badges, timestamps, metadata |
| Small | 14px (sm) | Navigation, secondary labels, captions |
| Body | 16px (base) | Standard body text, form inputs, descriptions |
| Large | 18px (lg) | Emphasized body, sub-headings |
| Heading 5 | 20px (xl) | Minor section titles |
| Heading 4 | 24px (2xl) | Sub-section headings |
| Heading 3 | 30px (3xl) | Section headings |
| Heading 2 | 36px (4xl) | Page titles |
| Heading 1 | 48px (5xl) | Hero headlines |
| Display | 60px–128px (6xl–9xl) | Marketing display, landing pages |

### Weight System

| Weight | Value | Usage |
|--------|-------|-------|
| Normal | 400 | Body text, descriptions, secondary labels |
| Medium | 500 | Navigation, emphasized body, form labels |
| Semibold | 600 | Section headings, card titles, button text |
| Bold | 700 | Page titles, strong emphasis, hero headlines |

Reserve `thin` (100) through `light` (300) for decorative/display contexts only. `Extrabold` (800) and `black` (900) for marketing/landing page display.

### Line Heights

| Context | Value | Usage |
|---------|-------|-------|
| Tight | 16px (leading/4) | Single-line labels, badges, compact UI |
| Normal | 20px–24px (leading/5–6) | Body text at 14–16px |
| Relaxed | 28px–32px (leading/7–8) | Headings at 20–24px |
| Loose | 36px–48px (leading/9–12) | Large headings at 30–48px |
| Display | 60px–128px (leading/15–32) | Display text at 60–128px |

### Letter Spacing

| Context | Value | Usage |
|---------|-------|-------|
| Tighter | -0.8px | Large display headings (48px+) |
| Tight | -0.4px | Headings (24–48px) |
| Normal | 0 | Body text, standard UI |
| Wide | 0.4px | Uppercase labels, small caps |
| Wider | 0.8px | Spaced-out decorative text |
| Widest | 1.6px | All-caps section labels |

### Principles
- **Inter for everything functional**: body, buttons, inputs, navigation, labels — one font handles 90% of the UI.
- **Weight 500 as the pivot point**: below 500 is content, above 500 is structure. Body at 400, labels at 500, headings at 600–700.
- **Consistent line-height rhythm**: most body text at 1.4–1.5x line-height. Headings tighter (1.2–1.3x). Display tightest (1.0–1.1x).
- **Negative tracking for headings**: apply `tracking/tight` (-0.4px) at 24px+ and `tracking/tighter` (-0.8px) at 48px+ to maintain visual density.

## 4. Component Stylings

### Buttons

**Primary**
- Background: `--primary` (`#171717` light / `#e5e5e5` dark)
- Text: `--primary-foreground` (`#fafafa` light / `#171717` dark)
- Radius: `radius-lg` (10px)
- Padding: 16px horizontal, 8px vertical
- Font: Inter 14px, weight 500
- Hover: opacity **90%** + `shadow-xs`
- Use: Main CTAs ("Send", "Save", "Create")

**Default / Outline**
- Background: transparent
- Text: `--accent-foreground`
- Border: 1px solid `--border`
- Radius: `radius-lg` (10px)
- Padding: 16px horizontal, 8px vertical
- Font: Inter 14px, weight 500
- Hover: fill `--accent` + border `--border` + `shadow-xs`
- Use: Standard actions, form submissions

**Secondary**
- Background: `--secondary` (`#f5f5f5` light / `#262626` dark)
- Text: `--secondary-foreground` (`#0a0a0a` light / `#fafafa` dark)
- Radius: `radius-lg` (10px)
- Padding: 16px horizontal, 8px vertical
- Font: Inter 14px, weight 500
- Hover: opacity **80%** + `shadow-xs`
- Use: Secondary actions ("Cancel", "Back", "Export")

**Ghost**
- Background: transparent
- Text: `--accent-foreground`
- Radius: `radius-lg` (10px)
- Padding: 16px horizontal, 8px vertical
- Font: Inter 14px, weight 500
- Hover: fill `--accent` + `shadow-xs`
- Use: Toolbar actions, inline actions, icon buttons

**Destructive**
- Background: `--destructive` (`#dc2626` light / `#f87171` dark)
- Text: `#ffffff` (white/12)
- Radius: `radius-lg` (10px)
- Padding: 16px horizontal, 8px vertical
- Font: Inter 14px, weight 500
- Hover: opacity **90%** + `shadow-xs`
- Use: Dangerous actions ("Delete", "Remove", "Reset")

**Link**
- Background: none
- Text: `--primary`
- Font: Inter 14px, weight 500
- Hover: underline decoration
- Use: Inline text links, navigation shortcuts

**Pill**
- Radius: `radius-full` (9999px)
- Use: Tags, filters, toggles, tab indicators

### Button Hover Interaction Summary

All button hover states share a consistent pattern from Figma:

| Variant | Hover Fill | Hover Opacity | Hover Border | Hover Shadow | Text Change |
|---------|-----------|---------------|-------------|-------------|-------------|
| Primary | `--primary` | 90% | — | `shadow-xs` | — |
| Default/Outline | `--accent` | 100% | `--border` 1px | `shadow-xs` | — |
| Secondary | `--secondary` | 80% | — | `shadow-xs` | — |
| Ghost | `--accent` | 100% | — | `shadow-xs` | — |
| Destructive | `--destructive` | 90% | — | `shadow-xs` | — |
| Link | — | 100% | — | — | + underline |

**Hover rules:**
1. Solid-fill buttons (Primary, Secondary, Destructive) reduce opacity on hover (80%–90%) to reveal subtle depth
2. Transparent buttons (Default, Outline, Ghost) gain `--accent` fill on hover to show activation
3. All buttons except Link gain `shadow-xs` on hover for tactile lift feedback
4. Link hover adds underline only — no background, no shadow

### Cards

**Standard Card**
- Background: `--card` (`#ffffff` light / `#171717` dark)
- Border: 1px solid `--border`
- Radius: `radius-lg` (10px) to `radius-xl` (14px)
- Padding: 16px–24px
- Use: Content containers, conversation panels, settings sections

**Popover / Floating**
- Background: `--popover` (`#ffffff` light / `#262626` dark)
- Border: 1px solid `--border`
- Radius: `radius-lg` (10px)
- Use: Dropdowns, menus, tooltips, command palettes

### Inputs

- Background: `--background`
- Border: 1px solid `--input`
- Radius: `radius-md` (8px)
- Focus ring: 2px `--ring` (`#737373`)
- Font: Inter 14px–16px, weight 400
- Placeholder: `--muted-foreground`

### Sidebar

- Background: `--sidebar` (`#fafafa` light / `#171717` dark)
- Border-right: 1px solid `--sidebar-border`
- Active item: `--sidebar-primary` background, `--sidebar-primary-foreground` text
- Hover item: `--sidebar-accent` background
- Font: Inter 14px, weight 400–500

## 5. Layout Principles

### Spacing System
- Base unit: 4px
- Scale: 0, 1px, 2px, 4px, 6px, 8px, 10px, 12px, 14px, 16px, 20px, 24px, 28px, 32px, 36px, 40px, 44px, 48px, 56px, 64px, 80px, 96px, 128px, 160px, 192px, 224px, 256px, 288px, 320px, 384px

### Common Spacing Patterns
| Context | Value | Tailwind |
|---------|-------|----------|
| Inline spacing (icon to text) | 4px–8px | `gap-1` to `gap-2` |
| Component internal padding | 8px–16px | `p-2` to `p-4` |
| Card padding | 16px–24px | `p-4` to `p-6` |
| Section gaps | 24px–48px | `gap-6` to `gap-12` |
| Page section spacing | 48px–96px | `py-12` to `py-24` |

### Grid & Container

- Max content widths: `max-w-sm` (384px), `max-w-md` (448px), `max-w-lg` (512px), `max-w-xl` (576px), `max-w-2xl` (672px), `max-w-3xl` (768px), `max-w-4xl` (896px), `max-w-5xl` (1024px), `max-w-6xl` (1152px), `max-w-7xl` (1280px)
- Screen breakpoints: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px)

### Border Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `radius-none` | 0 | No rounding — table cells, inline code |
| `radius-xs` | 2px | Micro elements — badges, tags |
| `radius-sm` | 6px | Small components — chips, small buttons |
| `radius-md` | 8px | **Default** — buttons, inputs, dropdowns |
| `radius-lg` | 10px | Cards, panels, dialogs |
| `radius-xl` | 14px | Large cards, hero sections |
| `radius-2xl` | 18px | Feature cards, prominent containers |
| `radius-3xl` | 22px | Marketing cards, large modals |
| `radius-4xl` | 26px | Oversized decorative containers |
| `radius-full` | 9999px | Pills, avatars, circular buttons |

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px | Single column, stacked panels, bottom navigation |
| Tablet | 640–1024px | Sidebar collapses, 2-column layouts |
| Desktop | >1024px | Full sidebar + content layout, expanded spacing |
| Wide | >1280px | Extended content area, optional right panel |

## 6. Depth & Elevation

Cherry Studio uses a dual depth system: **surface color layering** for structural hierarchy and **box-shadows** for interactive feedback (hover states, floating elements).

### Surface Color Layers

| Level | Light Mode | Dark Mode | Use |
|-------|-----------|-----------|-----|
| Ground (Level 0) | `#ffffff` | `#0a0a0a` | Page background |
| Surface (Level 1) | `#ffffff` | `#171717` | Cards, main panels |
| Raised (Level 2) | `#ffffff` | `#262626` | Popovers, menus, dropdowns |
| Overlay (Level 3) | `#f5f5f5` | `#404040` | Accent/hover backgrounds, tooltips |
| Sidebar (Ambient) | `#fafafa` | `#171717` | Sidebar — distinct from main surface |

### Shadow System

8-level shadow scale defined as Figma Effect Styles, following Tailwind CSS naming conventions:

| Token | Value | Use |
|-------|-------|-----|
| `shadow-2xs` | `0 1px 0 0 rgba(0,0,0,0.05)` | Minimal lift — subtle dividers, pressed states |
| `shadow-xs` | `0 4px 4px 0 rgba(0,0,0,0.05)` | **Button hover** — primary interactive feedback |
| `shadow-sm` | `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` | Cards, small floating elements |
| `shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)` | Dropdowns, tooltips |
| `shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)` | Modals, large panels |
| `shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)` | Full-screen overlays |
| `shadow-2xl` | `0 25px 50px -12px rgba(0,0,0,0.25)` | Maximum elevation — hero cards |
| `shadow-inner` | `inset 0 2px 4px 0 rgba(0,0,0,0.05)` | Inset depth — pressed inputs, sunken areas |

**Depth Philosophy**: Surface color layering is the primary depth mechanism — in light mode, 1px borders (`#e5e5e5`) separate same-white surfaces; in dark mode, progressively lighter neutrals (950 → 900 → 800 → 700) create natural stacking. Shadows are reserved for **interactive feedback** (hover states add `shadow-xs`) and **floating elements** (popovers, modals use `shadow-md` to `shadow-lg`). This keeps the interface feeling flat at rest and responsive on interaction.

### Border Width
- **Default border**: 1px (`--border-width`) — component edges, dividers, input outlines
- **Stroke width**: 2px (`--stroke-width`) — icons, focus rings, emphasis lines

## 7. Do's and Don'ts

### Do
- Use the neutral scale as the entire UI foundation — gray IS the brand
- Apply `radius-lg` (10px) as the default for buttons, `radius-md` (8px) for inputs
- Use `--primary` (near-black/near-white) for main CTAs — the monochrome identity is intentional
- Let dark mode feel genuinely dark: `#0a0a0a` background with layered neutral surfaces
- Use `--muted-foreground` (`#737373` / `#a3a3a3`) for secondary text — it provides just enough contrast
- Use `shadow-xs` on button hover states for tactile lift feedback
- Use opacity reduction (80%–90%) on solid-fill button hover to indicate interaction
- Use `--accent` fill for transparent button hover (Default, Outline, Ghost)
- Use semantic colors (`--success`, `--warning`, `--info`) for status feedback, toasts, and badges
- Use `--link` / `--link-hover` for clickable text rather than `--primary`
- Use Inter at weight 400–500 for body, 600 for headings — keep it restrained
- Separate spatial zones (sidebar, main, popover) through surface color layering
- Use the Radix blue chart palette for data visualization
- Apply `radius-full` (9999px) specifically for pills, avatars, and circular buttons
- Use `shadow-md` to `shadow-lg` for floating elements (popovers, modals, dropdowns)

### Don't
- Don't use shadows for static elevation — reserve shadows for hover feedback and floating elements
- Don't use `radius-xs` (2px) or `radius-sm` (6px) for buttons or cards — `radius-lg` (10px) is the button standard
- Don't use font weights below 400 for functional UI text — thin/light weights are display-only
- Don't apply `--destructive` to non-dangerous actions — it's reserved for delete/error/warning only
- Don't use `--success` / `--warning` / `--info` for decorative purposes — they carry semantic meaning
- Don't mix Inter and Nunito Sans in the same context — pick one per surface
- Don't use Geist Mono or JetBrains Mono for non-code content
- Don't darken the sidebar to match the main background — its distinct tint (`#fafafa` / `#171717`) creates spatial separation
- Don't use `--popover` background for cards or vice versa — each elevation level has its specific token
- Don't hard-code hex values — always reference semantic tokens so light/dark mode works automatically
- Don't apply `shadow-xl` or `shadow-2xl` to standard UI elements — heavy shadows break the flat aesthetic

## 8. Responsive Behavior

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

## 9. Agent Prompt Guide

### Quick Color Reference
- Background: `#ffffff` / `#0a0a0a` (light/dark)
- Text: `#0a0a0a` / `#fafafa` (primary), `#737373` / `#a3a3a3` (muted)
- Primary: `#171717` / `#e5e5e5` (actions), inverted foreground
- Destructive: `#dc2626` / `#f87171` (errors)
- Success: `#16a34a` / `#4ade80` (positive)
- Warning: `#f59e0b` / `#fbbf24` (caution)
- Info: `#3b82f6` / `#60a5fa` (informational)
- Brand: `#0090ff` (Radix blue/9)
- Link: `#2563eb` / `#60a5fa`, hover `#1d4ed8` / `#93c5fd`
- Borders: `#e5e5e5` / `#404040`
- Card: `#ffffff` / `#171717`
- Sidebar: `#fafafa` / `#171717`
- Popover: `#ffffff` / `#262626`
- Glass: `hsla(0,0%,100%,0.80)` / `hsla(0,0%,10%,0.80)` + `backdrop-filter: blur(12px)`
- Overlay: `hsla(0,0%,0%,0.50)` / `hsla(0,0%,0%,0.70)`

### Example Component Prompts
- "Create a chat interface on white background. Messages in Inter 16px weight 400, line-height 24px, `#0a0a0a` text. User messages in cards with `#f5f5f5` background and 10px border-radius. Primary send button in `#171717` background, white text, 8px radius."
- "Design a sidebar navigation: `#fafafa` background, 1px right border `#e5e5e5`. Nav items in Inter 14px weight 500, `#0a0a0a` text. Active item with `#171717` background and `#fafafa` text. Hover state with `#f5f5f5` background."
- "Build a settings card: white background, 1px border `#e5e5e5`, 10px border-radius. Title in Inter 18px weight 600. Description in Inter 14px weight 400, `#737373` text. Toggle switches and form inputs with 8px radius."
- "Create a dark mode conversation view: `#0a0a0a` page background. Message cards on `#171717`. Assistant code blocks in Geist Mono 14px on `#262626` background with 8px radius. Borders at `#404040`."
- "Design a destructive confirmation dialog: `#ffffff` / `#262626` background with 10px radius. Warning text in Inter 14px, `#dc2626` destructive color. Two buttons: secondary (Cancel) in `#f5f5f5`, destructive (Delete) in `#dc2626` with white text."

### Iteration Guide
1. Start with neutral — the gray scale IS the brand, not a placeholder for "real" colors
2. Use semantic tokens (`--primary`, `--border`, `--muted-foreground`) instead of hex values
3. Elevation at rest through surface color layering; `shadow-xs` on hover, `shadow-md`+ for floating elements
4. Button hover: solid-fill buttons reduce opacity (80–90%), transparent buttons gain `--accent` fill, all add `shadow-xs`
5. Inter handles 90% of typography — only reach for Nunito Sans, Geist Mono, or JetBrains Mono when the context demands it
6. Keep weights between 400–600 for the UI — 700 only for page-level titles
7. `radius-lg` (10px) for buttons, `radius-md` (8px) for inputs, larger (14px+) for cards, `9999px` for pills
8. Semantic colors: `--destructive` (red) for danger, `--success` (green) for positive, `--warning` (amber) for caution, `--info` (blue) for informational
9. Use `--link` for clickable text, `--brand` for brand highlights — keep them within the Radix blue family
10. Glass surfaces need both `--glass` background AND `backdrop-filter: blur(12px)` to work
