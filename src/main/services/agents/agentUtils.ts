import { application } from '@application'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { AgentType, SystemProviderId } from '@types'
import fs from 'fs'
import path from 'path'

import { type AgentModelField, AgentModelValidationError } from './errors'

const logger = loggerService.withContext('agentUtils')

/**
 * Walk a list of absolute workspace paths: skip empty/duplicate entries,
 * auto-create missing parent directories, and return the deduplicated result.
 * Rejects relative paths to keep Claude Code's `cwd` hermetic.
 */
function ensurePathsExist(paths?: string[]): string[] {
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

/**
 * Pick the accessible-paths set for a new agent: either the caller-supplied
 * list (validated via `ensurePathsExist`) or a default per-agent workspace
 * under `feature.agents.workspaces/<last9-of-id>`.
 */
export function resolveAccessiblePaths(paths: string[] | undefined, id: string): string[] {
  if (!paths || paths.length === 0) {
    const shortId = id.substring(id.length - 9)
    paths = [path.join(application.getPath('feature.agents.workspaces'), shortId)]
  }
  return ensurePathsExist(paths)
}

/**
 * Validate that each model string is a UniqueModelId whose provider exists in
 * the DataApi provider registry and has at least one enabled API key (or is
 * a local provider that doesn't require one: ollama / lmstudio).
 *
 * Throws `AgentModelValidationError` on the first failure so the caller can
 * surface it as a typed field error.
 */
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

    // Parse UniqueModelId and resolve provider
    let providerId: string
    try {
      const parsed = parseUniqueModelId(modelValue as UniqueModelId)
      providerId = parsed.providerId
    } catch {
      throw new AgentModelValidationError(
        { agentType, field, model: modelValue },
        { type: 'invalid_format', message: `Invalid model format: ${modelValue}`, code: 'invalid_model_format' }
      )
    }

    const provider = await providerService.getByProviderId(providerId).catch(() => null)
    if (!provider) {
      throw new AgentModelValidationError(
        { agentType, field, model: modelValue },
        { type: 'provider_not_found', message: `Provider '${providerId}' not found`, code: 'provider_not_found' }
      )
    }

    const requiresApiKey = !localProvidersWithoutApiKey.includes(provider.id)
    const hasApiKey = provider.apiKeys?.some((k) => k.isEnabled)

    if (!hasApiKey && requiresApiKey) {
      throw new AgentModelValidationError(
        { agentType, field, model: modelValue },
        {
          type: 'invalid_format',
          message: `Provider '${provider.id}' is missing an API key`,
          code: 'provider_api_key_missing'
        }
      )
    }
  }
}
