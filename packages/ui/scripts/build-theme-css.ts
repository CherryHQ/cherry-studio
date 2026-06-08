import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STYLES_DIR = path.resolve(__dirname, '../src/styles')
const THEME_OUTPUT_PATH = path.join(STYLES_DIR, 'theme.css')

const RUNTIME_THEME_INPUT_LINES = [
  '--cs-theme-primary: var(--cs-primary);',
  '--cs-theme-ring: color-mix(in srgb, var(--cs-theme-primary) 40%, transparent);'
]

const COMPATIBILITY_ALIAS_LINES = ['--primary: var(--color-primary);', '--ring: var(--color-ring);']

const PRIMARY_SEMANTIC_LINES = [
  '--color-primary: var(--cs-theme-primary);',
  '--color-primary-hover: var(--cs-primary-hover);',
  '--color-primary-soft: color-mix(in srgb, var(--color-primary) 60%, transparent);',
  '--color-primary-mute: color-mix(in srgb, var(--color-primary) 30%, transparent);',
  '--color-ring: var(--cs-theme-ring);'
]

const SPACING_COMMENT_LINES = [
  '/* Keep spacing opt-in for now to avoid overriding Tailwind container names. */',
  '/* --spacing-5xs: var(--cs-size-5xs);',
  '--spacing-4xs: var(--cs-size-4xs);',
  '--spacing-3xs: var(--cs-size-3xs);',
  '--spacing-2xs: var(--cs-size-2xs);',
  '--spacing-xs: var(--cs-size-xs);',
  '--spacing-sm: var(--cs-size-sm);',
  '--spacing-md: var(--cs-size-md);',
  '--spacing-lg: var(--cs-size-lg);',
  '--spacing-xl: var(--cs-size-xl);',
  '--spacing-2xl: var(--cs-size-2xl);',
  '--spacing-3xl: var(--cs-size-3xl);',
  '--spacing-4xl: var(--cs-size-4xl);',
  '--spacing-5xl: var(--cs-size-5xl);',
  '--spacing-6xl: var(--cs-size-6xl);',
  '--spacing-7xl: var(--cs-size-7xl);',
  '--spacing-8xl: var(--cs-size-8xl); */'
]

