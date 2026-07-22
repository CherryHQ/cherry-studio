import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { CHERRY_PRODUCT_VARIABLE_TOKENS, SHADCN_VARIABLE_TOKENS } from './theme-contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '../../..')
const VARIABLE_NAME_PATTERN = /^--[a-z0-9-]+$/
const TAILWIND_ADAPTER_VARIABLE_PATTERN = /--color-[a-z0-9-]*/
const MIGRATION_STRATEGIES = new Set(['exact', 'contextual', 'review', 'preserve'])
const STYLE_SOURCE_EXTENSIONS = new Set(['.css'])
const TYPESCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const REQUIRED_EXCLUDES = [
  'packages/ui/src/styles/theme.css',
  'packages/ui/src/styles/contract.css',
  'packages/ui/src/styles/theme-input.css',
  'packages/ui/src/styles/shadcn.css',
  'packages/ui/src/styles/product.css',
  'packages/ui/src/styles/tokens/**',
  'packages/ui/scripts/migrations/**',
  'src/renderer/assets/styles/legacy-vars.css',
  'src/renderer/assets/styles/tailwind.css',
  'src/main/ai/mcp/servers/browser/tabbarHtml.ts',
  'resources/devtools/main-network/panel.css',
  'packages/ui/scripts/__tests__/**'
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
  rendererStyles: Record<string, string>
  rendererTypeScriptSources: Record<string, string>
}

type SourceEntry = readonly [fileName: string, source: string]

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

async function loadSourceEntries(
  directory: string,
  repositoryRoot: string,
  extensions: ReadonlySet<string>
): Promise<SourceEntry[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nestedEntries = await Promise.all(
    entries.map(async (entry): Promise<SourceEntry[]> => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) return loadSourceEntries(entryPath, repositoryRoot, extensions)
      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) return []

      return [[path.relative(repositoryRoot, entryPath), await fs.readFile(entryPath, 'utf8')]]
    })
  )

  return nestedEntries.flat()
}

function findTypeScriptAdapterVariable(source: string, fileName: string): string | undefined {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  let adapterVariable: string | undefined

  const inspect = (value: string): void => {
    adapterVariable ??= value.match(TAILWIND_ADAPTER_VARIABLE_PATTERN)?.[0]
  }

  const visit = (node: ts.Node): void => {
    if (adapterVariable) return

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      inspect(node.text)
      return
    }

    if (ts.isTemplateExpression(node)) {
      inspect(node.head.text)
      for (const span of node.templateSpans) {
        visit(span.expression)
        inspect(span.literal.text)
        if (adapterVariable) return
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return adapterVariable
}

export function validateMigrationContractSources(sources: MigrationContractSources): void {
  const registry = parseMigrationRegistry(sources.migrationRegistry)
  const canonicalNames = new Set<string>([
    ...SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`),
    ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--${token}`)
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

  if (sources.legacyAliases.trim() !== '') {
    throw new Error('[theme-contract] legacy compatibility layer must remain removed')
  }

  const rendererTheme = stripComments(sources.rendererTheme)
  if (rendererTheme.includes('legacy-vars.css')) {
    throw new Error('[theme-contract] renderer theme cannot import the removed legacy compatibility layer')
  }
  if (rendererTheme.includes('--app-')) {
    throw new Error(
      '[theme-contract] renderer theme entry cannot own --app-* variables; keep host-local values in a dedicated stylesheet'
    )
  }
  if (/@theme(?:\s+inline)?\s*\{/.test(rendererTheme)) {
    throw new Error('[theme-contract] renderer theme must use the shared generated Tailwind adapter')
  }

  for (const [fileName, source] of Object.entries(sources.rendererStyles)) {
    const adapterVariable = stripComments(source).match(TAILWIND_ADAPTER_VARIABLE_PATTERN)?.[0]

    if (adapterVariable) {
      throw new Error(
        `[theme-contract] renderer stylesheet ${fileName} cannot use Tailwind adapter variable ${adapterVariable}; use runtime semantic variables directly`
      )
    }
  }

  for (const [fileName, source] of Object.entries(sources.rendererTypeScriptSources)) {
    if (!source.includes('--color-')) continue

    const adapterVariable = findTypeScriptAdapterVariable(source, fileName)

    if (adapterVariable) {
      throw new Error(
        `[theme-contract] renderer TypeScript source ${fileName} cannot use Tailwind adapter variable ${adapterVariable}; use runtime semantic variables or Tailwind utilities`
      )
    }
  }
}

export async function loadMigrationContractSources(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT
): Promise<MigrationContractSources> {
  const [migrationRegistry, legacyAliases, rendererTheme, rendererStyleEntries, rendererTypeScriptEntries] =
    await Promise.all([
      fs.readFile(path.join(repositoryRoot, 'packages/ui/scripts/migrations/shadcn-v2.json'), 'utf8'),
      fs
        .readFile(path.join(repositoryRoot, 'src/renderer/assets/styles/legacy-vars.css'), 'utf8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return ''
          throw error
        }),
      fs.readFile(path.join(repositoryRoot, 'src/renderer/assets/styles/tailwind.css'), 'utf8'),
      loadSourceEntries(path.join(repositoryRoot, 'src/renderer'), repositoryRoot, STYLE_SOURCE_EXTENSIONS),
      loadSourceEntries(path.join(repositoryRoot, 'src/renderer'), repositoryRoot, TYPESCRIPT_SOURCE_EXTENSIONS)
    ])

  return {
    migrationRegistry,
    legacyAliases,
    rendererTheme,
    rendererStyles: Object.fromEntries(rendererStyleEntries),
    rendererTypeScriptSources: Object.fromEntries(rendererTypeScriptEntries)
  }
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
