import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHERRY_PRODUCT_COLOR_TOKENS,
  CHERRY_PRODUCT_SURFACE_PAIRS,
  CHERRY_PRODUCT_VARIABLE_TOKENS,
  COMPATIBILITY_COLOR_TOKENS,
  COMPATIBILITY_SEMANTIC_COLOR_TOKENS,
  COMPATIBILITY_STATUS_COLOR_TOKENS,
  RUNTIME_THEME_INPUT_TOKENS,
  SHADCN_COLOR_TOKENS,
  SHADCN_SURFACE_PAIRS,
  SHADCN_VARIABLE_TOKENS
} from './theme-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_STYLES_DIR = path.resolve(__dirname, '../src/styles')

export interface ThemeContractSources {
  variableCatalog: string
  contractEntry: string
  tokensEntry: string
  themeInput: string
  primitiveColors: string
  semanticColors: string
  statusColors: string
  spacing: string
  radius: string
  typography: string
  shadcn: string
  product: string
}

interface Declaration {
  name: string
  value: string
  source: string
}

type SourceEntry = readonly [source: string, css: string]

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractDeclarations(source: string, sourceName: string): Declaration[] {
  return [...stripComments(source).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)].map((match) => ({
    name: match[1],
    value: match[2].trim(),
    source: sourceName
  }))
}

