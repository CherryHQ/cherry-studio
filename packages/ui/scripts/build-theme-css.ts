import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHERRY_PRODUCT_COLOR_TOKENS, SHADCN_COLOR_TOKENS } from './theme-contract'
import { loadThemeContractSources, validateThemeContractSources } from './validate-theme-contract'

export {
  CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS,
  CHERRY_PRODUCT_COLOR_TOKENS,
  CHERRY_PRODUCT_SURFACE_PAIRS,
  CHERRY_PRODUCT_VARIABLE_TOKENS,
  CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS,
  RUNTIME_THEME_INPUT_TOKENS,
  SHADCN_COLOR_TOKENS,
  SHADCN_SURFACE_PAIRS,
  SHADCN_VARIABLE_TOKENS
} from './theme-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STYLES_DIR = path.resolve(__dirname, '../src/styles')
const THEME_OUTPUT_PATH = path.join(STYLES_DIR, 'theme.css')

const COMPATIBILITY_SEMANTIC_LINES = [
  '--color-primary-soft: color-mix(in srgb, var(--primary) 60%, transparent);',
  '--color-primary-mute: color-mix(in srgb, var(--primary) 30%, transparent);'
]

const RADIUS_LINES = [
  '--radius-4xs: var(--cs-radius-4xs);',
  '--radius-3xs: var(--cs-radius-3xs);',
  '--radius-2xs: var(--cs-radius-2xs);',
  '--radius-xs: var(--cs-radius-xs);',
  '--radius-sm: calc(var(--radius) * 0.6);',
  '--radius-md: calc(var(--radius) * 0.8);',
  '--radius-lg: var(--radius);',
  '--radius-xl: calc(var(--radius) * 1.4);',
  '--radius-2xl: calc(var(--radius) * 1.8);',
  '--radius-3xl: calc(var(--radius) * 2.2);',
  '--radius-4xl: calc(var(--radius) * 2.6);',
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
 * Update \`src/styles/tokens/*\`, \`src/styles/theme-input.css\`,
 * \`src/styles/shadcn.css\`, \`src/styles/product.css\`, or the generator
 * contract to change the source.
 */

@import './contract.css';

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
  const sources = await loadThemeContractSources(stylesDir)
  validateThemeContractSources(sources)

  return {
    primitiveColors: extractTokenNames(sources.primitiveColors),
    semanticColors: extractTokenNames(sources.semanticColors),
    statusColors: extractTokenNames(sources.statusColors),
    typographyTokens: extractTokenNames(sources.typography)
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
