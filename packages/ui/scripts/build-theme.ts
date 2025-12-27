/**
 * Build Theme CSS from Design Tokens
 *
 * This script reads CSS variables from tokens/ directory and generates
 * a Tailwind CSS v4 compatible theme.css file for @theme directive.
 *
 * Usage: npx tsx scripts/build-theme.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const TOKENS_DIR = path.resolve(__dirname, '../src/styles/tokens')
const OUTPUT_FILE = path.resolve(__dirname, '../src/styles/theme.css')

interface CSSVariable {
  name: string
  value: string
}

interface ParsedTokens {
  primitiveColors: CSSVariable[]
  semanticColors: CSSVariable[]
  semanticColorsDark: CSSVariable[]
  statusColors: CSSVariable[]
  statusColorsDark: CSSVariable[]
  spacing: CSSVariable[]
  radius: CSSVariable[]
  typography: CSSVariable[]
}

/**
 * Parse CSS file and extract variables from :root and .dark selectors
 */
function parseCSSFile(filePath: string): { root: CSSVariable[]; dark: CSSVariable[] } {
  const content = fs.readFileSync(filePath, 'utf-8')
  const root: CSSVariable[] = []
  const dark: CSSVariable[] = []

  // Match :root block
  const rootMatch = content.match(/:root\s*\{([^}]+)\}/s)
  if (rootMatch) {
    const vars = extractVariables(rootMatch[1])
    root.push(...vars)
  }

  // Match .dark block
  const darkMatch = content.match(/\.dark\s*\{([^}]+)\}/s)
  if (darkMatch) {
    const vars = extractVariables(darkMatch[1])
    dark.push(...vars)
  }

  return { root, dark }
}

/**
 * Extract CSS variables from a CSS block
 */
function extractVariables(block: string): CSSVariable[] {
  const variables: CSSVariable[] = []
  const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g
  let match

  while ((match = varRegex.exec(block)) !== null) {
    const name = match[1]
    const value = match[2].trim()

    // Resolve var() references to actual values for primitive colors
    // Keep var() references for semantic colors that reference primitives
    variables.push({ name, value })
  }

  return variables
}

/**
 * Convert --cs-* variable name to --color-* for Tailwind theme
 */
function convertToThemeVariable(name: string): string {
  // Remove cs- prefix and add appropriate prefix based on category
  if (name.startsWith('cs-')) {
    const withoutPrefix = name.slice(3)

    // Typography variables
    if (withoutPrefix.startsWith('font-')) {
      return withoutPrefix
    }
    if (withoutPrefix.startsWith('line-height-')) {
      return withoutPrefix
    }
    if (withoutPrefix.startsWith('paragraph-spacing-')) {
      return withoutPrefix
    }

    // Radius variables
    if (withoutPrefix.startsWith('radius-')) {
      return withoutPrefix
    }

    // Spacing/Size variables - map to spacing
    if (withoutPrefix.startsWith('size-')) {
      return withoutPrefix.replace('size-', 'spacing-')
    }

    // Color variables - add color- prefix
    return `color-${withoutPrefix}`
  }

  return name
}

/**
 * Resolve var() references to actual values
 */
function resolveVarReferences(value: string, primitiveMap: Map<string, string>, recursionDepth = 0): string {
  if (recursionDepth > 10) {
    console.warn(`Max recursion depth reached for value: ${value}`)
    return value
  }

  const varRegex = /var\(--cs-([\w-]+)\)/g
  let result = value
  let match

  while ((match = varRegex.exec(value)) !== null) {
    const varName = `cs-${match[1]}`
    const resolvedValue = primitiveMap.get(varName)
    if (resolvedValue) {
      // Recursively resolve if the resolved value also contains var()
      const fullyResolved = resolveVarReferences(resolvedValue, primitiveMap, recursionDepth + 1)
      result = result.replace(match[0], fullyResolved)
    }
  }

  return result
}

/**
 * Parse all token files
 */
function parseAllTokens(): ParsedTokens {
  const tokens: ParsedTokens = {
    primitiveColors: [],
    semanticColors: [],
    semanticColorsDark: [],
    statusColors: [],
    statusColorsDark: [],
    spacing: [],
    radius: [],
    typography: []
  }

  // Parse primitive colors
  const primitivePath = path.join(TOKENS_DIR, 'colors/primitive.css')
  if (fs.existsSync(primitivePath)) {
    const { root } = parseCSSFile(primitivePath)
    tokens.primitiveColors = root
  }

  // Parse semantic colors
  const semanticPath = path.join(TOKENS_DIR, 'colors/semantic.css')
  if (fs.existsSync(semanticPath)) {
    const { root, dark } = parseCSSFile(semanticPath)
    tokens.semanticColors = root
    tokens.semanticColorsDark = dark
  }

  // Parse status colors
  const statusPath = path.join(TOKENS_DIR, 'colors/status.css')
  if (fs.existsSync(statusPath)) {
    const { root, dark } = parseCSSFile(statusPath)
    tokens.statusColors = root
    tokens.statusColorsDark = dark
  }

  // Parse spacing
  const spacingPath = path.join(TOKENS_DIR, 'spacing.css')
  if (fs.existsSync(spacingPath)) {
    const { root } = parseCSSFile(spacingPath)
    tokens.spacing = root
  }

  // Parse radius
  const radiusPath = path.join(TOKENS_DIR, 'radius.css')
  if (fs.existsSync(radiusPath)) {
    const { root } = parseCSSFile(radiusPath)
    tokens.radius = root
  }

  // Parse typography
  const typographyPath = path.join(TOKENS_DIR, 'typography.css')
  if (fs.existsSync(typographyPath)) {
    const { root } = parseCSSFile(typographyPath)
    tokens.typography = root
  }

  return tokens
}

