import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import type { HermesProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'
import YAML from 'js-yaml'

const logger = loggerService.withContext('HermesConfig')

const PROVIDER_ENTRY_KEYS = ['name', 'base_url', 'api_key', 'api_mode', 'model', 'models'] as const

export function buildHermesConfig(
  existing: Record<string, any>,
  config: HermesProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, apiMode, model, modelName, providerName, contextLength, maxTokens } = config
  if (!apiKey || !baseUrl || !model) {
    return null
  }

  const modelConfig: Record<string, any> = modelName ? { name: modelName } : {}
  if (contextLength !== undefined) modelConfig.context_length = contextLength
  if (maxTokens !== undefined) modelConfig.max_tokens = maxTokens

  const entry: Record<string, any> = {
    name: providerName,
    base_url: baseUrl,
    api_key: apiKey,
    api_mode: apiMode || 'chat_completions',
    model,
    models: { [model]: modelConfig }
  }

  const customProviders: any[] = Array.isArray(existing.custom_providers) ? [...existing.custom_providers] : []
  const existingIndex = customProviders.findIndex((p: any) => p?.name === providerName)
  if (existingIndex >= 0) {
    const existingEntry = customProviders[existingIndex]
    const preserved: Record<string, any> = {}
    for (const [key, value] of Object.entries(existingEntry)) {
      if (!PROVIDER_ENTRY_KEYS.includes(key as (typeof PROVIDER_ENTRY_KEYS)[number])) {
        preserved[key] = value
      }
    }
    customProviders[existingIndex] = { ...preserved, ...entry }
  } else {
    customProviders.push(entry)
  }

  return { ...existing, custom_providers: customProviders }
}

export async function writeHermesConfig(config: HermesProviderConfig): Promise<void> {
  const configPath = application.getPath('external.hermes.config', 'config.yaml')

  let existing: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8')
      if (content.trim()) {
        existing = (YAML.load(content) as Record<string, any>) || {}
      }
    } catch (error) {
      logger.warn('Failed to parse existing ~/.hermes/config.yaml, recreating', error as Error)
    }
  }

  const merged = buildHermesConfig(existing, config)
  if (!merged) {
    throw new Error('Hermes provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await atomicWriteFile(configPath as FilePath, YAML.dump(merged, { indent: 2, lineWidth: -1 }))
  if (!isWin) {
    try {
      await fs.promises.chmod(configPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.hermes/config.yaml to 0600', error as Error)
    }
  }
  logger.info(`Wrote Hermes provider config to ${configPath}`)
}