function extractModeDeclarations(source: string, sourceName: string, selector: ':root' | '.dark'): Declaration[] {
  const declarations: Declaration[] = []
  const blockPattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\}`, 'g')

  for (const match of stripComments(source).matchAll(blockPattern)) {
    declarations.push(...extractDeclarations(match[1], sourceName))
  }

  return declarations
}

function extractReferences(value: string): string[] {
  return [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1])
}

function extractImports(source: string): string[] {
  return [...stripComments(source).matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)].map((match) => match[1])
}

function assertUnique(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`[theme-contract] ${label} contains duplicate names`)
  }
}

function assertSurfacePairs(
  label: string,
  pairs: ReadonlyArray<readonly [surface: string, foreground: string]>,
  variableNames: Set<string>
): void {
  const surfaces = new Set<string>()

  for (const [surface, foreground] of pairs) {
    if (surface === foreground || surfaces.has(surface)) {
      throw new Error(`[theme-contract] ${label} has an invalid or duplicate surface pair for ${surface}`)
    }
    if (!variableNames.has(surface) || !variableNames.has(foreground)) {
      throw new Error(`[theme-contract] ${label} pair ${surface} / ${foreground} is outside its public contract`)
    }
    surfaces.add(surface)
  }
}

function assertExactImports(label: string, source: string, expected: readonly string[]): void {
  const actual = extractImports(source)

  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`[theme-contract] ${label} imports must be exactly: ${expected.join(' -> ')}`)
  }
}

function buildDeclarationMap(entries: SourceEntry[], selector: ':root' | '.dark'): Map<string, Declaration> {
  const declarations = new Map<string, Declaration>()

  for (const [sourceName, source] of entries) {
    for (const declaration of extractModeDeclarations(source, sourceName, selector)) {
      const existing = declarations.get(declaration.name)
      if (existing) {
        throw new Error(
          `[theme-contract] ${declaration.name} is defined twice in ${selector}: ${existing.source} and ${sourceName}`
        )
      }
      declarations.set(declaration.name, declaration)
    }
  }

  return declarations
}

function assertRequiredDeclarations(
  label: string,
  declarations: Map<string, Declaration>,
  variableNames: readonly string[],
  prefix: string
): void {
  const missing = variableNames.map((name) => `${prefix}${name}`).filter((name) => !declarations.has(name))

  if (missing.length > 0) {
    throw new Error(`[theme-contract] ${label} is missing root declarations: ${missing.join(', ')}`)
  }
}

function assertCompatibilityTokensDeclared(
  label: string,
  tokenNames: readonly string[],
  source: string,
  sourceName: string
): void {
  const declarations = new Set(extractDeclarations(source, sourceName).map((declaration) => declaration.name))
  const missing = tokenNames.map((token) => `--cs-${token}`).filter((name) => !declarations.has(name))

  if (missing.length > 0) {
    throw new Error(`[theme-contract] ${label} references missing foundation variables: ${missing.join(', ')}`)
  }
}

function assertReferencesResolve(mode: string, declarations: Map<string, Declaration>): void {
  for (const declaration of declarations.values()) {
    for (const reference of extractReferences(declaration.value)) {
      if (!declarations.has(reference)) {
        throw new Error(
          `[theme-contract] ${mode} ${declaration.name} in ${declaration.source} references undefined ${reference}`
        )
      }
    }
  }
}

function assertNoCycles(mode: string, declarations: Map<string, Declaration>): void {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const stack: string[] = []

  const visit = (name: string): void => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      const cycleStart = stack.indexOf(name)
      throw new Error(`[theme-contract] ${mode} variable cycle: ${[...stack.slice(cycleStart), name].join(' -> ')}`)
    }

    visiting.add(name)
    stack.push(name)

    const declaration = declarations.get(name)
    if (declaration) {
      for (const reference of extractReferences(declaration.value)) {
        if (declarations.has(reference)) visit(reference)
      }
    }

    stack.pop()
    visiting.delete(name)
    visited.add(name)
  }

  for (const name of declarations.keys()) visit(name)
}

function assertLayerDependencies(sources: ThemeContractSources): void {
  const runtimeVariablePrefix = '--cs-theme-'
  const runtimeVariables = new Set(RUNTIME_THEME_INPUT_TOKENS.map((token) => `--cs-theme-${token}`))
  const officialVariables = new Set(SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`))
  const productVariables = new Set(CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--${token}`))
  const foundationEntries: SourceEntry[] = [
    ['tokens/colors/primitive.css', sources.primitiveColors],
    ['tokens/colors/semantic.css', sources.semanticColors],
    ['tokens/colors/status.css', sources.statusColors],
    ['tokens/spacing.css', sources.spacing],
    ['tokens/radius.css', sources.radius],
    ['tokens/typography.css', sources.typography]
  ]

  for (const [sourceName, source] of foundationEntries) {
    for (const declaration of extractDeclarations(source, sourceName)) {
      if (declaration.name.startsWith(runtimeVariablePrefix)) {
        throw new Error(`[theme-contract] foundation cannot declare runtime input ${declaration.name}`)
      }
      for (const reference of extractReferences(declaration.value)) {
        if (
          reference.startsWith(runtimeVariablePrefix) ||
          officialVariables.has(reference) ||
          productVariables.has(reference) ||
          reference.startsWith('--color-') ||
          reference.startsWith('--app-')
        ) {
          throw new Error(`[theme-contract] foundation ${declaration.name} cannot depend on upper-layer ${reference}`)
        }
      }
    }
  }

  for (const declaration of extractDeclarations(sources.themeInput, 'theme-input.css')) {
    if (!runtimeVariables.has(declaration.name)) {
      throw new Error(`[theme-contract] theme-input.css declares unregistered runtime input ${declaration.name}`)
    }
    for (const reference of extractReferences(declaration.value)) {
      if (officialVariables.has(reference) || productVariables.has(reference) || reference.startsWith('--color-')) {
        throw new Error(`[theme-contract] runtime input ${declaration.name} cannot depend on upper-layer ${reference}`)
      }
      if (reference.startsWith('--app-')) {
        throw new Error(`[theme-contract] runtime input ${declaration.name} cannot depend on host-local ${reference}`)
      }
    }
  }

  for (const declaration of extractDeclarations(sources.shadcn, 'shadcn.css')) {
    if (declaration.name.startsWith(runtimeVariablePrefix)) {
      throw new Error(`[theme-contract] shadcn.css cannot own runtime input ${declaration.name}`)
    }
    for (const reference of extractReferences(declaration.value)) {
      if (productVariables.has(reference) || reference.startsWith('--color-') || reference.startsWith('--app-')) {
        throw new Error(`[theme-contract] Shadcn ${declaration.name} cannot depend on product/adapter ${reference}`)
      }
    }
  }

  for (const declaration of extractDeclarations(sources.product, 'product.css')) {
    for (const reference of extractReferences(declaration.value)) {
      const validNamespace =
        reference.startsWith('--cs-') || officialVariables.has(reference) || productVariables.has(reference)
      if (!validNamespace) {
        throw new Error(`[theme-contract] product ${declaration.name} has invalid dependency ${reference}`)
      }
    }
  }
}

function assertCatalogCoverage(sources: ThemeContractSources): void {
  const requiredNames = [
    ...RUNTIME_THEME_INPUT_TOKENS.map((token) => `--cs-theme-${token}`),
    ...SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`),
    ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--${token}`)
  ]
  const missing = requiredNames.filter((name) => !sources.variableCatalog.includes(`\`${name}\``))

  if (missing.length > 0) {
    throw new Error(`[theme-contract] variable catalog is missing: ${missing.join(', ')}`)
  }
}

