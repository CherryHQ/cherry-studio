import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

// Issue #24947: while a control is checked / selected / active / invalid, its
// persistent-state rules share specificity with the legacy `focus-visible:*` rules and
// are emitted later, so the focus cue disappears (WCAG 2.4.7). The fix paints an inset
// ring through Tailwind's dedicated `--tw-inset-shadow` slot, which box-shadow
// compositions always re-include. This test asserts *compiled CSS* from the real
// renderer Tailwind entry — the class-name assertions that preceded the regression
// stayed green throughout it.

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../../..')
const TAILWIND_ENTRY = resolve(REPO_ROOT, 'src/renderer/assets/styles/tailwind.css')

// The renderer entry imports the shared theme through the package export
// `@cherrystudio/ui/styles/theme.css`, which maps to `./dist/styles/theme.css` — a build
// artifact. CI runs this suite before the ui package is built, so resolving that specifier
// throws "no valid target file was found". Point it at the tracked source instead: the
// build script only copies `src/styles/` into `dist/styles/`, so the bytes are identical
// and the compiled cascade is the same one production gets.
const UI_THEME_IMPORT = "@import '@cherrystudio/ui/styles/theme.css';"
const UI_THEME_SOURCE = resolve(REPO_ROOT, 'packages/ui/src/styles/theme.css')

function tailwindEntryCss(): string {
  const source = readFileSync(TAILWIND_ENTRY, 'utf8')
  if (!source.includes(UI_THEME_IMPORT)) {
    throw new Error(`${TAILWIND_ENTRY} no longer imports ${UI_THEME_IMPORT} — re-point the theme source here`)
  }
  return source.replace(UI_THEME_IMPORT, `@import '${UI_THEME_SOURCE}';`)
}

const FOCUS_FILES = [
  'packages/ui/src/components/primitives/checkbox.tsx',
  'packages/ui/src/components/primitives/radio-group.tsx',
  'packages/ui/src/components/primitives/input.tsx',
  'packages/ui/src/components/primitives/textarea.tsx',
  'packages/ui/src/components/primitives/tabs.tsx',
  'packages/ui/src/components/primitives/select.tsx',
  'packages/ui/src/components/composites/menu-list/menu-item.tsx',
  'src/renderer/components/NavbarIcon.tsx'
]

const INDICATOR_UTILITY = 'focus-visible:inset-shadow-[0_0_0_2px_var(--ring)]'

// Persistent-state and slot-resetting classes that paint the same longhands as the old
// focus rules; the indicator must survive all of them.
const STATE_CLASSES = [
  'data-[state=checked]:border-foreground',
  'data-[state=active]:bg-background',
  'data-[state=active]:shadow-sm',
  'dark:data-[state=active]:border-input',
  'dark:data-[state=active]:bg-input/30',
  'aria-invalid:border-destructive',
  'data-[active=true]:bg-accent',
  'focus:bg-accent',
  'ring-0',
  'shadow-none'
]

// The transparent value Tailwind itself installs as the slot default (@property initial
// value plus the legacy-browser @supports fallback on the universal selector). It is the
// only assignment allowed outside :focus-visible: it paints nothing, so the rest state
// stays pixel-identical.
const NEUTRAL_INSET_SHADOW = '0 0 #0000'

type CssNode = { type: string; selector?: string; prop?: string; value?: string; nodes?: CssNode[] }
type CssRule = CssNode & { selector: string; nodes: CssNode[] }
type TailwindCompiler = { build: (candidates: readonly string[]) => string }
type TailwindCompile = (css: string, options: { base: string; onDependency: () => void }) => Promise<TailwindCompiler>

const requireFromTest = createRequire(import.meta.url)
// `@tailwindcss/node` is only reachable through `@tailwindcss/vite`'s resolution context.
const requireFromTailwind = createRequire(requireFromTest.resolve('@tailwindcss/vite'))
const { compile } = requireFromTailwind('@tailwindcss/node') as { compile: TailwindCompile }
const postcss = requireFromTest('postcss') as { parse: (css: string) => { nodes?: CssNode[] } }

