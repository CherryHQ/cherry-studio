import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHERRY_PRODUCT_VARIABLE_TOKENS, SHADCN_VARIABLE_TOKENS } from './theme-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '../../..')
const VARIABLE_NAME_PATTERN = /^--[a-z0-9-]+$/
const MIGRATION_STRATEGIES = new Set(['exact', 'contextual', 'review', 'preserve'])
const REQUIRED_EXCLUDES = [
  'packages/ui/src/styles/theme.css',
  'packages/ui/src/styles/contract.css',
  'packages/ui/src/styles/shadcn.css',
  'packages/ui/src/styles/product.css',
  'packages/ui/src/styles/tokens/**',
  'packages/ui/src/styles/migrations/**',
  'src/renderer/assets/styles/legacy-vars.css',
  'src/renderer/assets/styles/tailwind.css'
] as const

export interface MigrationRule {
  source: string
  target: string | null
  strategy: string
}

export interface MigrationRegistry {
  version: number
  contract: string
  defaultKind: string
  exclude: string[]
  rules: MigrationRule[]
}

export interface MigrationContractSources {
  migrationRegistry: string
  legacyAliases: string
  rendererTheme: string
}

interface VariableDeclaration {
  name: string
  value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMigrationRegistry(source: string): MigrationRegistry {
  let parsed: unknown

  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new Error('[theme-contract] migration registry is not valid JSON', { cause: error })
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.exclude) || !Array.isArray(parsed.rules)) {
    throw new Error('[theme-contract] migration registry has an invalid top-level shape')
  }
  if (!parsed.exclude.every((entry) => typeof entry === 'string')) {
    throw new Error('[theme-contract] migration registry exclude entries must be strings')
  }

  const rules = parsed.rules.map((entry, index): MigrationRule => {
    if (
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      (entry.target !== null && typeof entry.target !== 'string') ||
      typeof entry.strategy !== 'string'
    ) {
      throw new Error(`[theme-contract] migration rule ${index} has an invalid shape`)
    }

    return {
      source: entry.source,
      target: entry.target,
      strategy: entry.strategy
    }
  })

  if (
    typeof parsed.version !== 'number' ||
    typeof parsed.contract !== 'string' ||
    typeof parsed.defaultKind !== 'string'
  ) {
    throw new Error('[theme-contract] migration registry metadata is invalid')
  }

  return {
    version: parsed.version,
    contract: parsed.contract,
    defaultKind: parsed.defaultKind,
    exclude: parsed.exclude,
    rules
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function extractDeclarations(source: string, include: (name: string) => boolean): VariableDeclaration[] {
  return [...stripComments(source).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)]
    .map((match) => ({ name: match[1], value: match[2].trim() }))
    .filter(({ name }) => include(name))
}

function assertCompatibilityAliases(
  label: string,
  declarations: VariableDeclaration[],
  canonicalNames: Set<string>,
  rulesBySource: Map<string, MigrationRule>
): Set<string> {
  if (declarations.length === 0) {
    throw new Error(`[theme-contract] ${label} contains no compatibility aliases`)
  }

  const declarationNames = new Set<string>()

  for (const declaration of declarations) {
    if (declarationNames.has(declaration.name)) {
      throw new Error(`[theme-contract] ${label} declares ${declaration.name} more than once`)
    }
    declarationNames.add(declaration.name)

    const aliasMatch = declaration.value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/)
    if (!aliasMatch) {
      throw new Error(`[theme-contract] ${label} ${declaration.name} must be a single canonical var() alias`)
    }

    const target = aliasMatch[1]
    if (!canonicalNames.has(target)) {
      throw new Error(`[theme-contract] ${label} ${declaration.name} points outside the canonical contract: ${target}`)
    }

    const rule = rulesBySource.get(declaration.name)
    if (!rule || rule.strategy !== 'exact' || rule.target !== target) {
      throw new Error(
        `[theme-contract] ${label} ${declaration.name} must have a matching exact migration rule to ${target}`
      )
    }
  }

  return declarationNames
}

