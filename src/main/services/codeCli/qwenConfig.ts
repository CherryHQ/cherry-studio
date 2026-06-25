import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import { parseJSONC } from '@main/utils/jsonc'
import type { QwenProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('QwenConfig')

/** Serialize the provider config to the KEY=VALUE lines of ~/.qwen/.env. */
export function buildQwenEnvFile(config: QwenProviderConfig): string | null {
  const entries: string[] = []
  if (config.apiKey) entries.push(`OPENAI_API_KEY=${config.apiKey}`)
  if (config.baseUrl) entries.push(`OPENAI_BASE_URL=${config.baseUrl}`)
  if (config.model) entries.push(`OPENAI_MODEL=${config.model}`)
  if (entries.length === 0) {
    return null
  }
  return `${entries.join('\n')}\n`
}

/** Set `security.auth.selectedType = 'openai'` so the CLI uses OpenAI-compatible auth, preserving other keys. */
export function buildQwenSettings(existing: Record<string, any>): Record<string, any> {
  const security = existing.security && typeof existing.security === 'object' ? existing.security : {}
  const auth = security.auth && typeof security.auth === 'object' ? security.auth : {}
  return {
    ...existing,
    security: { ...security, auth: { ...auth, selectedType: 'openai' } }
  }
}

/** Persist the Qwen provider config to ~/.qwen/.env + settings.json. */
export async function writeQwenConfig(config: QwenProviderConfig): Promise<void> {
  const envFileContent = buildQwenEnvFile(config)
  if (!envFileContent) {
    throw new Error('Qwen provider config is missing required fields')
  }

  const dir = application.getPath('external.qwen_code.config')
  const envPath = application.getPath('external.qwen_code.config', '.env')
  const settingsPath = application.getPath('external.qwen_code.config', 'settings.json')

  await fs.promises.mkdir(dir, { recursive: true })
  await atomicWriteFile(envPath as FilePath, envFileContent)

  let existingSettings: Record<string, any> = {}
  if (fs.existsSync(settingsPath)) {
    const parsed = parseJSONC(fs.readFileSync(settingsPath, 'utf8'))
    if (parsed) {
      existingSettings = parsed
    }
  }
  await atomicWriteFile(settingsPath as FilePath, `${JSON.stringify(buildQwenSettings(existingSettings), null, 2)}\n`)

  if (!isWin) {
    for (const target of [envPath, settingsPath]) {
      try {
        await fs.promises.chmod(target, 0o600)
      } catch (error) {
        logger.warn(`Failed to chmod ${target} to 0600`, error as Error)
      }
    }
  }
  logger.info(`Wrote Qwen provider config to ${dir}`)
}
