import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import { parseMigrationRegistry } from './migration-registry'
import { CHERRY_PRODUCT_VARIABLE_TOKENS, RUNTIME_THEME_INPUT_TOKENS, SHADCN_VARIABLE_TOKENS } from './theme-contract'

export { type MigrationRegistry, type MigrationRule, parseMigrationRegistry } from './migration-registry'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '../../..')
const TAILWIND_ADAPTER_VARIABLE_PATTERN = /--color-[a-z0-9-]*/
const STYLE_SOURCE_EXTENSIONS = new Set(['.css'])
const TYPESCRIPT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const RUNTIME_THEME_INPUT_VARIABLES = new Set(RUNTIME_THEME_INPUT_TOKENS.map((token) => `--cs-theme-${token}`))
const PUBLIC_SEMANTIC_VARIABLES = new Set([
  ...SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`),
  ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--${token}`)
])
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

export interface MigrationContractSources {
  migrationRegistry: string
  legacyAliases: string
  rendererTheme: string
  rendererStyles: Record<string, string>
  rendererTypeScriptSources: Record<string, string>
}

type SourceEntry = readonly [fileName: string, source: string]

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

function findTypeScriptDisallowedThemeWrite(source: string, fileName: string): string | undefined {
  if (!source.includes('setProperty')) return undefined

  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  let disallowedVariable: string | undefined

  const visit = (node: ts.Node): void => {
    if (disallowedVariable) return

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'setProperty'
    ) {
      const [nameArgument] = node.arguments
      let variableName: string | undefined

      if (nameArgument && (ts.isStringLiteral(nameArgument) || ts.isNoSubstitutionTemplateLiteral(nameArgument))) {
        variableName = nameArgument.text
      } else if (nameArgument && ts.isTemplateExpression(nameArgument)) {
        variableName = nameArgument.head.text.startsWith('--') ? `${nameArgument.head.text}*` : undefined
      }

      if (
        variableName &&
        ((variableName.startsWith('--cs-') && !RUNTIME_THEME_INPUT_VARIABLES.has(variableName)) ||
          PUBLIC_SEMANTIC_VARIABLES.has(variableName) ||
          variableName.startsWith('--color-'))
      ) {
        disallowedVariable = variableName
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return disallowedVariable
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

  for (const rule of registry.rules) {
    if (rule.target && !canonicalNames.has(rule.target)) {
      throw new Error(`[theme-contract] migration ${rule.source} points outside the canonical contract: ${rule.target}`)
    }
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
    const adapterVariable = source.includes('--color-') ? findTypeScriptAdapterVariable(source, fileName) : undefined

    if (adapterVariable) {
      throw new Error(
        `[theme-contract] renderer TypeScript source ${fileName} cannot use Tailwind adapter variable ${adapterVariable}; use runtime semantic variables or Tailwind utilities`
      )
    }

    const disallowedWrite = findTypeScriptDisallowedThemeWrite(source, fileName)
    if (disallowedWrite) {
      throw new Error(
        `[theme-contract] renderer TypeScript source ${fileName} cannot write shared theme variable ${disallowedWrite}; use a registered --cs-theme-* input or an owner-local --app-* variable`
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
