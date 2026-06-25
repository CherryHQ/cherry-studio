import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import { parseJSONC } from '@main/utils/jsonc'
import type { GeminiProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('GeminiConfig')

/** Serialize the provider config to the KEY=VALUE lines of ~/.gemini/.env. */
export function buildGeminiEnvFile(config: GeminiProviderConfig): string | null {
  const entries: string[] = []
  if (config.apiKey) entries.push(`GEMINI_API_KEY=${config.apiKey}`)
  if (config.baseUrl) {
    entries.push(`GEMINI_BASE_URL=${config.baseUrl}`)
    entries.push(`GOOGLE_GEMINI_BASE_URL=${config.baseUrl}`)
  }
  if (config.model) entries.push(`GEMINI_MODEL=${config.model}`)
  if (entries.length === 0) {
    return null
  }
  return `${entries.join('\n')}\n`
}

/** Set `security.auth.selectedType = 'gemini-api-key'` so the CLI uses API-key auth, preserving other keys. */
export function buildGeminiSettings(existing: Record<string, any>): Record<string, any> {
  const security = existing.security && typeof existing.security === 'object' ? existing.security : {}
  const auth = security.auth && typeof security.auth === 'object' ? security.auth : {}
  return {
    ...existing,
    security: { ...security, auth: { ...auth, selectedType: 'gemini-api-key' } }
  }
}

/** Persist the Gemini provider config to ~/.gemini/.env + settings.json. */
export async function writeGeminiConfig(config: GeminiProviderConfig): Promise<void> {
  const envFileContent = buildGeminiEnvFile(config)
  if (!envFileContent) {
    throw new Error('Gemini provider config is missing required fields')
  }

  const dir = application.getPath('external.gemini_cli.config')
  const envPath = application.getPath('external.gemini_cli.config', '.env')
  const settingsPath = application.getPath('external.gemini_cli.config', 'settings.json')

  await fs.promises.mkdir(dir, { recursive: true })
  await atomicWriteFile(envPath as FilePath, envFileContent)

  let existingSettings: Record<string, any> = {}
  if (fs.existsSync(settingsPath)) {
    const parsed = parseJSONC(fs.readFileSync(settingsPath, 'utf8'))
    if (parsed) {
      existingSettings = parsed
    }
  }
  await atomicWriteFile(settingsPath as FilePath, `${JSON.stringify(buildGeminiSettings(existingSettings), null, 2)}\n`)

  if (!isWin) {
    for (const target of [envPath, settingsPath]) {
      try {
        await fs.promises.chmod(target, 0o600)
      } catch (error) {
        logger.warn(`Failed to chmod ${target} to 0600`, error as Error)
      }
    }
  }
  logger.info(`Wrote Gemini provider config to ${dir}`)
}
