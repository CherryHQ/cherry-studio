/**
 * Adapt a shadcn / tweakcn "community theme" pasted into the `ui.custom_css` preference so
 * it themes the running app at runtime.
 *
 * A tweakcn export is a full Tailwind v4 stylesheet: `@import 'tailwindcss'`, a
 * `@custom-variant`, `:root` / `.dark` blocks of *bare* standard tokens (`--background`,
 * `--primary`, …), an `@theme inline` block that maps those to `--color-*`, and an
 * `@layer base` that `@apply`s them. The browser cannot run Tailwind's build directives, so
 * two things must happen for the paste to take effect:
 *
 *   1. Strip the build-only directives (they are inert noise at best, a failed
 *      `@import 'tailwindcss'` network fetch at worst).
 *   2. Re-emit, in plain CSS, the bridge that `@theme inline` would have produced — mapping
 *      the community's bare tokens onto Cherry's *actual* runtime variables
 *      (`--color-*` public contract, `--cs-*` design-token inputs, and the renderer's
 *      `--app-*` overrides that several utilities compile to directly).
 *
 * Deliberate POC ceiling: parsing is regex-based and tuned to the *current* tweakcn export
 * shape (flat `@theme inline`, statement-form `@custom-variant`, `@apply` inside
 * `@layer base`). It is not a general CSS/Tailwind processor — nested `@theme` blocks,
 * block-form `@custom-variant`, or `@apply` outside a rule are out of scope. Anything that
 * is not a recognised standard theme declaration is left untouched, and CSS that declares no
 * standard tokens at all is returned byte-for-byte unchanged.
 */

// --- Tailwind-only directives the browser cannot execute (stripped when a theme activates) -

/** `@import 'tailwindcss'` / `@import 'tw-animate-css'` (incl. sub-paths). */
const TAILWIND_IMPORT = /@import\s+["'][^"']*(?:tailwindcss|tw-animate-css)[^"']*["']\s*;/gi
/** `@custom-variant dark (&:is(.dark *));` — statement form only. */
const CUSTOM_VARIANT = /@custom-variant[^;{]*;/gi
/** Flat `@theme inline { … }` (or `@theme { … }`) — no nested braces in the tweakcn shape. */
const THEME_BLOCK = /@theme(?:\s+inline)?\s*\{[^}]*\}/gi
/** `@apply …;` declarations (live inside `@layer base` rules). */
const APPLY_DECL = /@apply[^;}]*;?/gi
/** CSS block comments — removed for *detection* only, never from the returned CSS. */
const COMMENT = /\/\*[\s\S]*?\*\//g

/**
 * Standard token → the Cherry runtime custom properties that must follow it.
 *
 * `--color-*` is the public Tailwind contract (`bg-primary`, `text-foreground`, …).
 * `--cs-*` are the design-token inputs, so Cherry's *derived* roles (soft/mute mixes, ring)
 * follow too. `--app-*` are the renderer's `@theme inline` overrides — utilities for those
 * roles compile to `var(--app-*)` directly, so `--color-*` alone would not move them.
 */
