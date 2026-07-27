import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import type { ManagedCliInventoryEntry } from '@main/services/BinaryManager'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { TOOL_KEY_RE, TOOL_NAME_RE } from '@shared/data/presets/binaryTools'
import * as z from 'zod'

const logger = loggerService.withContext('McpServer:CherryCliTools')

export const CLI_LIST_TOOL_NAME = 'cli_list'
export const CLI_SEARCH_TOOL_NAME = 'cli_search'
export const CLI_INSTALL_TOOL_NAME = 'cli_install'

const CANDIDATE_TTL_MS = 10 * 60 * 1000
const MAX_CANDIDATES = 50
const TRUSTED_RECIPE = /^(?:npm|pipx|cargo|go|github|aqua):[A-Za-z0-9@][A-Za-z0-9@:/_.-]*$/
const SHELL_CONTROL = /[;&|`$<>\n\r]/

const cliSearchSourceSchema = z.enum(['auto', 'mise', 'npm', 'pypi', 'cargo', 'go', 'github', 'aqua'])
export type CliSearchSource = z.infer<typeof cliSearchSourceSchema>
const candidateSourceSchema = z.enum(['mise-registry', 'mise', 'npm', 'pypi', 'cargo', 'go', 'github', 'aqua'])
export type CliCandidateSource = z.infer<typeof candidateSourceSchema>

type CliCandidate = {
  candidateId: string
  name: string
  recipe: string
  source: CliCandidateSource
  requestedVersion?: string
  expiresAt: number
}

type ExplicitSource = {
  recipe: string
  source: Exclude<CliCandidateSource, 'mise-registry'>
  requestedVersion?: string
  executable?: string
}

type CandidateSeed = Pick<CliCandidate, 'recipe' | 'source' | 'requestedVersion'>

const cliSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'A mise tool name, an exact package/module/repository identifier from trusted documentation, or the exact public install command shown by that documentation. Do not invent recipe prefixes.'
      ),
    source: cliSearchSourceSchema
      .optional()
      .describe(
        'Select the ecosystem named by the installation guide. Omit or use auto for mise registry lookup and exact-command detection.'
      ),
    executable: z
      .string()
      .trim()
      .regex(TOOL_NAME_RE)
      .optional()
      .describe('The real command placed on PATH, when it cannot be proven from the package/source identifier.')
  })
  .strict()

const cliInstallInputSchema = z
  .object({
    candidateId: z.string().uuid(),
    name: z.string().regex(TOOL_NAME_RE),
    recipe: z.string().regex(TOOL_KEY_RE),
    source: candidateSourceSchema,
    requestedVersion: z.string().regex(TOOL_KEY_RE).optional()
  })
  .strict()

function toJsonResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

function toInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

const CLI_TOOLS: readonly Tool[] = [
  {
    name: CLI_LIST_TOOL_NAME,
    description:
      'List the current Cherry-managed CLI inventory, including bundled tools, dependency presets, custom tools, and Code CLIs. Use this before assuming a command is unavailable.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: CLI_SEARCH_TOOL_NAME,
    description:
      'Find a managed CLI install candidate. A bare query searches mise; when trusted documentation names an ecosystem, select source and pass its exact package/module/repository identifier without adding a recipe prefix. This never performs a fuzzy internet search.',
    inputSchema: toInputSchema(cliSearchInputSchema)
  },
  {
    name: CLI_INSTALL_TOOL_NAME,
    description:
      'Install a candidate returned by cli_search into Cherry Studio’s isolated mise environment. Echo every candidate field exactly; modified, expired, or cross-session candidates are rejected.',
    inputSchema: toInputSchema(cliInstallInputSchema)
  }
]

function splitNpmPackage(spec: string): { packageName: string; version?: string } | null {
  const versionSeparator = spec.startsWith('@') ? spec.indexOf('@', spec.indexOf('/') + 1) : spec.lastIndexOf('@')
  const packageName = versionSeparator > 0 ? spec.slice(0, versionSeparator) : spec
  const version = versionSeparator > 0 ? spec.slice(versionSeparator + 1) : undefined
  if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageName)) return null
  if (version !== undefined && (!version || !TOOL_KEY_RE.test(version))) return null
  return { packageName, ...(version ? { version } : {}) }
}

function splitPythonPackage(spec: string): { packageName: string; version?: string } | null {
  const match = spec.match(/^([A-Za-z0-9._-]+)(?:==([A-Za-z0-9@:/_.-]+))?$/)
  return match ? { packageName: match[1], ...(match[2] ? { version: match[2] } : {}) } : null
}

function trustedRecipe(value: string): ExplicitSource | null {
  if (!TRUSTED_RECIPE.test(value) || value.includes('..') || value.includes('//')) return null
  const prefix = value.slice(0, value.indexOf(':'))
  const source = (prefix === 'pipx' ? 'pypi' : prefix) as ExplicitSource['source']
  return { recipe: value, source }
}

function parseExplicitSource(query: string): ExplicitSource | null {
  if (SHELL_CONTROL.test(query) || /(?:token|password|authorization|registry=|index-url)/i.test(query)) return null
  const tokens = query.trim().split(/\s+/)
  if (tokens.length === 1) {
    const recipe = trustedRecipe(tokens[0])
    if (recipe) return recipe
  }

  if (tokens[0] === 'mise' && (tokens[1] === 'use' || tokens[1] === 'install')) {
    const recipe = tokens.find((token, index) => index >= 2 && !token.startsWith('-'))
    return recipe ? trustedRecipe(recipe) : null
  }

  if (tokens[0] === 'npx' || (tokens[0] === 'bun' && tokens[1] === 'x')) {
    let index = tokens[0] === 'npx' ? 1 : 2
    while (tokens[index] === '-y' || tokens[index] === '--yes' || tokens[index] === '--no-install') index++
    if (tokens[index] === '-p' || tokens[index] === '--package') {
      const parsed = splitNpmPackage(tokens[index + 1] ?? '')
      const executable = tokens[index + 2]
      return parsed && executable && TOOL_NAME_RE.test(executable)
        ? {
            recipe: `npm:${parsed.packageName}`,
            source: 'npm',
            executable,
            ...(parsed.version ? { requestedVersion: parsed.version } : {})
          }
        : null
    }
    const parsed = splitNpmPackage(tokens[index] ?? '')
    return parsed
      ? {
          recipe: `npm:${parsed.packageName}`,
          source: 'npm',
          ...(parsed.version ? { requestedVersion: parsed.version } : {})
        }
      : null
  }

  if (
    (tokens[0] === 'npm' && (tokens[1] === 'install' || tokens[1] === 'i')) ||
    (tokens[0] === 'pnpm' && (tokens[1] === 'add' || tokens[1] === 'install')) ||
    (tokens[0] === 'bun' && (tokens[1] === 'add' || tokens[1] === 'install'))
  ) {
    const packageSpec = tokens
      .slice(2)
      .find((token) => token !== '-g' && token !== '--global' && !token.startsWith('-'))
    const parsed = splitNpmPackage(packageSpec ?? '')
    return parsed
      ? {
          recipe: `npm:${parsed.packageName}`,
          source: 'npm',
          ...(parsed.version ? { requestedVersion: parsed.version } : {})
        }
      : null
  }

  if (
    (tokens[0] === 'pipx' && (tokens[1] === 'install' || tokens[1] === 'run')) ||
    (tokens[0] === 'uv' && tokens[1] === 'tool' && tokens[2] === 'install') ||
    tokens[0] === 'uvx'
  ) {
    const start = tokens[0] === 'uvx' ? 1 : tokens[0] === 'pipx' ? 2 : 3
    const parsed = splitPythonPackage(tokens.slice(start).find((token) => !token.startsWith('-')) ?? '')
    return parsed
      ? {
          recipe: `pipx:${parsed.packageName}`,
          source: 'pypi',
          ...(parsed.version ? { requestedVersion: parsed.version } : {})
        }
      : null
  }

  if (tokens[0] === 'cargo' && tokens[1] === 'install') {
    const crate = tokens.slice(2).find((token) => !token.startsWith('-'))
    if (!crate || !/^[A-Za-z0-9._-]+$/.test(crate)) return null
    const versionIndex = tokens.indexOf('--version')
    const requestedVersion = versionIndex >= 0 ? tokens[versionIndex + 1] : undefined
    if (requestedVersion && !TOOL_KEY_RE.test(requestedVersion)) return null
    return { recipe: `cargo:${crate}`, source: 'cargo', ...(requestedVersion ? { requestedVersion } : {}) }
  }

  if (tokens[0] === 'go' && tokens[1] === 'install') {
    const spec = tokens[2]
    if (!spec) return null
    const separator = spec.lastIndexOf('@')
    const module = separator > 0 ? spec.slice(0, separator) : spec
    const requestedVersion = separator > 0 ? spec.slice(separator + 1) : undefined
    if (!/^[A-Za-z0-9._/-]+$/.test(module) || module.includes('..')) return null
    if (requestedVersion && !TOOL_KEY_RE.test(requestedVersion)) return null
    return { recipe: `go:${module}`, source: 'go', ...(requestedVersion ? { requestedVersion } : {}) }
  }

  const github = query.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/releases(?:\/.*)?)?\/?$/)
  return github ? { recipe: `github:${github[1]}/${github[2]}`, source: 'github' } : null
}

function explicitSourceIdentifier(
  source: Exclude<CliSearchSource, 'auto' | 'mise'>,
  query: string
): ExplicitSource | null {
  if (SHELL_CONTROL.test(query) || /\s/.test(query) || query.includes('..') || query.includes('//')) return null

  const recipe = trustedRecipe(query)
  if (recipe) return recipe.source === source ? recipe : null

  switch (source) {
    case 'npm': {
      const parsed = splitNpmPackage(query)
      return parsed
        ? {
            recipe: `npm:${parsed.packageName}`,
            source,
            ...(parsed.version ? { requestedVersion: parsed.version } : {})
          }
        : null
    }
    case 'pypi': {
      const parsed = splitPythonPackage(query)
      return parsed
        ? {
            recipe: `pipx:${parsed.packageName}`,
            source,
            ...(parsed.version ? { requestedVersion: parsed.version } : {})
          }
        : null
    }
    case 'cargo': {
      const separator = query.lastIndexOf('@')
      const crate = separator > 0 ? query.slice(0, separator) : query
      const requestedVersion = separator > 0 ? query.slice(separator + 1) : undefined
      if (!/^[A-Za-z0-9._-]+$/.test(crate) || (requestedVersion && !TOOL_KEY_RE.test(requestedVersion))) return null
      return { recipe: `cargo:${crate}`, source, ...(requestedVersion ? { requestedVersion } : {}) }
    }
    case 'go': {
      const separator = query.lastIndexOf('@')
      const module = separator > 0 ? query.slice(0, separator) : query
      const requestedVersion = separator > 0 ? query.slice(separator + 1) : undefined
      if (!/^[A-Za-z0-9._/-]+$/.test(module) || (requestedVersion && !TOOL_KEY_RE.test(requestedVersion))) return null
      return { recipe: `go:${module}`, source, ...(requestedVersion ? { requestedVersion } : {}) }
    }
    case 'github':
    case 'aqua':
      return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(query) ? { recipe: `${source}:${query}`, source } : null
  }
}

function candidateSourceForRecipe(recipe: string): CliCandidateSource {
  const separator = recipe.indexOf(':')
  if (separator < 0) return 'mise-registry'
  switch (recipe.slice(0, separator)) {
    case 'npm':
      return 'npm'
    case 'pipx':
      return 'pypi'
    case 'cargo':
      return 'cargo'
    case 'go':
      return 'go'
    case 'github':
      return 'github'
    case 'aqua':
      return 'aqua'
    default:
      return 'mise'
  }
}

function sameCandidate(input: z.infer<typeof cliInstallInputSchema>, candidate: CliCandidate): boolean {
  return (
    input.candidateId === candidate.candidateId &&
    input.name === candidate.name &&
    input.recipe === candidate.recipe &&
    input.source === candidate.source &&
    input.requestedVersion === candidate.requestedVersion
  )
}

export class CherryCliTools {
  private readonly candidates = new Map<string, CliCandidate>()

  tools(): Tool[] {
    return [...CLI_TOOLS]
  }

  handles(toolName: string): boolean {
    return toolName === CLI_LIST_TOOL_NAME || toolName === CLI_SEARCH_TOOL_NAME || toolName === CLI_INSTALL_TOOL_NAME
  }

  async call(toolName: string, args: unknown): Promise<CallToolResult> {
    try {
      if (toolName === CLI_LIST_TOOL_NAME) {
        return toJsonResult({ tools: await application.get('BinaryManager').getToolInventory() })
      }
      if (toolName === CLI_SEARCH_TOOL_NAME) return this.search(args)
      if (toolName === CLI_INSTALL_TOOL_NAME) return this.install(args)
      return toJsonResult({ error: `Unknown tool: ${toolName}` }, true)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      logger.error('cherry-tools CLI call failed', normalized, { tool: toolName })
      return toJsonResult({ error: normalized.message }, true)
    }
  }

  private async search(args: unknown): Promise<CallToolResult> {
    const { query, source = 'auto', executable } = cliSearchInputSchema.parse(args ?? {})
    this.pruneCandidates()
    const explicit = parseExplicitSource(query)
    if (explicit) {
      if (source !== 'auto' && explicit.source !== source) {
        return toJsonResult(
          {
            status: 'source_mismatch',
            message: `The explicit installation source resolves to ${explicit.source}, not ${source}.`
          },
          true
        )
      }
      return this.explicitCandidate(query, explicit, executable)
    }

    if (source !== 'auto' && source !== 'mise') {
      const selected = explicitSourceIdentifier(source, query)
      if (!selected) {
        return toJsonResult(
          {
            status: 'invalid_source_identifier',
            source,
            message: `Pass the exact public ${source} package/module/repository identifier from trusted documentation, without a recipe prefix.`
          },
          true
        )
      }
      return this.explicitCandidate(query, selected, executable)
    }

    const miseRegistryTutorial = query.match(
      /^mise\s+(?:use|install)(?:\s+(?:-g|--global))?\s+([A-Za-z][A-Za-z0-9_-]*)$/
    )
    if (query.includes('://') || (query.trim().split(/\s+/).length > 1 && !miseRegistryTutorial)) {
      return toJsonResult(
        {
          status: 'unsupported_source',
          message:
            'Only public mise recipes, npm, PyPI/pipx, Cargo, Go modules, GitHub Releases, and aqua sources are accepted.'
        },
        true
      )
    }

    const registryQuery = miseRegistryTutorial?.[1] ?? query
    const binaryManager = application.get('BinaryManager')
    const normalizedQuery = registryQuery.toLowerCase()
    const inventoryMatches = (await binaryManager.getToolInventory()).filter(
      (entry) => entry.recipe && entry.name.toLowerCase().includes(normalizedQuery)
    )
    const ready = inventoryMatches.filter((entry) => entry.status === 'ready')
    const managedCandidates = inventoryMatches.flatMap((entry) => {
      const recipe = entry.recipe
      if (!recipe || entry.status === 'ready') return []
      return [
        this.addCandidate(entry.name, {
          recipe,
          source: candidateSourceForRecipe(recipe),
          ...(entry.requestedVersion ? { requestedVersion: entry.requestedVersion } : {})
        })
      ]
    })
    if (managedCandidates.length > 0) {
      return toJsonResult({
        status: 'candidates',
        candidates: managedCandidates,
        ...(ready.length > 0 ? { ready } : {})
      })
    }
    if (ready.length > 0) return toJsonResult({ status: 'ready', tools: ready })

    const matches = await binaryManager.searchRegistry(registryQuery)
    const candidates = matches.map((match) =>
      this.addCandidate(match.name, { recipe: match.tool, source: 'mise-registry' })
    )
    if (candidates.length === 0) {
      return toJsonResult({
        status: 'needs_source',
        registryQuery,
        candidates: [],
        sourceOptions: cliSearchSourceSchema.options.filter((option) => option !== 'auto' && option !== 'mise'),
        message:
          'No mise registry match. Find a trusted installation guide, select its ecosystem in source, then retry with the exact package/module/repository identifier and real executable. Do not fall back to a one-off runner for a CLI that needs login, configuration, or reuse.'
      })
    }
    return toJsonResult({ status: 'candidates', candidates })
  }

  private async explicitCandidate(
    query: string,
    explicit: ExplicitSource,
    executable?: string
  ): Promise<CallToolResult> {
    const name = executable ?? explicit.executable
    if (!name) {
      return toJsonResult({
        status: 'needs_executable',
        recipe: explicit.recipe,
        source: explicit.source,
        ...(explicit.requestedVersion ? { requestedVersion: explicit.requestedVersion } : {}),
        retry: { query, source: explicit.source, executable: '<real command from the installation guide>' },
        message:
          'Retry cli_search with executable set to the real command named by the installation guide; the package/source does not prove it.'
      })
    }

    const existing = (await application.get('BinaryManager').getToolInventory()).find(
      (entry) => entry.name === name && entry.recipe
    )
    if (existing?.recipe) {
      if (existing.status === 'ready') {
        return toJsonResult({
          status: 'ready',
          tools: [existing],
          ...(existing.recipe !== explicit.recipe
            ? { message: `Using Cherry’s canonical managed recipe ${existing.recipe} instead of ${explicit.recipe}.` }
            : {})
        })
      }
      const canonical: CandidateSeed =
        existing.recipe === explicit.recipe
          ? explicit
          : {
              recipe: existing.recipe,
              source: candidateSourceForRecipe(existing.recipe),
              ...(existing.requestedVersion ? { requestedVersion: existing.requestedVersion } : {})
            }
      return toJsonResult({
        status: 'candidates',
        candidates: [this.addCandidate(name, canonical)],
        ...(existing.recipe !== explicit.recipe
          ? { message: `Using Cherry’s canonical managed recipe ${existing.recipe} instead of ${explicit.recipe}.` }
          : {})
      })
    }

    return toJsonResult({ status: 'candidates', candidates: [this.addCandidate(name, explicit)] })
  }

  private async install(args: unknown): Promise<CallToolResult> {
    const input = cliInstallInputSchema.parse(args ?? {})
    this.pruneCandidates()
    const candidate = this.candidates.get(input.candidateId)
    if (!candidate || candidate.expiresAt <= Date.now() || !sameCandidate(input, candidate)) {
      return toJsonResult(
        { error: 'Candidate is expired, modified, or belongs to another session. Run cli_search again.' },
        true
      )
    }

    const binaryManager = application.get('BinaryManager')
    const inventory = await binaryManager.getToolInventory()
    const existing = inventory.find((entry) => entry.name === candidate.name)
    if (existing?.recipe && existing.recipe !== candidate.recipe) {
      return toJsonResult({ error: `CLI ${candidate.name} is already defined by a different managed recipe.` }, true)
    }

    if (existing?.recipe === candidate.recipe) {
      await binaryManager.installByName({
        name: candidate.name,
        ...(candidate.requestedVersion ? { targetVersion: candidate.requestedVersion } : {})
      })
    } else {
      await binaryManager.addCustomTool({
        name: candidate.name,
        tool: candidate.recipe,
        ...(candidate.requestedVersion ? { requestedVersion: candidate.requestedVersion } : {})
      })
    }

    const updated = (await binaryManager.getToolInventory({ force: true })).find(
      (entry) => entry.name === candidate.name
    )
    if (!updated || updated.status !== 'ready') {
      return toJsonResult(
        {
          status: 'failed',
          tool: updated ?? { name: candidate.name },
          message: 'Managed install did not become ready.'
        },
        true
      )
    }
    return toJsonResult({ status: 'ready', tool: updated })
  }

  private addCandidate(name: string, source: CandidateSeed): CliCandidate {
    const candidate: CliCandidate = {
      candidateId: randomUUID(),
      name,
      recipe: source.recipe,
      source: source.source,
      ...(source.requestedVersion ? { requestedVersion: source.requestedVersion } : {}),
      expiresAt: Date.now() + CANDIDATE_TTL_MS
    }
    this.candidates.set(candidate.candidateId, candidate)
    while (this.candidates.size > MAX_CANDIDATES) {
      const oldest = this.candidates.keys().next().value
      if (!oldest) break
      this.candidates.delete(oldest)
    }
    return candidate
  }

  private pruneCandidates() {
    const now = Date.now()
    for (const [id, candidate] of this.candidates) {
      if (candidate.expiresAt <= now) this.candidates.delete(id)
    }
  }
}

export function readyCliSummary(entries: readonly ManagedCliInventoryEntry[], limit = 20): string[] {
  return entries
    .filter((entry) => entry.status === 'ready')
    .slice(0, limit)
    .map((entry) => `${entry.name}${entry.installedVersion ? ` (${entry.installedVersion})` : ''}`)
}
