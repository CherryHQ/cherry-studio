import { describe, expect, it } from 'vitest'

import { adaptCommunityThemeCss } from '../communityThemeCss'

// A representative *complete* current tweakcn v4 export: build directives, bare :root/.dark
// tokens, a flat `@theme inline` block, and an `@layer base` with `@apply`.
const TWEAKCN_EXPORT = `@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.6 0.2 250);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41);
  --chart-2: oklch(0.6 0.118 184);
  --chart-3: oklch(0.398 0.07 227);
  --chart-4: oklch(0.828 0.189 84);
  --chart-5: oklch(0.769 0.188 70);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
  --font-sans: Inter, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius: 0.625rem;
  --shadow-sm: 0 1px 2px 0 hsl(0 0% 0% / 0.05);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.7 0.2 250);
  --border: oklch(0.269 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-lg: var(--radius);
  --font-sans: var(--font-sans);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}`

describe('adaptCommunityThemeCss', () => {
  describe('complete tweakcn v4 export (acceptance #1)', () => {
    const out = adaptCommunityThemeCss(TWEAKCN_EXPORT)!

    it('removes every Tailwind-only build directive', () => {
      expect(out).not.toMatch(/@import\s+['"](?:tailwindcss|tw-animate-css)/)
      expect(out).not.toContain('@custom-variant')
      expect(out).not.toContain('@theme')
      expect(out).not.toContain('@apply')
    })

    it('preserves the :root / .dark blocks and ordinary declarations', () => {
      expect(out).toContain('--background: oklch(1 0 0);')
      expect(out).toContain('.dark {')
      expect(out).toContain('--primary: oklch(0.7 0.2 250);')
      // The empty @layer base survives (only the @apply lines are stripped).
      expect(out).toContain('@layer base')
      // A shared-name token (shadow) is left in place, not re-bridged.
      expect(out).toContain('--shadow-sm: 0 1px 2px 0 hsl(0 0% 0% / 0.05);')
    })

    it('emits the core → --color-* palette bridge', () => {
      expect(out).toContain('--color-background: var(--background);')
      expect(out).toContain('--color-foreground: var(--foreground);')
      expect(out).toContain('--color-secondary: var(--secondary);')
      expect(out).toContain('--color-destructive: var(--destructive);')
      expect(out).toContain('--color-border: var(--border);')
    })

    it('makes standard --primary win for --color-primary consumers', () => {
      expect(out).toContain('--color-primary: var(--primary);')
    })

    it('bridges the --cs-* design-token inputs', () => {
      expect(out).toContain('--cs-background: var(--background);')
      expect(out).toContain('--cs-primary: var(--primary);')
      expect(out).toContain('--cs-theme-primary: var(--primary);')
    })

    it('bridges the renderer --app-* overrides', () => {
      expect(out).toContain('--app-primary-foreground: var(--primary-foreground);')
      expect(out).toContain('--app-input: var(--input);')
      expect(out).toContain('--app-sidebar: var(--sidebar);')
    })

    it('bridges chart-1..5 and the sidebar family', () => {
      for (let i = 1; i <= 5; i++) {
        expect(out).toContain(`--color-chart-${i}: var(--chart-${i});`)
      }
      expect(out).toContain('--color-sidebar-ring: var(--sidebar-ring);')
      expect(out).toContain('--app-sidebar-border: var(--sidebar-border);')
    })

    it('derives Cherry-only state roles from standard tokens', () => {
      expect(out).toContain('--cs-primary-hover: color-mix(in oklab, var(--primary) 88%, var(--foreground));')
      expect(out).toContain('--cs-destructive-hover: color-mix(in oklab, var(--destructive) 88%, var(--foreground));')
      expect(out).toContain('--cs-ghost-hover: color-mix(in oklab, transparent 95%, var(--foreground));')
      expect(out).toContain('--cs-border-hover: color-mix(in oklab, var(--border) 80%, var(--foreground));')
      expect(out).toContain('--cs-foreground-secondary: var(--muted-foreground);')
      expect(out).toContain('--app-sidebar-active-bg: var(--sidebar-accent);')
      expect(out).toContain('--app-sidebar-active-border: var(--sidebar-border);')
      expect(out).toContain('--app-sidebar-glow-line: color-mix(in oklab, var(--sidebar-primary) 50%, transparent);')
    })

    it('emits the radius scale from --radius', () => {
      expect(out).toContain('--radius-sm: calc(var(--radius) - 4px);')
      expect(out).toContain('--radius-lg: var(--radius);')
      expect(out).toContain('--radius-4xl: calc(var(--radius) + 16px);')
    })

    it('bridges fonts without overriding an explicit inline user font', () => {
      expect(out).toContain('--user-font-family: var(--font-sans);')
      expect(out).toContain('--cs-font-family-body: var(--cs-user-font-family, var(--font-sans));')
      expect(out).toContain('--cs-font-family-heading: var(--cs-user-font-family, var(--font-sans));')
      expect(out).toContain('--user-code-font-family: var(--font-mono);')
    })

    it('never leaves a Tailwind directive that would fail at runtime', () => {
      // Sanity: the bridge only references tokens the export actually declares.
      const referenced = [...out.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((m) => m[1])
      const bridgeRefs = referenced.filter(
        (v) => !v.startsWith('--color') && !v.startsWith('--cs') && !v.startsWith('--app')
      )
      for (const ref of new Set(bridgeRefs)) {
        expect(out).toMatch(new RegExp(`${ref}\\s*:`))
      }
    })
  })

  describe('commented declarations do not activate (acceptance #2)', () => {
    it('ignores standard tokens that live only inside comments', () => {
      const css = `/* example theme:
        :root { --primary: oklch(0.6 0.2 250); --background: white; }
      */
      .foo { color: red; }`
      expect(adaptCommunityThemeCss(css)).toBe(css)
    })
  })

  describe('ordinary custom CSS is untouched (acceptance #3)', () => {
    it('returns byte-for-byte unchanged when no standard token is declared', () => {
      const css = `body { background: #111; }
.scrollbar::-webkit-scrollbar { width: 8px; }
:root { --my-custom-gap: 12px; }`
      expect(adaptCommunityThemeCss(css)).toBe(css)
    })

    it('passes empty / undefined through unchanged', () => {
      expect(adaptCommunityThemeCss('')).toBe('')
      expect(adaptCommunityThemeCss(undefined)).toBeUndefined()
    })

    it('does not activate on radius / font tokens alone (no color token)', () => {
      const css = ':root { --radius: 0.5rem; --font-sans: Inter; }'
      expect(adaptCommunityThemeCss(css)).toBe(css)
    })
  })

  describe('partial token input (acceptance #4)', () => {
    const css = `:root {
      --primary: oklch(0.6 0.2 250);
      --background: oklch(1 0 0);
    }`
    const out = adaptCommunityThemeCss(css)!

    it('maps only the declared tokens', () => {
      expect(out).toContain('--color-primary: var(--primary);')
      expect(out).toContain('--color-background: var(--background);')
      expect(out).not.toContain('--color-secondary:')
      expect(out).not.toContain('--color-chart-1:')
      expect(out).not.toContain('--app-sidebar:')
      expect(out).not.toContain('--radius-sm:')
      expect(out).not.toContain('--user-font-family:')
    })

    it('never emits a derived role that references an undeclared token', () => {
      // --foreground is absent, so no foreground-mixed role may appear.
      expect(out).not.toContain('--cs-ghost-hover:')
      expect(out).not.toContain('--cs-primary-hover:')
      expect(out).not.toContain('--cs-border-hover:')
    })

    it('every var() reference in the bridge resolves to a declared token', () => {
      const bridge = out.slice(out.indexOf('shadcn community theme bridge'))
      const refs = [...bridge.matchAll(/var\((--[a-z0-9-]+)\)/gi)]
        .map((m) => m[1])
        .filter((v) => !v.startsWith('--color') && !v.startsWith('--cs') && !v.startsWith('--app'))
      // Only --primary and --background are declared; nothing else may be referenced.
      expect(new Set(refs)).toEqual(new Set(['--primary', '--background']))
    })
  })
})