function extractFocusVisibleClasses(source: string): string[] {
  const classes: string[] = []
  // Class lists live in both quote styles across the source files.
  const literal = /(['"])((?:(?!\1)[^\\\n])*)\1/g
  for (const match of source.matchAll(literal)) {
    if (match[2].includes('focus-visible:')) {
      classes.push(...match[2].split(/\s+/).filter(Boolean))
    }
  }
  return classes
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = []
  const walk = (nodes: CssNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'rule' && node.selector !== undefined) rules.push(node as CssRule)
      if (node.nodes) walk(node.nodes)
    }
  }
  walk(postcss.parse(css).nodes ?? [])
  return rules
}

function isIndicatorValue(value: string | undefined): boolean {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  return (
    normalized !== 'none' && normalized !== '0' && /^inset\b/.test(normalized) && normalized.includes('var(--ring)')
  )
}

function focusVisibleInsetRules(rules: CssRule[]): CssRule[] {
  return rules.filter(
    (rule) => rule.selector.includes(':focus-visible') && rule.nodes.some((decl) => decl.prop === '--tw-inset-shadow')
  )
}

describe('focus-visible inset indicator (compiled CSS)', () => {
  let compiler: TailwindCompiler
  let unionRules: CssRule[]

  beforeAll(async () => {
    compiler = await compile(tailwindEntryCss(), {
      base: TAILWIND_ENTRY,
      onDependency: () => {}
    })
    const allClasses = FOCUS_FILES.flatMap((file) =>
      extractFocusVisibleClasses(readFileSync(resolve(REPO_ROOT, file), 'utf8'))
    )
    unionRules = parseRules(compiler.build([...new Set([...allClasses, ...STATE_CLASSES])]))
  })

  it('paints --tw-inset-shadow under :focus-visible (the keyboard-focus indicator)', () => {
    const rules = focusVisibleInsetRules(unionRules)
    expect(
      rules.length,
      'no :focus-visible rule paints --tw-inset-shadow — keyboard focus stays invisible on stateful controls'
    ).toBeGreaterThan(0)
    for (const rule of rules) {
      for (const decl of rule.nodes) {
        if (decl.prop !== '--tw-inset-shadow') continue
        const value = (decl.value ?? '').replace(/\s+/g, ' ').trim()
        expect(value, `selector: ${rule.selector}`).toMatch(/^inset\b/)
        expect(value, `selector: ${rule.selector}`).not.toBe('none')
        expect(value, `selector: ${rule.selector}`).not.toBe('0')
        expect(value, `selector: ${rule.selector}`).toContain('var(--ring)')
      }
    }
  })

  it('keeps the indicator in every box-shadow composition (survives shadow-sm / ring-0 / shadow-none)', () => {
    for (const rule of unionRules) {
      for (const decl of rule.nodes) {
        if (decl.prop !== 'box-shadow') continue
        const value = (decl.value ?? '').replace(/\s+/g, ' ')
        if (value.includes('var(--tw-shadow)')) {
          expect(value, `selector: ${rule.selector}`).toContain('var(--tw-inset-shadow)')
        }
      }
    }
  })

  it('leaves the rest state untouched outside :focus-visible', () => {
    for (const rule of unionRules) {
      if (rule.selector.includes(':focus-visible')) continue
      for (const decl of rule.nodes) {
        if (decl.prop !== '--tw-inset-shadow') continue
        expect((decl.value ?? '').replace(/\s+/g, ' ').trim(), `selector: ${rule.selector}`).toBe(NEUTRAL_INSET_SHADOW)
      }
    }
  })

  describe.each(FOCUS_FILES)('%s', (file) => {
    it(`contributes ${INDICATOR_UTILITY} as a compiled :focus-visible rule`, () => {
      const classes = extractFocusVisibleClasses(readFileSync(resolve(REPO_ROOT, file), 'utf8'))
      const rules = parseRules(compiler.build([...new Set([...classes, ...STATE_CLASSES])]))
      const withIndicator = focusVisibleInsetRules(rules).filter((rule) =>
        rule.nodes.some((decl) => decl.prop === '--tw-inset-shadow' && isIndicatorValue(decl.value))
      )
      expect(withIndicator.length, `${file} must compile the focus-visible inset indicator`).toBeGreaterThan(0)
    })
  })
})