export function validateMigrationContractSources(sources: MigrationContractSources): void {
  const registry = parseMigrationRegistry(sources.migrationRegistry)
  const canonicalNames = new Set<string>([
    ...SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`),
    ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`)
  ])

  if (registry.version !== 1 || registry.contract !== 'shadcn-v2') {
    throw new Error('[theme-contract] migration registry must use the shadcn-v2 version 1 contract')
  }
  if (registry.defaultKind !== 'css-custom-property') {
    throw new Error('[theme-contract] migration registry defaultKind must be css-custom-property')
  }
  for (const requiredPath of REQUIRED_EXCLUDES) {
    if (!registry.exclude.includes(requiredPath)) {
      throw new Error(`[theme-contract] migration registry must exclude ${requiredPath}`)
    }
  }

  const rulesBySource = new Map<string, MigrationRule>()
  for (const rule of registry.rules) {
    if (!VARIABLE_NAME_PATTERN.test(rule.source)) {
      throw new Error(`[theme-contract] invalid migration source ${rule.source}`)
    }
    if (rulesBySource.has(rule.source)) {
      throw new Error(`[theme-contract] duplicate migration source ${rule.source}`)
    }
    if (!MIGRATION_STRATEGIES.has(rule.strategy)) {
      throw new Error(`[theme-contract] ${rule.source} uses unknown migration strategy ${rule.strategy}`)
    }
    if (rule.strategy === 'exact' && !rule.target) {
      throw new Error(`[theme-contract] exact migration ${rule.source} requires a target`)
    }
    if (rule.target && !VARIABLE_NAME_PATTERN.test(rule.target)) {
      throw new Error(`[theme-contract] invalid migration target ${rule.target}`)
    }
    if (rule.target && !canonicalNames.has(rule.target)) {
      throw new Error(`[theme-contract] migration ${rule.source} points outside the canonical contract: ${rule.target}`)
    }
    if (rule.target === rule.source) {
      throw new Error(`[theme-contract] migration ${rule.source} cannot target itself`)
    }

    rulesBySource.set(rule.source, rule)
  }

  if (/\.dark\s*\{/.test(stripComments(sources.legacyAliases))) {
    throw new Error('[theme-contract] legacy compatibility aliases cannot own dark-mode overrides')
  }
  if (/\.dark\s*\{/.test(stripComments(sources.rendererTheme))) {
    throw new Error('[theme-contract] renderer app aliases cannot own dark-mode overrides')
  }

  assertCompatibilityAliases(
    'legacy compatibility layer',
    extractDeclarations(sources.legacyAliases, () => true),
    canonicalNames,
    rulesBySource
  )
  const appAliasNames = assertCompatibilityAliases(
    'renderer app compatibility layer',
    extractDeclarations(sources.rendererTheme, (name) => name.startsWith('--app-')),
    canonicalNames,
    rulesBySource
  )

  const appReferences = new Set(
    [...stripComments(sources.rendererTheme).matchAll(/var\(\s*(--app-[a-z0-9-]+)/g)].map((match) => match[1])
  )
  for (const reference of appReferences) {
    if (!appAliasNames.has(reference)) {
      throw new Error(`[theme-contract] renderer theme references undeclared app alias ${reference}`)
    }
  }
  for (const name of appAliasNames) {
    if (!appReferences.has(name)) {
      throw new Error(`[theme-contract] renderer app alias ${name} is not exposed by the renderer adapter`)
    }
  }
}

export async function loadMigrationContractSources(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT
): Promise<MigrationContractSources> {
  const [migrationRegistry, legacyAliases, rendererTheme] = await Promise.all([
    fs.readFile(path.join(repositoryRoot, 'packages/ui/src/styles/migrations/shadcn-v2.json'), 'utf8'),
    fs.readFile(path.join(repositoryRoot, 'src/renderer/assets/styles/legacy-vars.css'), 'utf8'),
    fs.readFile(path.join(repositoryRoot, 'src/renderer/assets/styles/tailwind.css'), 'utf8')
  ])

  return { migrationRegistry, legacyAliases, rendererTheme }
}

export async function validateMigrationContract(repositoryRoot = DEFAULT_REPOSITORY_ROOT): Promise<void> {
  validateMigrationContractSources(await loadMigrationContractSources(repositoryRoot))
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void validateMigrationContract().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
