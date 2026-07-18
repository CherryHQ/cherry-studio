import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS,
  CHERRY_PRODUCT_COLOR_TOKENS,
  CHERRY_PRODUCT_SURFACE_PAIRS,
  CHERRY_PRODUCT_VARIABLE_TOKENS,
  CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS,
  SHADCN_SURFACE_PAIRS,
  SHADCN_VARIABLE_TOKENS
} from './theme-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_STYLES_DIR = path.resolve(__dirname, '../src/styles')

export interface ThemeContractSources {
  contractEntry: string
  tokensEntry: string
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
  const officialVariables = new Set(SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`))
  const productVariables = new Set(CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`))
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
      for (const reference of extractReferences(declaration.value)) {
        if (officialVariables.has(reference) || reference.startsWith('--color-') || reference.startsWith('--app-')) {
          throw new Error(`[theme-contract] foundation ${declaration.name} cannot depend on upper-layer ${reference}`)
        }
      }
    }
  }

  for (const declaration of extractDeclarations(sources.shadcn, 'shadcn.css')) {
    for (const reference of extractReferences(declaration.value)) {
      if (productVariables.has(reference) || reference.startsWith('--color-') || reference.startsWith('--app-')) {
        throw new Error(`[theme-contract] Shadcn ${declaration.name} cannot depend on product/adapter ${reference}`)
      }
    }
  }

  for (const declaration of extractDeclarations(sources.product, 'product.css')) {
    for (const reference of extractReferences(declaration.value)) {
      const validNamespace = reference.startsWith('--cs-') || officialVariables.has(reference)
      if (!validNamespace) {
        throw new Error(`[theme-contract] product ${declaration.name} has invalid dependency ${reference}`)
      }
    }
  }
}

export function validateThemeContractSources(sources: ThemeContractSources): void {
  assertUnique('Shadcn variables', SHADCN_VARIABLE_TOKENS)
  assertUnique('stable product variables', CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS)
  assertUnique('migration product variables', CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS)
  assertUnique('all product variables', CHERRY_PRODUCT_VARIABLE_TOKENS)
  assertUnique('Tailwind product colors', CHERRY_PRODUCT_COLOR_TOKENS)

  const stableVariables = new Set<string>(CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS)
  const migrationVariables = new Set<string>(CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS)
  const productVariables = new Set<string>(CHERRY_PRODUCT_VARIABLE_TOKENS)
  const shadcnVariables = new Set<string>(SHADCN_VARIABLE_TOKENS)

  for (const token of stableVariables) {
    if (migrationVariables.has(token)) {
      throw new Error(`[theme-contract] product variable ${token} cannot be both stable and migration-only`)
    }
  }
  for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
    if (!productVariables.has(token)) {
      throw new Error(`[theme-contract] Tailwind product color ${token} is missing from the product contract`)
    }
  }
  assertSurfacePairs('Shadcn contract', SHADCN_SURFACE_PAIRS, shadcnVariables)
  assertSurfacePairs('product contract', CHERRY_PRODUCT_SURFACE_PAIRS, stableVariables)

  assertExactImports('tokens.css', sources.tokensEntry, ['./tokens/index.css'])
  assertExactImports('contract.css', sources.contractEntry, ['./tokens.css', './shadcn.css', './product.css'])
  assertLayerDependencies(sources)

  const orderedSources: SourceEntry[] = [
    ['tokens/colors/primitive.css', sources.primitiveColors],
    ['tokens/colors/semantic.css', sources.semanticColors],
    ['tokens/colors/status.css', sources.statusColors],
    ['tokens/spacing.css', sources.spacing],
    ['tokens/radius.css', sources.radius],
    ['tokens/typography.css', sources.typography],
    ['shadcn.css', sources.shadcn],
    ['product.css', sources.product]
  ]
  const rootDeclarations = buildDeclarationMap(orderedSources, ':root')
  const darkOverrides = buildDeclarationMap(orderedSources, '.dark')
  const darkDeclarations = new Map(rootDeclarations)
  for (const [name, declaration] of darkOverrides) darkDeclarations.set(name, declaration)

  assertRequiredDeclarations('Shadcn contract', rootDeclarations, SHADCN_VARIABLE_TOKENS, '--')
  assertRequiredDeclarations('product contract', rootDeclarations, CHERRY_PRODUCT_VARIABLE_TOKENS, '--cs-')

  const migrationVariableNames = new Set(CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`))
  for (const token of CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS) {
    const name = `--cs-${token}`
    const declaration = rootDeclarations.get(name)
    if (!declaration) continue

    const migrationDependency = extractReferences(declaration.value).find((reference) =>
      migrationVariableNames.has(reference)
    )
    if (migrationDependency) {
      throw new Error(`[theme-contract] stable product ${name} cannot depend on migration-only ${migrationDependency}`)
    }
  }

  const productDeclarationNames = new Set(
    extractDeclarations(sources.product, 'product.css').map((declaration) => declaration.name)
  )
  for (const name of productDeclarationNames) {
    if (!name.startsWith('--cs-') || !productVariables.has(name.slice('--cs-'.length))) {
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
    contractEntry,
    tokensEntry,
    primitiveColors,
    semanticColors,
    statusColors,
    spacing,
    radius,
    typography,
    shadcn,
    product
  ] = await Promise.all([
    fs.readFile(path.join(stylesDir, 'contract.css'), 'utf8'),
    fs.readFile(path.join(stylesDir, 'tokens.css'), 'utf8'),
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
    contractEntry,
    tokensEntry,
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
