import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STYLES_DIR = path.resolve(__dirname, '../src/styles')
const THEME_OUTPUT_PATH = path.join(STYLES_DIR, 'theme.css')

export const SHADCN_COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring'
] as const

export const CHERRY_PRODUCT_COLOR_TOKENS = [
  'background-subtle',
  'border-subtle',
  'border-strong',
  'success',
  'success-foreground',
  'success-subtle',
  'success-subtle-foreground',
  'success-border',
  'warning',
  'warning-foreground',
  'warning-subtle',
  'warning-subtle-foreground',
  'warning-border',
  'info',
  'info-foreground',
  'info-subtle',
  'info-subtle-foreground',
  'info-border',
  'error',
  'error-foreground',
  'error-subtle',
  'error-subtle-foreground',
  'error-border'
] as const

const COMPATIBILITY_SEMANTIC_LINES = [
  '--color-primary-soft: color-mix(in srgb, var(--primary) 60%, transparent);',
  '--color-primary-mute: color-mix(in srgb, var(--primary) 30%, transparent);'
]

const RADIUS_LINES = [
  '--radius-4xs: var(--cs-radius-4xs);',
  '--radius-3xs: var(--cs-radius-3xs);',
  '--radius-2xs: var(--cs-radius-2xs);',
  '--radius-xs: var(--cs-radius-xs);',
  '--radius-sm: calc(var(--radius) - 0.25rem);',
  '--radius-md: calc(var(--radius) - 0.125rem);',
  '--radius-lg: var(--radius);',
  '--radius-xl: calc(var(--radius) + 0.25rem);',
  '--radius-2xl: calc(var(--radius) + 0.5rem);',
  '--radius-3xl: calc(var(--radius) + 0.75rem);',
  '--radius-full: var(--cs-radius-round);',
  '--radius-round: var(--cs-radius-round);'
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

const ANIMATION_LINES = [
  '--animate-checkbox-bounce: checkbox-bounce 300ms cubic-bezier(0.4, 0, 0.2, 1);',
  '--animate-checkbox-icon-in: checkbox-icon-in 160ms ease-out both;',
  '',
  '@keyframes checkbox-bounce {',
  '  0%,',
  '  100% {',
  '    transform: scale(1);',
  '  }',
  '',
  '  50% {',
  '    transform: scale(1.08);',
  '  }',
  '}',
  '',
  '@keyframes checkbox-icon-in {',
  '  from {',
  '    opacity: 0;',
  '    transform: scale(0.75);',
  '  }',
  '',
  '  to {',
  '    opacity: 1;',
  '    transform: scale(1);',
  '  }',
  '}'
]

export interface ThemeContractInputs {
  primitiveColors: string[]
  semanticColors: string[]
  statusColors: string[]
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

function toColorMappings(tokenNames: readonly string[], sourcePrefix = '--'): string[] {
  return tokenNames.map((tokenName) => `--color-${tokenName}: var(${sourcePrefix}${tokenName});`)
}

function toDirectMappings(tokenNames: string[], sourcePrefix = '--cs-'): string[] {
  return tokenNames.map((tokenName) => `--${tokenName}: var(${sourcePrefix}${tokenName});`)
}

function buildSection(title: string, lines: string[]): string {
  const indentedLines = lines.map((line) => (line ? `  ${line}` : '')).join('\n')

  return `  /* ==================== */\n  /* ${title} */\n  /* ==================== */\n${indentedLines}`
}

export function buildThemeContractCss(inputs: ThemeContractInputs): string {
  const canonicalTokenNames = new Set<string>([...SHADCN_COLOR_TOKENS, ...CHERRY_PRODUCT_COLOR_TOKENS])
  const compatibilitySemanticTokens = inputs.semanticColors.filter((token) => !canonicalTokenNames.has(token))
  const compatibilityStatusTokens = inputs.statusColors.filter((token) => !canonicalTokenNames.has(token))

  const sections = [
    buildSection('Compatibility: Primitive Colors', toPrefixedMappings(inputs.primitiveColors, 'color-')),
    buildSection('Canonical Shadcn Colors', toColorMappings(SHADCN_COLOR_TOKENS)),
    buildSection('Cherry Studio Product Colors', toColorMappings(CHERRY_PRODUCT_COLOR_TOKENS, '--cs-')),
    buildSection('Compatibility: Existing Semantic Colors', [
      ...COMPATIBILITY_SEMANTIC_LINES,
      ...toPrefixedMappings(compatibilitySemanticTokens, 'color-')
    ]),
    buildSection('Compatibility: Existing Status Colors', toPrefixedMappings(compatibilityStatusTokens, 'color-')),
    buildSection('Spacing', SPACING_COMMENT_LINES),
    buildSection('Radius', RADIUS_LINES),
    buildSection('Typography', toDirectMappings(inputs.typographyTokens)),
    buildSection('Animation', ANIMATION_LINES)
  ]

  return `/**
 * Generated from design tokens.
 *
 * ⚠️ DO NOT EDIT DIRECTLY!
 * This file is generated by \`pnpm theme:build\`.
 * Update \`src/styles/tokens/*\`, \`src/styles/shadcn.css\`, or the generator
 * contract to change the design source.
 */

@import './tokens.css';
@import './shadcn.css';

@theme inline {
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
  const [primitiveColorsSource, semanticColorsSource, statusColorsSource, typographySource] = await Promise.all([
    fs.readFile(path.join(tokensDir, 'colors/primitive.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'colors/semantic.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'colors/status.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'typography.css'), 'utf8')
  ])

  return {
    primitiveColors: extractTokenNames(primitiveColorsSource),
    semanticColors: extractTokenNames(semanticColorsSource),
    statusColors: extractTokenNames(statusColorsSource),
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
