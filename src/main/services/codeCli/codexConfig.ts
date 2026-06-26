import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import type { CodexProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

const logger = loggerService.withContext('CodexConfig')

/**
 * Merge the Cherry provider routing into an existing Codex config object, preserving the user's
 * other top-level keys and model_providers. The API key is inlined as experimental_bearer_token.
 * Returns null when required fields are missing.
 */
export function buildCodexConfig(
  existing: Record<string, any>,
  config: CodexProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, providerName, model } = config
  if (!apiKey || !baseUrl || !providerName) {
    return null
  }

  // Cherry- prefix avoids colliding with Codex's reserved built-in provider IDs.
  const providerKey = `Cherry-${providerName.replace(/\./g, '-')}`
  const existingProviders =
    existing.model_providers && typeof existing.model_providers === 'object' ? existing.model_providers : {}

  const merged: Record<string, any> = {
    ...existing,
    model,
    model_provider: providerKey,
    model_reasoning_effort: config.reasoningEffort ?? existing.model_reasoning_effort ?? 'high',
    disable_response_storage: config.disableResponseStorage ?? existing.disable_response_storage ?? true,
    model_providers: {
      ...existingProviders,
      [providerKey]: {
        name: providerName,
        base_url: baseUrl.replace(/\/$/, ''),
        wire_api: 'responses',
        experimental_bearer_token: apiKey
      }
    }
  }

  if (config.personality !== undefined) merged.personality = config.personality
  else if (existing.personality !== undefined) merged.personality = existing.personality

  if (config.verbosity !== undefined) merged.model_verbosity = config.verbosity
  else if (existing.model_verbosity !== undefined) merged.model_verbosity = existing.model_verbosity

  if (config.contextWindow !== undefined) merged.model_context_window = config.contextWindow
  else if (existing.model_context_window !== undefined) merged.model_context_window = existing.model_context_window

  if (config.autoCompactTokenLimit !== undefined) merged.model_auto_compact_token_limit = config.autoCompactTokenLimit
  else if (existing.model_auto_compact_token_limit !== undefined)
    merged.model_auto_compact_token_limit = existing.model_auto_compact_token_limit

  if (config.reviewModel !== undefined) merged.review_model = config.reviewModel
  else if (existing.review_model !== undefined) merged.review_model = existing.review_model

  return merged
}

/** Persist the Codex provider config to ~/.codex/config.toml (merged, atomic). */
export async function writeCodexConfig(config: CodexProviderConfig): Promise<void> {
  const configPath = application.getPath('external.codex.config', 'config.toml')

  let existing: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    try {
      existing = parseToml(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    } catch (error) {
      logger.warn('Failed to parse existing ~/.codex/config.toml, recreating', error as Error)
    }
  }

  const merged = buildCodexConfig(existing, config)
  if (!merged) {
    throw new Error('Codex provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await atomicWriteFile(configPath as FilePath, stringifyToml(merged))
  if (!isWin) {
    try {
      await fs.promises.chmod(configPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.codex/config.toml to 0600', error as Error)
    }
  }
  logger.info(`Wrote Codex provider config to ${configPath}`)
}
