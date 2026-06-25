import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import type { KimiProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

const logger = loggerService.withContext('KimiConfig')

const CHERRY_PROVIDER_KEY = 'cherry'

/**
 * Merge a Cherry-namespaced provider + model into Kimi's config object, preserving the user's other
 * providers/models, and point `default_model` at the Cherry alias. Returns null when required
 * fields are missing.
 */
export function buildKimiConfig(existing: Record<string, any>, config: KimiProviderConfig): Record<string, any> | null {
  const { apiKey, model } = config
  if (!apiKey || !model) {
    return null
  }

  const alias = `${CHERRY_PROVIDER_KEY}/${model}`
  const provider: Record<string, string> = {
    type: config.providerType || 'openai',
    api_key: apiKey
  }
  if (config.baseUrl) {
    provider.base_url = config.baseUrl
  }

  const existingProviders = existing.providers && typeof existing.providers === 'object' ? existing.providers : {}
  const existingModels = existing.models && typeof existing.models === 'object' ? existing.models : {}

  return {
    ...existing,
    default_model: alias,
    providers: { ...existingProviders, [CHERRY_PROVIDER_KEY]: provider },
    models: { ...existingModels, [alias]: { provider: CHERRY_PROVIDER_KEY, model } }
  }
}

/** Persist the Kimi provider config to ~/.kimi-code/config.toml (merged, atomic). */
export async function writeKimiConfig(config: KimiProviderConfig): Promise<void> {
  const configPath = application.getPath('external.kimi_code.config', 'config.toml')

  let existing: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    try {
      existing = parseToml(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    } catch (error) {
      logger.warn('Failed to parse existing ~/.kimi-code/config.toml, recreating', error as Error)
    }
  }

  const merged = buildKimiConfig(existing, config)
  if (!merged) {
    throw new Error('Kimi provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await atomicWriteFile(configPath as FilePath, stringifyToml(merged))
  if (!isWin) {
    try {
      await fs.promises.chmod(configPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.kimi-code/config.toml to 0600', error as Error)
    }
  }
  logger.info(`Wrote Kimi provider config to ${configPath}`)
}
