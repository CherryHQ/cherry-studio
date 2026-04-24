import { application } from '@application'
import { loggerService } from '@logger'
import { getMcpApiService } from '@main/apiServer/services/mcp'
import { type ModelValidationError, validateModelId } from '@main/apiServer/utils'
import { buildFunctionCallToolName } from '@shared/mcp'
import type { AgentType, SlashCommand, SystemProviderId, Tool } from '@types'
import fs from 'fs'
import path from 'path'

import { type AgentModelField, AgentModelValidationError } from './errors'
import { builtinSlashCommands } from './services/claudecode/commands'
import { builtinTools } from './services/claudecode/tools'

const logger = loggerService.withContext('agentUtils')

const MCP_TOOL_ID_PREFIX = 'mcp__'
const MCP_TOOL_LEGACY_PREFIX = 'mcp_'

const buildMcpToolId = (serverId: string, toolName: string) => `${MCP_TOOL_ID_PREFIX}${serverId}__${toolName}`

const toLegacyMcpToolId = (toolId: string): string | null => {
  if (!toolId.startsWith(MCP_TOOL_ID_PREFIX)) {
    return null
  }
  const rawId = toolId.slice(MCP_TOOL_ID_PREFIX.length)
  return `${MCP_TOOL_LEGACY_PREFIX}${rawId.replace(/__/g, '_')}`
}

