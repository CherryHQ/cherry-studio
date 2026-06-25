import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { atomicWriteFile } from '@main/utils/file/fs'
import { parseJSONC } from '@main/utils/jsonc'
import type { ClaudeProviderConfig } from '@shared/types/codeCli'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('ClaudeCodeConfig')

/** Merge the provider config into the settings `env` block, preserving the user's other keys. */
export function buildClaudeSettings(
  existing: Record<string, any>,
  config: ClaudeProviderConfig
): Record<string, any> | null {
  const envBlock: Record<string, string> = {}
  if (config.baseUrl) envBlock.ANTHROPIC_BASE_URL = config.baseUrl
  if (config.model) envBlock.ANTHROPIC_MODEL = config.model
  if (config.apiKey) envBlock.ANTHROPIC_API_KEY = config.apiKey
  if (config.authToken) envBlock.ANTHROPIC_AUTH_TOKEN = config.authToken
  if (Object.keys(envBlock).length === 0) {
    return null
  }

  const existingEnv = existing.env && typeof existing.env === 'object' ? existing.env : {}
  return {
    ...existing,
    env: { ...existingEnv, ...envBlock }
  }
}

/** Persist the Claude Code provider config to ~/.claude/settings.json (merged, atomic). */
export async function writeClaudeCodeConfig(config: ClaudeProviderConfig): Promise<void> {
  const settingsPath = application.getPath('external.claude_code.config', 'settings.json')

  let existing: Record<string, any> = {}
  if (fs.existsSync(settingsPath)) {
    const parsed = parseJSONC(fs.readFileSync(settingsPath, 'utf8'))
    if (parsed) {
      existing = parsed
    }
  }

  const merged = buildClaudeSettings(existing, config)
  if (!merged) {
    throw new Error('Claude Code provider config is missing required fields')
  }

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
  await atomicWriteFile(settingsPath as FilePath, `${JSON.stringify(merged, null, 2)}\n`)
  if (!isWin) {
    try {
      await fs.promises.chmod(settingsPath, 0o600)
    } catch (error) {
      logger.warn('Failed to chmod ~/.claude/settings.json to 0600', error as Error)
    }
  }
  logger.info(`Wrote Claude Code provider config to ${settingsPath}`)
}
