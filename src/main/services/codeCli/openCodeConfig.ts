import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import { parseJSONC } from '@main/utils/jsonc'
import type { OpenCodeProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('OpenCodeConfig')

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
const CHERRY_PROVIDER_PREFIX = 'Cherry-'

/** Pick the @ai-sdk npm package for the provider, by model endpoint type then provider type. */
function resolveNpmPackage(endpointType: string, providerType: string): string {
  if (endpointType === 'anthropic' || (!endpointType && providerType === 'anthropic')) {
    return '@ai-sdk/anthropic'
  }
  if (endpointType === 'openai-response' || (!endpointType && providerType === 'openai-response')) {
    return '@ai-sdk/openai'
  }
  return '@ai-sdk/openai-compatible'
}

/**
 * Build the OpenCode config with a Cherry-namespaced provider merged in: the provider lives under
 * `provider["Cherry-<name>"]` with the API key inlined into `options.apiKey`. Stale `Cherry-*`
 * providers are dropped so only the active one remains; all user-authored entries are preserved.
 * Returns null when required fields are missing.
 */
export function buildOpenCodeConfig(
  existing: Record<string, any>,
  config: OpenCodeProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, model } = config
  if (!apiKey || !baseUrl || !model) {
    return null
  }

  const providerType = config.providerType || 'openai-compatible'
  const providerName = config.providerName || 'Studio'
  const endpointType = config.endpointType || ''

  const modelConfig: Record<string, any> = { name: config.modelName || model }
  if (config.isReasoning) {
    modelConfig.reasoning = true
    if (endpointType === 'anthropic' || (!endpointType && providerType === 'anthropic')) {
      const budgetTokens = config.budgetTokens ?? 10000
      modelConfig.options = { thinking: { budgetTokens, type: 'enabled' } }
    } else if (config.supportsReasoningEffort) {
      modelConfig.options = { reasoningEffort: 'medium' }
    }
  }

  if (config.contextLimit !== undefined || config.outputLimit !== undefined) {
    const limit: Record<string, number> = {}
    if (config.contextLimit !== undefined) limit.context = config.contextLimit
    if (config.outputLimit !== undefined) limit.output = config.outputLimit
    modelConfig.limit = { ...(modelConfig.limit ?? {}), ...limit }
  }

  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`
  const cherryProvider = {
    npm: resolveNpmPackage(endpointType, providerType),
    name: providerKey,
    options: { apiKey, baseURL: baseUrl },
    models: { [model]: modelConfig }
  }

  const existingProviders = existing.provider && typeof existing.provider === 'object' ? existing.provider : {}
  const preservedProviders = Object.fromEntries(
    Object.entries(existingProviders).filter(([key]) => !key.startsWith(CHERRY_PROVIDER_PREFIX))
  )

  return {
    $schema: OPENCODE_SCHEMA,
    ...existing,
    provider: { ...preservedProviders, [providerKey]: cherryProvider }
  }
}

/** Persist the OpenCode provider config to ~/.config/opencode/opencode.json (merged, atomic). */
export async function writeOpenCodeConfig(config: OpenCodeProviderConfig): Promise<void> {
  const configPath = application.getPath('external.opencode.config', 'opencode.json')

  let existing: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    const parsed = parseJSONC(fs.readFileSync(configPath, 'utf8'))
    if (parsed) {
      existing = parsed
    }
  }

  const merged = buildOpenCodeConfig(existing, config)
  if (!merged) {
    throw new Error('OpenCode provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await atomicWriteFile(configPath as FilePath, `${JSON.stringify(merged, null, 2)}\n`)
  if (!isWin) {
    try {
      await fs.promises.chmod(configPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.config/opencode/opencode.json to 0600', error as Error)
    }
  }
  logger.info(`Wrote OpenCode provider config to ${configPath}`)
}