export function ensurePathsExist(paths?: string[]): string[] {
  if (!paths?.length) {
    return []
  }

  const sanitizedPaths: string[] = []
  const seenPaths = new Set<string>()

  for (const rawPath of paths) {
    if (!rawPath) {
      continue
    }

    if (!path.isAbsolute(rawPath)) {
      throw new Error(`Accessible path must be absolute: ${rawPath}`)
    }

    const resolvedPath = path.normalize(rawPath)

    let stats: fs.Stats | null = null
    try {
      if (fs.existsSync(resolvedPath)) {
        stats = fs.statSync(resolvedPath)
      }
    } catch (error) {
      logger.warn('Failed to inspect accessible path', {
        path: rawPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const looksLikeFile =
      (stats && stats.isFile()) || (!stats && path.extname(resolvedPath) !== '' && !resolvedPath.endsWith(path.sep))

    const directoryToEnsure = looksLikeFile ? path.dirname(resolvedPath) : resolvedPath

    if (!fs.existsSync(directoryToEnsure)) {
      try {
        fs.mkdirSync(directoryToEnsure, { recursive: true })
      } catch (error) {
        logger.error('Failed to create accessible path directory', {
          path: directoryToEnsure,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }

    if (!seenPaths.has(resolvedPath)) {
      seenPaths.add(resolvedPath)
      sanitizedPaths.push(resolvedPath)
    }
  }

  return sanitizedPaths
}

export function resolveAccessiblePaths(paths: string[] | undefined, id: string): string[] {
  if (!paths || paths.length === 0) {
    const shortId = id.substring(id.length - 9)
    paths = [path.join(application.getPath('feature.agents.workspaces'), shortId)]
  }
  return ensurePathsExist(paths)
}

export async function validateAgentModels(
  agentType: AgentType,
  models: Partial<Record<AgentModelField, string | undefined>>
): Promise<void> {
  const entries = Object.entries(models) as [AgentModelField, string | undefined][]
  if (entries.length === 0) {
    return
  }

  const localProvidersWithoutApiKey: readonly string[] = ['ollama', 'lmstudio'] satisfies SystemProviderId[]

  for (const [field, rawValue] of entries) {
    if (rawValue === undefined || rawValue === null) {
      continue
    }

    const modelValue = rawValue
    const validation = await validateModelId(modelValue)

    if (!validation.valid || !validation.provider) {
      const detail: ModelValidationError = validation.error ?? {
        type: 'invalid_format',
        message: 'Unknown model validation error',
        code: 'validation_error'
      }

      throw new AgentModelValidationError({ agentType, field, model: modelValue }, detail)
    }

    const requiresApiKey = !localProvidersWithoutApiKey.includes(validation.provider.id)

    if (!validation.provider.apiKey) {
      if (requiresApiKey) {
        throw new AgentModelValidationError(
          { agentType, field, model: modelValue },
          {
            type: 'invalid_format',
            message: `Provider '${validation.provider.id}' is missing an API key`,
            code: 'provider_api_key_missing'
          }
        )
      } else {
        validation.provider.apiKey = validation.provider.id
      }
    }
  }
}

export async function listMcpTools(
  agentType: AgentType,
  ids?: string[]
): Promise<{ tools: Tool[]; legacyIdMap: Map<string, string> }> {
  const tools: Tool[] = []
  const legacyIdMap = new Map<string, string>()

  if (agentType === 'claude-code') {
    tools.push(...builtinTools)
  }

  if (ids && ids.length > 0) {
    for (const id of ids) {
      try {
        const server = await getMcpApiService().getServerInfo(id)
        if (server) {
          server.tools.forEach((tool) => {
            const canonicalId = buildFunctionCallToolName(server.name, tool.name)
            const serverIdBasedId = buildMcpToolId(id, tool.name)
            const legacyId = toLegacyMcpToolId(serverIdBasedId)

            tools.push({
              id: canonicalId,
              name: tool.name,
              type: 'mcp',
              description: tool.description || '',
              requirePermissions: true
            })
            legacyIdMap.set(serverIdBasedId, canonicalId)
            if (legacyId) {
              legacyIdMap.set(legacyId, canonicalId)
            }
          })
        }
      } catch (error) {
        logger.warn('Failed to list MCP tools', {
          id,
          error: error as Error
        })
      }
    }
  }

  return { tools, legacyIdMap }
}

type McpServerInfo = Awaited<ReturnType<ReturnType<typeof getMcpApiService>['getServerInfo']>>

export async function prefetchMcpServers(ids: string[]): Promise<Map<string, McpServerInfo>> {
  const cache = new Map<string, McpServerInfo>()
  await Promise.all(
    ids.map(async (id) => {
      try {
        cache.set(id, await getMcpApiService().getServerInfo(id))
      } catch (error) {
        logger.warn('Failed to prefetch MCP server', { id, error: error as Error })
        cache.set(id, null)
      }
    })
  )
  return cache
}

export function listMcpToolsFromCache(
  agentType: AgentType,
  ids: string[] | undefined,
  serverCache: Map<string, McpServerInfo>
): { tools: Tool[]; legacyIdMap: Map<string, string> } {
  const tools: Tool[] = []
  const legacyIdMap = new Map<string, string>()

  if (agentType === 'claude-code') {
    tools.push(...builtinTools)
  }

  if (ids && ids.length > 0) {
    for (const id of ids) {
      const server = serverCache.get(id)
      if (server) {
        server.tools.forEach((tool) => {
          const canonicalId = buildFunctionCallToolName(server.name, tool.name)
          const serverIdBasedId = buildMcpToolId(id, tool.name)
          const legacyId = toLegacyMcpToolId(serverIdBasedId)

          tools.push({
            id: canonicalId,
            name: tool.name,
            type: 'mcp',
            description: tool.description || '',
            requirePermissions: true
          })
          legacyIdMap.set(serverIdBasedId, canonicalId)
          if (legacyId) {
            legacyIdMap.set(legacyId, canonicalId)
          }
        })
      }
    }
  }

  return { tools, legacyIdMap }
}

export function normalizeAllowedTools(
  allowedTools: string[] | undefined,
  tools: Tool[],
  legacyIdMap?: Map<string, string>
): string[] | undefined {
  if (!allowedTools || allowedTools.length === 0) {
    return allowedTools
  }

  const resolvedLegacyIdMap = new Map<string, string>()

  if (legacyIdMap) {
    for (const [legacyId, canonicalId] of legacyIdMap) {
      resolvedLegacyIdMap.set(legacyId, canonicalId)
    }
  }

  for (const tool of tools) {
    if (tool.type !== 'mcp') {
      continue
    }
    const legacyId = toLegacyMcpToolId(tool.id)
    if (!legacyId) {
      continue
    }
    resolvedLegacyIdMap.set(legacyId, tool.id)
  }

  if (resolvedLegacyIdMap.size === 0) {
    return allowedTools
  }

  const normalized = allowedTools.map((toolId) => resolvedLegacyIdMap.get(toolId) ?? toolId)
  return Array.from(new Set(normalized))
}

export async function listSlashCommands(agentType: AgentType): Promise<SlashCommand[]> {
  if (agentType === 'claude-code') {
    return builtinSlashCommands
  }
  return []
}
