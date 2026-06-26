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

/**
 * Merge a provider into the Hermes config's `custom_providers` list.
 * Upserts by `name` — replaces if found, appends if new.
 * Returns null when required fields are missing.
 */
export function buildHermesConfig(
  existing: Record<string, any>,
  config: HermesProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, apiMode, model, modelName, providerName } = config
  if (!apiKey || !baseUrl || !model) {
    return null
  }

  const customProviders: any[] = Array.isArray(existing.custom_providers) ? [...existing.custom_providers] : []

  const entry: Record<string, any> = {
    name: providerName,
    base_url: baseUrl,
    api_key: apiKey,
    api_mode: apiMode || 'chat_completions',
    model,
    models: {
      [model]: {
        ...(modelName ? { name: modelName } : {})
      }
    }
  }

  const existingIndex = customProviders.findIndex((p: any) => p.name === providerName)
  if (existingIndex >= 0) {
    // Merge: preserve any on-disk fields the UI payload didn't include
    const existingEntry = customProviders[existingIndex]
    customProviders[existingIndex] = { ...existingEntry, ...entry }
  } else {
    customProviders.push(entry)
  }

  return {
    ...existing,
    custom_providers: customProviders
  }
}

/** Persist the Hermes provider config to ~/.hermes/config.yaml (YAML, merged, atomic). */
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