/**
 * Generate the theme.css content
 */
function generateThemeCSS(tokens: ParsedTokens): string {
  const timestamp = new Date().toISOString()

  // Build primitive color map for resolving references
  const primitiveMap = new Map<string, string>()
  for (const v of tokens.primitiveColors) {
    primitiveMap.set(v.name, v.value)
  }

  // Also add white/black
  primitiveMap.set('cs-white', 'oklch(1 0 0)')
  primitiveMap.set('cs-black', 'oklch(0 0 0)')

  const lines: string[] = [
    '/**',
    ' * Generated from Design Tokens',
    ' *',
    ' * ⚠️  DO NOT EDIT DIRECTLY!',
    ' * This file is auto-generated from tokens/ directory.',
    ' * To make changes, edit files in tokens/ and run: npm run tokens:build',
    ' *',
    ` * Generated on: ${timestamp}`,
    ' */',
    '',
    '@theme {'
  ]

  // Helper to add section
  const addSection = (title: string, variables: CSSVariable[], resolve = false) => {
    if (variables.length === 0) return

    lines.push(`  /* ==================== */`)
    lines.push(`  /* ${title} */`)
    lines.push(`  /* ==================== */`)

    for (const v of variables) {
      const themeName = convertToThemeVariable(v.name)
      let value = v.value

      // Resolve var() references if needed
      if (resolve && value.includes('var(')) {
        value = resolveVarReferences(value, primitiveMap)
      }

      lines.push(`  --${themeName}: ${value};`)
    }
    lines.push('')
  }

  // Add primitive colors
  addSection('Primitive Colors', tokens.primitiveColors)

  // Add semantic colors (resolved)
  addSection('Semantic Colors', tokens.semanticColors, true)

  // Add status colors (resolved)
  addSection('Status Colors', tokens.statusColors, true)

  // Add spacing (commented out due to conflict with Tailwind container)
  if (tokens.spacing.length > 0) {
    lines.push(`  /* ==================== */`)
    lines.push(`  /* Spacing */`)
    lines.push(`  /* ==================== */`)
    lines.push(`  /* 在 Tailwind CSS v4 中，像 max-w-md、w-md 这类工具类会按照命名空间优先级查找 CSS 变量： */`)
    lines.push(`  /* --spacing-{value} > --container-{value} */`)
    lines.push(`  /* 下述定义的spacing与container相差巨大,所以先注释掉 */`)
    lines.push('')
    for (const v of tokens.spacing) {
      const themeName = convertToThemeVariable(v.name)
      lines.push(`  /* --${themeName}: ${v.value}; */`)
    }
    lines.push('')
  }

  // Add radius
  addSection('Radius', tokens.radius)

  // Add typography
  addSection('Typography', tokens.typography)

  lines.push('}')
  lines.push('')

  // Dark mode overrides
  lines.push('/* ==================== */')
  lines.push('/* Dark Mode */')
  lines.push('/* ==================== */')
  lines.push('@layer theme {')
  lines.push('  .dark {')

  // Semantic colors dark mode
  for (const v of tokens.semanticColorsDark) {
    const themeName = convertToThemeVariable(v.name)
    let value = v.value
    if (value.includes('var(')) {
      value = resolveVarReferences(value, primitiveMap)
    }
    // Only output color variables
    if (themeName.startsWith('color-')) {
      lines.push(`    --${themeName}: ${value};`)
    }
  }

  // Status colors dark mode
  for (const v of tokens.statusColorsDark) {
    const themeName = convertToThemeVariable(v.name)
    let value = v.value
    if (value.includes('var(')) {
      value = resolveVarReferences(value, primitiveMap)
    }
    if (themeName.startsWith('color-')) {
      lines.push(`    --${themeName}: ${value};`)
    }
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  // Base styles
  lines.push('/* ==================== */')
  lines.push('/* Base Styles */')
  lines.push('/* ==================== */')
  lines.push('@layer base {')
  lines.push('  * {')
  lines.push('    @apply border-border outline-ring/50;')
  lines.push('  }')
  lines.push('  body {')
  lines.push('    @apply bg-background text-foreground;')
  lines.push('  }')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Main entry point
 */
function main() {
  console.log('🎨 Building theme.css from design tokens...')
  console.log(`   Source: ${TOKENS_DIR}`)
  console.log(`   Output: ${OUTPUT_FILE}`)

  try {
    const tokens = parseAllTokens()
    const themeCSS = generateThemeCSS(tokens)

    fs.writeFileSync(OUTPUT_FILE, themeCSS, 'utf-8')

    console.log('✅ theme.css generated successfully!')
    console.log('')
    console.log('   Summary:')
    console.log(`   - Primitive colors: ${tokens.primitiveColors.length}`)
    console.log(
      `   - Semantic colors: ${tokens.semanticColors.length} (light) + ${tokens.semanticColorsDark.length} (dark)`
    )
    console.log(`   - Status colors: ${tokens.statusColors.length} (light) + ${tokens.statusColorsDark.length} (dark)`)
    console.log(`   - Radius: ${tokens.radius.length}`)
    console.log(`   - Typography: ${tokens.typography.length}`)
  } catch (error) {
    console.error('❌ Failed to generate theme.css:', error)
    process.exit(1)
  }
}

main()
