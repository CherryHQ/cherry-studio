import { loggerService } from '@logger'
import { mcpApiService } from '@main/apiServer/services/mcp'
import type { ModelValidationError } from '@main/apiServer/utils'
import { validateModelId } from '@main/apiServer/utils'
import type { AgentType, MCPTool, SlashCommand, Tool } from '@types'
import { objectKeys } from '@types'
import fs from 'fs'
import path from 'path'

import { DatabaseManager } from './database/DatabaseManager'
import type { AgentModelField } from './errors'
import { AgentModelValidationError } from './errors'
import { builtinSlashCommands } from './services/claudecode/commands'
import { builtinTools } from './services/claudecode/tools'

const logger = loggerService.withContext('BaseService')

/**
 * Base service class providing shared utilities for all agent-related services.
 *
 * Features:
 * - Database access through DatabaseManager singleton
 * - JSON field serialization/deserialization
 * - Path validation and creation
 * - Model validation
 * - MCP tools and slash commands listing
 */
export abstract class BaseService {
  protected jsonFields: string[] = [
    'tools',
    'mcps',
    'configuration',
    'accessible_paths',
    'allowed_tools',
    'slash_commands'
  ]

  public async listMcpTools(agentType: AgentType, ids?: string[]): Promise<Tool[]> {
    const tools: Tool[] = []
    if (agentType === 'claude-code') {
      tools.push(...builtinTools)
    }
    if (ids && ids.length > 0) {
      for (const id of ids) {
        try {
          const server = await mcpApiService.getServerInfo(id)
          if (server) {
            server.tools.forEach((tool: MCPTool) => {
              tools.push({
                id: `mcp_${id}_${tool.name}`,
                name: tool.name,
                type: 'mcp',
                description: tool.description || '',
                requirePermissions: true
              })
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

    return tools
  }

  public async listSlashCommands(agentType: AgentType): Promise<SlashCommand[]> {
    if (agentType === 'claude-code') {
      return builtinSlashCommands
    }
    return []
  }

  /**
   * Get database instance
   * Automatically waits for initialization to complete
   */
  public async getDatabase() {
    const dbManager = await DatabaseManager.getInstance()
    return dbManager.getDatabase()
  }

  protected serializeJsonFields(data: any): any {
    const serialized = { ...data }

    for (const field of this.jsonFields) {
      if (serialized[field] !== undefined) {
        serialized[field] =
          Array.isArray(serialized[field]) || typeof serialized[field] === 'object'
            ? JSON.stringify(serialized[field])
            : serialized[field]
      }
    }

    return serialized
  }

  protected deserializeJsonFields(data: any): any {
    if (!data) return data

    const deserialized = { ...data }

    for (const field of this.jsonFields) {
      if (deserialized[field] && typeof deserialized[field] === 'string') {
        try {
          deserialized[field] = JSON.parse(deserialized[field])
        } catch (error) {
          logger.warn(`Failed to parse JSON field ${field}:`, error as Error)
        }
      }
    }

    // convert null from db to undefined to satisfy type definition
    for (const key of objectKeys(data)) {
      if (deserialized[key] === null) {
        deserialized[key] = undefined
      }
    }

    return deserialized
  }

  /**
   * Validate, normalize, and ensure filesystem access for a set of absolute paths.
   *
   * - Requires every entry to be an absolute path and throws if not.
   * - Normalizes each path and deduplicates while preserving order.
   * - Creates missing directories (or parent directories for file-like paths).
   */
  protected ensurePathsExist(paths?: string[]): string[] {
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

      // Normalize to provide consistent values to downstream consumers.
      const resolvedPath = path.normalize(rawPath)

      let stats: fs.Stats | null = null
      try {
        // Attempt to stat the path to understand whether it already exists and if it is a file.
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

      // For file-like targets create the parent directory; otherwise ensure the directory itself.
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

      // Preserve the first occurrence only to avoid duplicates while keeping caller order stable.
      if (!seenPaths.has(resolvedPath)) {
        seenPaths.add(resolvedPath)
        sanitizedPaths.push(resolvedPath)
      }
    }

    return sanitizedPaths
  }

  /**
   * Validate agent model configuration
   */
  protected async validateAgentModels(
    agentType: AgentType,
    models: Partial<Record<AgentModelField, string | undefined>>
  ): Promise<void> {
    const entries = Object.entries(models) as [AgentModelField, string | undefined][]
    if (entries.length === 0) {
      return
    }

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

      if (!validation.provider.apiKey) {
        throw new AgentModelValidationError(
          { agentType, field, model: modelValue },
          {
            type: 'invalid_format',
            message: `Provider '${validation.provider.id}' is missing an API key`,
            code: 'provider_api_key_missing'
          }
        )
      }
    }
  }
}
