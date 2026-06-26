import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import type { OpenClawProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'
import JSON5 from 'json5'

const logger = loggerService.withContext('OpenClawConfig')

const CHERRY_PROVIDER_PREFIX = 'cherry-'

const DEFAULT_CONFIG: Record<string, any> = {
  models: {
    mode: 'merge',
    providers: {}
  }
}

/**
 * Merge a Cherry-namespaced provider into the OpenClaw config's
 * `models.providers` section. Preserves all user-authored entries and
 * replaces any previous Cherry provider for the same name.
 * Returns null when required fields are missing.
 */
export function buildOpenClawConfig(
  existing: Record<string, any>,
  config: OpenClawProviderConfig
): Record<string, any> | null {
  const { apiKey, baseUrl, api, model, modelName, providerName } = config
  if (!apiKey || !baseUrl || !model) {
    return null
  }

  const providerKey = `${CHERRY_PROVIDER_PREFIX}${providerName}`

  const existingModels = existing.models && typeof existing.models === 'object' ? existing.models : {}
  const existingProviders =
    existingModels.providers && typeof existingModels.providers === 'object' ? existingModels.providers : {}

  const modelEntry: Record<string, any> = {
    id: model,
    name: modelName
  }
  if (config.reasoning !== undefined) modelEntry.reasoning = config.reasoning
  if (config.contextWindow !== undefined) modelEntry.contextWindow = config.contextWindow
  if (config.maxTokens !== undefined) modelEntry.maxTokens = config.maxTokens

  const cherryProvider: Record<string, any> = {
    baseUrl,
    apiKey,
    api,
    models: [modelEntry]
  }

  if (config.headers && Object.keys(config.headers).length > 0) {
    cherryProvider.headers = config.headers
  }

  return {
    ...existing,
    models: {
      ...existingModels,
      mode: existingModels.mode || 'merge',
      providers: { ...existingProviders, [providerKey]: cherryProvider }
    }
  }
}

/** Persist the OpenClaw provider config to ~/.openclaw/openclaw.json (JSON5, merged, atomic). */
export async function writeOpenClawConfig(config: OpenClawProviderConfig): Promise<void> {
  const configPath = application.getPath('external.openclaw.config', 'openclaw.json')

  let existing: Record<string, any> = { ...DEFAULT_CONFIG }
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON5.parse(fs.readFileSync(configPath, 'utf8'))
    } catch (error) {
      logger.warn('Failed to parse existing ~/.openclaw/openclaw.json, recreating', error as Error)
    }
  }

  const merged = buildOpenClawConfig(existing, config)
  if (!merged) {
    throw new Error('OpenClaw provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  // Use JSON5 stringify with 2-space indent to produce valid JSON5 (no trailing
  // commas, but valid JSON which is also valid JSON5 per the spec).
  await atomicWriteFile(configPath as FilePath, `${JSON5.stringify(merged, null, 2)}\n`)
  if (!isWin) {
    try {
      await fs.promises.chmod(configPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.openclaw/openclaw.json to 0600', error as Error)
    }
  }
  logger.info(`Wrote OpenClaw provider config to ${configPath}`)
}