export function validateThemeContractSources(sources: ThemeContractSources): void {
  assertUnique('runtime theme inputs', RUNTIME_THEME_INPUT_TOKENS)
  assertUnique('Shadcn variables', SHADCN_VARIABLE_TOKENS)
  assertUnique('product variables', CHERRY_PRODUCT_VARIABLE_TOKENS)
  assertUnique('Tailwind product colors', CHERRY_PRODUCT_COLOR_TOKENS)
  assertUnique('compatibility semantic colors', COMPATIBILITY_SEMANTIC_COLOR_TOKENS)
  assertUnique('compatibility status colors', COMPATIBILITY_STATUS_COLOR_TOKENS)
  assertUnique('compatibility colors', COMPATIBILITY_COLOR_TOKENS)

  const productVariables = new Set<string>(CHERRY_PRODUCT_VARIABLE_TOKENS)
  const shadcnVariables = new Set<string>(SHADCN_VARIABLE_TOKENS)
  const shadcnVariableNames = new Set<string>(SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`))
  const productVariableNames = new Set<string>(CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--${token}`))
  const canonicalColors = new Set<string>([...SHADCN_COLOR_TOKENS, ...CHERRY_PRODUCT_COLOR_TOKENS])

  for (const token of CHERRY_PRODUCT_VARIABLE_TOKENS) {
    if (shadcnVariables.has(token)) {
      throw new Error(`[theme-contract] product variable ${token} overlaps the official Shadcn contract`)
    }
  }

  for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
    if (!productVariables.has(token)) {
      throw new Error(`[theme-contract] Tailwind product color ${token} is missing from the product contract`)
    }
  }
  for (const token of COMPATIBILITY_COLOR_TOKENS) {
    if (canonicalColors.has(token)) {
      throw new Error(`[theme-contract] compatibility color ${token} overlaps the canonical color contract`)
    }
  }
  assertCompatibilityTokensDeclared(
    'compatibility semantic colors',
    COMPATIBILITY_SEMANTIC_COLOR_TOKENS,
    sources.semanticColors,
    'tokens/colors/semantic.css'
  )
  assertCompatibilityTokensDeclared(
    'compatibility status colors',
    COMPATIBILITY_STATUS_COLOR_TOKENS,
    sources.statusColors,
    'tokens/colors/status.css'
  )

  const shadcnRootDeclarations = buildDeclarationMap([['shadcn.css', sources.shadcn]], ':root')
  assertRequiredDeclarations('Shadcn contract in shadcn.css', shadcnRootDeclarations, SHADCN_VARIABLE_TOKENS, '--')
  for (const declaration of extractDeclarations(sources.shadcn, 'shadcn.css')) {
    if (!shadcnVariableNames.has(declaration.name)) {
      throw new Error(`[theme-contract] shadcn.css declares unregistered Shadcn variable ${declaration.name}`)
    }
  }

  const productRootDeclarations = buildDeclarationMap([['product.css', sources.product]], ':root')
  assertRequiredDeclarations(
    'product contract in product.css',
    productRootDeclarations,
    CHERRY_PRODUCT_VARIABLE_TOKENS,
    '--'
  )

  assertSurfacePairs('Shadcn contract', SHADCN_SURFACE_PAIRS, shadcnVariables)
  assertSurfacePairs('product contract', CHERRY_PRODUCT_SURFACE_PAIRS, productVariables)

  assertExactImports('tokens.css', sources.tokensEntry, ['./tokens/index.css'])
  assertExactImports('contract.css', sources.contractEntry, [
    './tokens.css',
    './theme-input.css',
    './shadcn.css',
    './product.css'
  ])
  assertCatalogCoverage(sources)
  assertLayerDependencies(sources)

  const orderedSources: SourceEntry[] = [
    ['tokens/colors/primitive.css', sources.primitiveColors],
    ['tokens/colors/semantic.css', sources.semanticColors],
    ['tokens/colors/status.css', sources.statusColors],
    ['tokens/spacing.css', sources.spacing],
    ['tokens/radius.css', sources.radius],
    ['tokens/typography.css', sources.typography],
    ['theme-input.css', sources.themeInput],
    ['shadcn.css', sources.shadcn],
    ['product.css', sources.product]
  ]
  const rootDeclarations = buildDeclarationMap(orderedSources, ':root')
  const darkOverrides = buildDeclarationMap(orderedSources, '.dark')
  const darkDeclarations = new Map(rootDeclarations)
  for (const [name, declaration] of darkOverrides) darkDeclarations.set(name, declaration)

  assertRequiredDeclarations('runtime theme inputs', rootDeclarations, RUNTIME_THEME_INPUT_TOKENS, '--cs-theme-')
  assertRequiredDeclarations('Shadcn contract', rootDeclarations, SHADCN_VARIABLE_TOKENS, '--')
  assertRequiredDeclarations('product contract', rootDeclarations, CHERRY_PRODUCT_VARIABLE_TOKENS, '--')

  const productDeclarationNames = new Set(
    extractDeclarations(sources.product, 'product.css').map((declaration) => declaration.name)
  )
  for (const name of productDeclarationNames) {
    if (!productVariableNames.has(name)) {
      throw new Error(`[theme-contract] product.css declares unregistered product variable ${name}`)
    }
  }

  assertReferencesResolve('light', rootDeclarations)
  assertReferencesResolve('dark', darkDeclarations)
  assertNoCycles('light', rootDeclarations)
  assertNoCycles('dark', darkDeclarations)
}

export async function loadThemeContractSources(stylesDir = DEFAULT_STYLES_DIR): Promise<ThemeContractSources> {
  const tokensDir = path.join(stylesDir, 'tokens')
  const [
    variableCatalog,
    contractEntry,
    tokensEntry,
    themeInput,
    primitiveColors,
    semanticColors,
    statusColors,
    spacing,
    radius,
    typography,
    shadcn,
    product
  ] = await Promise.all([
    fs.readFile(path.resolve(stylesDir, '../../docs/variable-catalog.md'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'contract.css'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'tokens.css'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'theme-input.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'colors/primitive.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'colors/semantic.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'colors/status.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'spacing.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'radius.css'), 'utf8'),
    fs.readFile(path.join(tokensDir, 'typography.css'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'shadcn.css'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'product.css'), 'utf8')
  ])

  return {
    variableCatalog,
    contractEntry,
    tokensEntry,
    themeInput,
    primitiveColors,
    semanticColors,
    statusColors,
    spacing,
    radius,
    typography,
    shadcn,
    product
  }
}

export async function validateThemeContract(stylesDir = DEFAULT_STYLES_DIR): Promise<void> {
  validateThemeContractSources(await loadThemeContractSources(stylesDir))
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void validateThemeContract().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
