import { CodeCli } from '@shared/types/codeCli'
import { stringify as stringifyToml } from 'smol-toml'

import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv } from './dotenv'
import { parseJsonOrThrow, parseTomlOrThrow, renderDotenvFile, renderJsonFile, resolveAbs } from './file'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_ENV_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import {
  CLAUDE_SETTINGS_PATH,
  CODEX_AUTH_PATH,
  CODEX_CONFIG_PATH,
  FILE_CONFIGURED_CLI_TOOLS,
  GEMINI_ENV_PATH,
  GEMINI_SETTINGS_PATH,
  KIMI_CONFIG_PATH,
  OPENCODE_CONFIG_PATH,
  QWEN_CONFIG_PATH
} from './targets'

export interface ClearCliConfigArgs {
  /** CLI tool whose config file should be scrubbed. */
  cliTool: string
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('File does not exist') || message.includes('ENOENT')
}

async function readExistingExternal(absPath: string): Promise<string | null> {
  try {
    return await window.api.file.readExternal(absPath)
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function readExistingValidatedJson(absPath: string, label: string): Promise<Record<string, any> | null> {
  const content = await readExistingExternal(absPath)
  if (content === null) return null
  try {
    return parseJsonOrThrow(content)
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function readExistingValidatedToml(absPath: string, label: string): Promise<Record<string, any> | null> {
  const content = await readExistingExternal(absPath)
  if (content === null) return null
  try {
    return parseTomlOrThrow(content)
  } catch (err) {
    throw new Error(`Failed to parse ${label} at ${absPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Remove every Cherry-managed key from a CLI tool's config file, leaving user-owned keys intact. */
export async function clearCliConfig(args: ClearCliConfigArgs): Promise<void> {
  const { cliTool } = args
  if (!FILE_CONFIGURED_CLI_TOOLS.has(cliTool)) return

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
      const existing = await readExistingValidatedJson(absPath, 'Claude Code settings')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
      if (next.env && typeof next.env === 'object') {
        const env = { ...(next.env as Record<string, any>) }
        for (const key of CLAUDE_MANAGED_ENV_KEYS) delete env[key]
        next.env = env
      }
      await window.api.file.write(absPath, renderJsonFile(next))
      return
    }
    case CodeCli.OPENAI_CODEX: {
      const absPath = await resolveAbs(CODEX_CONFIG_PATH)
      const authAbsPath = await resolveAbs(CODEX_AUTH_PATH)
      const existing = await readExistingValidatedToml(absPath, 'Codex config')
      const existingAuth = await readExistingValidatedJson(authAbsPath, 'Codex auth')
      if (existing) {
        const next: Record<string, any> = {}
        for (const [key, value] of Object.entries(existing)) {
          if (
            !(CODEX_MANAGED_TOP_LEVEL_KEYS as readonly string[]).includes(key) &&
            key !== 'model' &&
            key !== 'model_provider'
          ) {
            next[key] = value
          }
        }
        if (next.model_providers && typeof next.model_providers === 'object') {
          const modelProviders: Record<string, any> = {}
          for (const [key, value] of Object.entries(next.model_providers as Record<string, any>)) {
            if (!key.startsWith(CHERRY_PROVIDER_PREFIX)) modelProviders[key] = value
          }
          next.model_providers = modelProviders
        }
        if (next.features && typeof next.features === 'object') {
          const features = { ...(next.features as Record<string, any>) }
          delete features.goals
          if (Object.keys(features).length === 0) delete next.features
          else next.features = features
        }
        await window.api.file.write(absPath, stringifyToml(next))
      }
      if (existingAuth?.OPENAI_API_KEY !== undefined) {
        const nextAuth = { ...existingAuth }
        delete nextAuth.OPENAI_API_KEY
        await window.api.file.write(authAbsPath, renderJsonFile(nextAuth))
      }
      return
    }
    case CodeCli.OPEN_CODE: {
      const absPath = await resolveAbs(OPENCODE_CONFIG_PATH)
      const existing = await readExistingValidatedJson(absPath, 'OpenCode config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      if (next.provider && typeof next.provider === 'object') {
        const providers: Record<string, any> = {}
        for (const [key, value] of Object.entries(next.provider as Record<string, any>)) {
          if (!key.startsWith(CHERRY_PROVIDER_PREFIX)) providers[key] = value
        }
        next.provider = providers
      }
      await window.api.file.write(absPath, renderJsonFile(next))
      return
    }
    case CodeCli.GEMINI_CLI: {
      const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
      const envText = await readExistingExternal(envAbsPath)
      if (envText !== null) {
        const envMap = parseDotenv(envText)
        for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
        await window.api.file.write(envAbsPath, renderDotenvFile(envMap))
      }

      const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
      const settings = await readExistingValidatedJson(settingsAbsPath, 'Gemini CLI settings')
      if (!settings) return
      applyManagedJsonSettings(settings, {}, GEMINI_MANAGED_SETTINGS_KEYS)
      if (settings.model && typeof settings.model === 'object') {
        delete settings.model.name
        if (Object.keys(settings.model as Record<string, any>).length === 0) delete settings.model
      }
      await window.api.file.write(settingsAbsPath, renderJsonFile(settings))
      return
    }
    case CodeCli.QWEN_CODE: {
      const absPath = await resolveAbs(QWEN_CONFIG_PATH)
      const existing = await readExistingValidatedJson(absPath, 'Qwen Code config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      if (next.env && typeof next.env === 'object') {
        const env: Record<string, any> = {}
        for (const [key, value] of Object.entries(next.env as Record<string, any>)) {
          if (!key.startsWith('CHERRY_')) env[key] = value
        }
        next.env = env
      }
      if (Array.isArray(next.modelProviders?.openai)) {
        const filtered = next.modelProviders.openai.filter(
          (model: any) =>
            !(
              model &&
              typeof model === 'object' &&
              typeof model.envKey === 'string' &&
              model.envKey.startsWith('CHERRY_')
            )
        )
        next.modelProviders = { ...next.modelProviders, openai: filtered }
      }
      applyManagedJsonSettings(next, {}, QWEN_MANAGED_SETTINGS_KEYS)
      delete next.model
      await window.api.file.write(absPath, renderJsonFile(next))
      return
    }
    case CodeCli.KIMI_CODE: {
      const absPath = await resolveAbs(KIMI_CONFIG_PATH)
      const existing = await readExistingValidatedToml(absPath, 'Kimi Code config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      for (const table of ['providers', 'models'] as const) {
        if (next[table] && typeof next[table] === 'object') {
          const cleaned: Record<string, any> = {}
          for (const [key, value] of Object.entries(next[table] as Record<string, any>)) {
            if (!key.startsWith(CHERRY_PROVIDER_PREFIX)) cleaned[key] = value
          }
          next[table] = cleaned
        }
      }
      applyManagedTomlSettings(next, {})
      delete next.default_model
      await window.api.file.write(absPath, stringifyToml(next))
      return
    }
    default:
      return
  }
}