const COLOR_BRIDGE: Record<string, readonly string[]> = {
  background: ['--color-background', '--cs-background'],
  foreground: ['--color-foreground', '--cs-foreground'],
  card: ['--color-card', '--cs-card'],
  'card-foreground': ['--color-card-foreground', '--app-card-foreground', '--cs-card-foreground'],
  popover: ['--color-popover', '--cs-popover'],
  'popover-foreground': ['--color-popover-foreground', '--app-popover-foreground', '--cs-popover-foreground'],
  // --primary wins for bg-primary and direct --color-primary consumers because this later
  // :root rule overrides theme.css's `--color-primary: var(--cs-theme-primary)`; soft/mute
  // mixes reference --color-primary, so they follow without touching preference state.
  primary: ['--color-primary', '--cs-theme-primary', '--cs-primary'],
  'primary-foreground': ['--color-primary-foreground', '--app-primary-foreground', '--cs-primary-foreground'],
  secondary: ['--color-secondary', '--cs-secondary'],
  'secondary-foreground': ['--color-secondary-foreground', '--app-secondary-foreground', '--cs-secondary-foreground'],
  muted: ['--color-muted', '--cs-muted'],
  'muted-foreground': ['--color-muted-foreground', '--app-muted-foreground'],
  accent: ['--color-accent', '--cs-accent'],
  'accent-foreground': ['--color-accent-foreground', '--app-accent-foreground', '--cs-accent-foreground'],
  destructive: ['--color-destructive', '--cs-destructive'],
  'destructive-foreground': [
    '--color-destructive-foreground',
    '--app-destructive-foreground',
    '--cs-destructive-foreground'
  ],
  border: ['--color-border', '--cs-border'],
  input: ['--color-input', '--app-input', '--cs-input'],
  ring: ['--color-ring', '--cs-theme-ring', '--cs-ring'],
  'chart-1': ['--color-chart-1'],
  'chart-2': ['--color-chart-2'],
  'chart-3': ['--color-chart-3'],
  'chart-4': ['--color-chart-4'],
  'chart-5': ['--color-chart-5'],
  sidebar: ['--color-sidebar', '--app-sidebar', '--cs-sidebar'],
  'sidebar-foreground': ['--color-sidebar-foreground', '--app-sidebar-foreground', '--cs-sidebar-foreground'],
  'sidebar-primary': ['--color-sidebar-primary', '--app-sidebar-primary', '--cs-sidebar-primary'],
  'sidebar-primary-foreground': [
    '--color-sidebar-primary-foreground',
    '--app-sidebar-primary-foreground',
    '--cs-sidebar-primary-foreground'
  ],
  'sidebar-accent': [
    '--color-sidebar-accent',
    '--app-sidebar-accent',
    '--app-sidebar-active-bg',
    '--cs-sidebar-accent'
  ],
  'sidebar-accent-foreground': [
    '--color-sidebar-accent-foreground',
    '--app-sidebar-accent-foreground',
    '--cs-sidebar-accent-foreground'
  ],
  'sidebar-border': [
    '--color-sidebar-border',
    '--app-sidebar-border',
    '--app-sidebar-active-border',
    '--cs-sidebar-border'
  ],
  'sidebar-ring': ['--color-sidebar-ring', '--app-sidebar-ring', '--cs-sidebar-ring']
}

/** Non-color tokens that extend the bridge but never, on their own, activate it. */
const EXTRA_TOKENS = ['radius', 'font-sans', 'font-mono'] as const

const ALL_TOKENS = [...Object.keys(COLOR_BRIDGE), ...EXTRA_TOKENS]

/** True if `token` is declared as a custom property in `css` (already comment-stripped). */
function isDeclared(css: string, token: string): boolean {
  // `--primary\s*:` cannot match inside `--primary-foreground:` (a `-` follows, not `:`),
  // so sibling tokens never cross-trigger.
  return new RegExp(`--${token}\\s*:`).test(css)
}

/**
 * Cherry-only hover / subtle / border state roles have no tweakcn equivalent; derive them
 * from the standard tokens so a themed surface reads coherently instead of half-Cherry. Each
 * derivation is gated on *every* source token it references, so no `var()` is ever unresolved.
 */
function deriveStateRoles(has: (t: string) => boolean): string[] {
  const lines: string[] = []
  const fg = has('foreground')

  if (fg) {
    // Translucent veils of the foreground, so hovers read on any themed background rather
    // than Cherry's hard-coded black/white alphas.
    lines.push(
      '  --cs-ghost-hover: color-mix(in oklab, transparent 95%, var(--foreground));',
      '  --cs-ghost-active: color-mix(in oklab, transparent 90%, var(--foreground));',
      '  --cs-menu-item-hover: color-mix(in oklab, transparent 96%, var(--foreground));',
      '  --cs-background-subtle: color-mix(in oklab, transparent 98%, var(--foreground));'
    )
  }
  if (has('primary') && fg) {
    lines.push('  --cs-primary-hover: color-mix(in oklab, var(--primary) 88%, var(--foreground));')
  }
  if (has('destructive') && fg) {
    lines.push('  --cs-destructive-hover: color-mix(in oklab, var(--destructive) 88%, var(--foreground));')
  }
  if (has('secondary') && fg) {
    lines.push(
      '  --cs-secondary-hover: color-mix(in oklab, var(--secondary) 92%, var(--foreground));',
      '  --cs-secondary-active: color-mix(in oklab, var(--secondary) 85%, var(--foreground));'
    )
  }
  if (has('border')) {
    lines.push(
      '  --cs-border-muted: color-mix(in oklab, var(--border) 60%, transparent);',
      '  --cs-border-subtle: color-mix(in oklab, var(--border) 40%, transparent);',
      '  --cs-frame-border: var(--border);'
    )
    if (fg) {
      lines.push(
        '  --cs-border-hover: color-mix(in oklab, var(--border) 80%, var(--foreground));',
        '  --cs-border-active: color-mix(in oklab, var(--border) 70%, var(--foreground));'
      )
    }
  }
  if (has('muted-foreground')) {
    lines.push(
      '  --cs-foreground-secondary: var(--muted-foreground);',
      '  --cs-foreground-muted: color-mix(in oklab, var(--muted-foreground) 70%, transparent);'
    )
  }
  if (has('sidebar-primary')) {
    lines.push(
      '  --app-sidebar-glow-bg: color-mix(in oklab, var(--sidebar-primary) 25%, transparent);',
      '  --app-sidebar-glow-line: color-mix(in oklab, var(--sidebar-primary) 50%, transparent);'
    )
  }
  return lines
}