export interface ThemeContractInputs {
  primitiveColors: string[]
  semanticColors: string[]
  statusColors: string[]
  radiusTokens: string[]
  typographyTokens: string[]
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export function extractTokenNames(source: string): string[] {
  return dedupe([...source.matchAll(/^\s*--cs-([a-z0-9-]+)\s*:/gm)].map((match) => match[1]))
}

function toPrefixedMappings(tokenNames: string[], targetPrefix: string, sourcePrefix = '--cs-'): string[] {
  return tokenNames.map((tokenName) => `--${targetPrefix}${tokenName}: var(${sourcePrefix}${tokenName});`)
}

function toDirectMappings(tokenNames: string[], sourcePrefix = '--cs-'): string[] {
  return tokenNames.map((tokenName) => `--${tokenName}: var(${sourcePrefix}${tokenName});`)
}

/**
 * Wire the semantic font sizes into Tailwind v4 `text-*` utilities.
 *
 * Tailwind generates `text-*` font-size utilities from the `--text-*` theme
 * namespace (pairing a line-height via the `--text-*--line-height` companion). The
 * design tokens live under `--font-size-*` / `--line-height-*`, which Tailwind does
 * NOT turn into utilities — so this emits `--text-*` aliases for them.
 *
 * The body sizes (12/14/16/18px) are exactly Tailwind's built-in `text-xs/sm/base/lg`,
 * so we OVERRIDE those built-ins (same size, design line-height) — existing
 * `text-xs`/`text-sm` usages pick up the design rhythm with no migration. The heading
 * scale gets semantic `text-heading-*` names (heading-md/lg are off Tailwind's scale,
 * and this avoids changing the built-in display sizes `text-xl/2xl/5xl`).
 *
 * The raw `--font-size-*` / `--line-height-*` mappings are NOT emitted (they made no
 * utilities); code that needs the raw value references `var(--cs-font-size-*)` directly.
 */
const FONT_SIZE_UTILITY_MAP: Record<string, string> = {
  'body-xs': 'xs',
  'body-sm': 'sm',
  'body-md': 'base',
  'body-lg': 'lg',
  'heading-xs': 'heading-xs',
  'heading-sm': 'heading-sm',
  'heading-md': 'heading-md',
  'heading-lg': 'heading-lg',
  'heading-xl': 'heading-xl',
  'heading-2xl': 'heading-2xl'
}

function toTextUtilityMappings(tokenNames: string[], sourcePrefix = '--cs-'): string[] {
  const hasLineHeight = new Set(tokenNames.filter((name) => name.startsWith('line-height-')))
  const lines: string[] = []
  for (const name of tokenNames) {
    const match = name.match(/^font-size-(.+)$/)
    if (!match) continue
    const scale = match[1] // e.g. 'body-sm', 'heading-2xl'
    const target = FONT_SIZE_UTILITY_MAP[scale]
    if (!target) continue
    lines.push(`--text-${target}: var(${sourcePrefix}font-size-${scale});`)
    if (hasLineHeight.has(`line-height-${scale}`)) {
      lines.push(`--text-${target}--line-height: var(${sourcePrefix}line-height-${scale});`)
    }
  }
  return lines
}

function buildSection(title: string, lines: string[]): string {
  const indentedLines = lines.map((line) => (line ? `  ${line}` : '')).join('\n')

  return `  /* ==================== */\n  /* ${title} */\n  /* ==================== */\n${indentedLines}`
}

export function buildThemeContractCss(inputs: ThemeContractInputs): string {
  const semanticContractTokens = inputs.semanticColors.filter(
    (token) => !['primary', 'primary-hover', 'ring'].includes(token)
  )

  const sections = [
    buildSection('Primitive Colors', toPrefixedMappings(inputs.primitiveColors, 'color-')),
    buildSection('Runtime Theme Inputs', RUNTIME_THEME_INPUT_LINES),
    buildSection('Compatibility Aliases', COMPATIBILITY_ALIAS_LINES),
    buildSection('Semantic Colors', [
      ...PRIMARY_SEMANTIC_LINES,
      ...toPrefixedMappings(semanticContractTokens, 'color-')
    ]),
    buildSection('Status Colors', toPrefixedMappings(inputs.statusColors, 'color-')),
    buildSection('Spacing', SPACING_COMMENT_LINES),
    buildSection('Radius', toDirectMappings(inputs.radiusTokens)),
    buildSection('Typography', [
      // `font-size-*` / `line-height-*` are wired via the `--text-*` utilities below
      // (Tailwind doesn't make utilities from those namespaces), so they get no raw
      // `@theme` mapping; everything else (font-family, font-weight, paragraph-spacing)
      // keeps its direct mapping. Code that needs the raw value uses `var(--cs-*)`.
      ...toDirectMappings(
        inputs.typographyTokens.filter((name) => !name.startsWith('font-size-') && !name.startsWith('line-height-'))
      ),
      ...toTextUtilityMappings(inputs.typographyTokens)
    ])
  ]

  return `/**
 * Generated from design tokens.
 *
 * ⚠️ DO NOT EDIT DIRECTLY!
 * This file is generated by \`pnpm theme:build\`.
 * Update \`src/styles/tokens/*\` to change the design source.
 */

@import './tokens.css';

@theme {
${sections.join('\n\n')}
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
`
}

export async function loadThemeContractInputs(stylesDir = STYLES_DIR): Promise<ThemeContractInputs> {
  const tokensDir = path.join(stylesDir, 'tokens')
  const [primitiveColorsSource, semanticColorsSource, statusColorsSource, radiusSource, typographySource] =
    await Promise.all([
      fs.readFile(path.join(tokensDir, 'colors/primitive.css'), 'utf8'),
      fs.readFile(path.join(tokensDir, 'colors/semantic.css'), 'utf8'),
      fs.readFile(path.join(tokensDir, 'colors/status.css'), 'utf8'),
      fs.readFile(path.join(tokensDir, 'radius.css'), 'utf8'),
      fs.readFile(path.join(tokensDir, 'typography.css'), 'utf8')
    ])

  return {
    primitiveColors: extractTokenNames(primitiveColorsSource),
    semanticColors: extractTokenNames(semanticColorsSource),
    statusColors: extractTokenNames(statusColorsSource),
    radiusTokens: extractTokenNames(radiusSource),
    typographyTokens: extractTokenNames(typographySource)
  }
}

export async function writeThemeContractCss(outputPath = THEME_OUTPUT_PATH, stylesDir = STYLES_DIR): Promise<void> {
  const inputs = await loadThemeContractInputs(stylesDir)
  const css = buildThemeContractCss(inputs)
  await fs.writeFile(outputPath, css, 'utf8')
}

async function main() {
  await writeThemeContractCss()
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main()
}
