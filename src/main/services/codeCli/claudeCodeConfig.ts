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

const CLAUDE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'
] as const

const CLAUDE_MANAGED_TOP_LEVEL_KEYS = [
  'ENABLE_TOOL_SEARCH',
  'skipWebFetchPreflight',
  'includeCoAuthoredBy',
  'effortLevel',
  'enabledPlugins'
] as const

/** Merge the provider config into the settings `env` block, preserving the user's other keys. */
export function buildClaudeSettings(
  existing: Record<string, any>,
  config: ClaudeProviderConfig
): Record<string, any> | null {
  const envBlock: Record<string, string | number | boolean> = {}
  if (config.baseUrl) envBlock.ANTHROPIC_BASE_URL = config.baseUrl
  if (config.model) envBlock.ANTHROPIC_MODEL = config.model
  if (config.apiKey) envBlock.ANTHROPIC_API_KEY = config.apiKey
  if (config.authToken) envBlock.ANTHROPIC_AUTH_TOKEN = config.authToken
  if (config.haikuModel) envBlock.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel
  if (config.sonnetModel) envBlock.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel
  if (config.opusModel) envBlock.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel
  if (config.timeoutMs) envBlock.API_TIMEOUT_MS = config.timeoutMs
  if (config.maxOutputTokens) envBlock.CLAUDE_CODE_MAX_OUTPUT_TOKENS = config.maxOutputTokens
  if (config.disableNonessentialTraffic !== undefined)
    envBlock.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = config.disableNonessentialTraffic
  if (config.autoCompactWindow) envBlock.CLAUDE_CODE_AUTO_COMPACT_WINDOW = config.autoCompactWindow
  if (config.disableExperimentalBetas) envBlock.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = config.disableExperimentalBetas

  // Top-level settings (not env vars)
  const topLevel: Record<string, any> = {}
  if (config.enableToolSearch !== undefined) topLevel.ENABLE_TOOL_SEARCH = config.enableToolSearch
  if (config.skipWebFetchPreflight !== undefined) topLevel.skipWebFetchPreflight = config.skipWebFetchPreflight
  if (config.includeCoAuthoredBy !== undefined) topLevel.includeCoAuthoredBy = config.includeCoAuthoredBy
  if (config.effortLevel) topLevel.effortLevel = config.effortLevel
  if (config.enabledPlugins && Object.keys(config.enabledPlugins).length > 0)
    topLevel.enabledPlugins = config.enabledPlugins

  const hasEnv = Object.keys(envBlock).length > 0
  const hasTopLevel = Object.keys(topLevel).length > 0
  if (!hasEnv && !hasTopLevel) {
    return null
  }

  const existingEnv = existing.env && typeof existing.env === 'object' ? { ...existing.env } : null
  if (existingEnv) {
    for (const key of CLAUDE_MANAGED_ENV_KEYS) {
      delete existingEnv[key]
    }
  }

  const merged: Record<string, any> = { ...existing }
  for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) {
    delete merged[key]
  }
  if (hasTopLevel) {
    Object.assign(merged, topLevel)
  }

  if (existingEnv || hasEnv) {
    merged.env = { ...existingEnv, ...(hasEnv ? envBlock : {}) }
  }
  return merged
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