/** Radius scale from a single `--radius`, matching tweakcn's sm/md/lg/xl + Cherry 2xl–4xl. */
function deriveRadius(): string[] {
  return [
    '  --radius-sm: calc(var(--radius) - 4px);',
    '  --radius-md: calc(var(--radius) - 2px);',
    '  --radius-lg: var(--radius);',
    '  --radius-xl: calc(var(--radius) + 4px);',
    '  --radius-2xl: calc(var(--radius) + 8px);',
    '  --radius-3xl: calc(var(--radius) + 12px);',
    '  --radius-4xl: calc(var(--radius) + 16px);'
  ]
}

/**
 * Build the `:root` bridge block for the tokens actually declared. `var()` resolves per
 * element, so a single `:root` covers light and dark: an element under `.dark` reads the
 * `.dark`-scoped `--background`, and `--color-background: var(--background)` follows it.
 */
function buildBridge(has: (t: string) => boolean): string {
  const lines: string[] = []

  for (const [token, targets] of Object.entries(COLOR_BRIDGE)) {
    if (!has(token)) continue
    for (const target of targets) {
      lines.push(`  ${target}: var(--${token});`)
    }
  }

  lines.push(...deriveStateRoles(has))

  if (has('radius')) {
    lines.push(...deriveRadius())
  }
  if (has('font-sans')) {
    // Keep the explicit user font the winner everywhere. For the renderer body chain,
    // --font-family already reads `var(--cs-user-font-family, var(--user-font-family, …))`,
    // so feeding the community sans into the --user-font-family *fallback* slot leaves an
    // inline --cs-user-font-family (set by useUserTheme) ahead of it. The DS body/heading
    // aliases have no such chain, so wrap them the same way by hand — inline user font first,
    // community sans as fallback — instead of pointing them straight at --font-sans.
    lines.push(
      '  --user-font-family: var(--font-sans);',
      '  --cs-font-family-body: var(--cs-user-font-family, var(--font-sans));',
      '  --cs-font-family-heading: var(--cs-user-font-family, var(--font-sans));'
    )
  }
  if (has('font-mono')) {
    lines.push('  --user-code-font-family: var(--font-mono);')
  }

  return `/* Cherry Studio · shadcn community theme bridge (POC) */\n:root {\n${lines.join('\n')}\n}\n`
}

/**
 * Adapt community-theme custom CSS for runtime injection. Returns the input unchanged when it
 * declares no standard theme tokens (ordinary custom CSS), or `undefined` for empty input.
 */
export function adaptCommunityThemeCss(css: string | undefined): string | undefined {
  if (!css) return css

  // Detect against comment-stripped CSS so commented-out examples never activate a theme.
  const detectable = css.replace(COMMENT, '')
  const declared = new Set(ALL_TOKENS.filter((token) => isDeclared(detectable, token)))
  const activates = Object.keys(COLOR_BRIDGE).some((token) => declared.has(token))
  if (!activates) return css

  const cleaned = css
    .replace(TAILWIND_IMPORT, '')
    .replace(CUSTOM_VARIANT, '')
    .replace(THEME_BLOCK, '')
    .replace(APPLY_DECL, '')

  return `${cleaned}\n\n${buildBridge((token) => declared.has(token))}`
}
