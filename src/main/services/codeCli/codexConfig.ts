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

const CODEX_MANAGED_TOP_LEVEL_KEYS = [
  'model_reasoning_effort',
  'disable_response_storage',
  'personality',
  'model_verbosity',
  'model_context_window',
  'model_auto_compact_token_limit',
  'review_model'
] as const

export function buildCodexConfig(
  existing: Record<string, any>,
  config: CodexProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, providerName, model } = config
  if (!apiKey || !baseUrl || !providerName) {
    return null
  }

  const providerKey = `Cherry-${providerName.replace(/\./g, '-')}`
  const existingProviders =
    existing.model_providers && typeof existing.model_providers === 'object' ? existing.model_providers : {}

  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith('Cherry-'))
  )

  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(existing)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEYS.includes(key as (typeof CODEX_MANAGED_TOP_LEVEL_KEYS)[number])) {
      cleaned[key] = value
    }
  }

  const merged: Record<string, any> = {
    ...cleaned,
    model,
    model_provider: providerKey,
    model_reasoning_effort: config.reasoningEffort ?? 'high',
    disable_response_storage: config.disableResponseStorage ?? true,
    model_providers: {
      ...preservedProviders,
      [providerKey]: {
        name: providerName,
        base_url: baseUrl.replace(/\/$/, ''),
        wire_api: 'responses',
        experimental_bearer_token: apiKey
      }
    }
  }

  if (config.personality !== undefined) merged.personality = config.personality
  if (config.verbosity !== undefined) merged.model_verbosity = config.verbosity
  if (config.contextWindow !== undefined) merged.model_context_window = config.contextWindow
  if (config.autoCompactTokenLimit !== undefined) merged.model_auto_compact_token_limit = config.autoCompactTokenLimit
  if (config.reviewModel !== undefined) merged.review_model = config.reviewModel

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
