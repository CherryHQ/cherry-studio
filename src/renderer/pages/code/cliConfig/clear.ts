import { CodeCli } from '@shared/types/codeCli'
import { stringify as stringifyToml } from 'smol-toml'

import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv } from './dotenv'
import {
  readExternalOrNull,
  readValidatedJsonOrNull,
  readValidatedTomlOrNull,
  renderDotenvFile,
  renderJsonFile,
  resolveAbs
} from './file'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_PERMISSION_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_ENV_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  OPEN_CODE_MANAGED_TOP_LEVEL_KEYS,
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
import {
  dropFeatureGoalsIfEmpty,
  dropSecurityAuthSelectedTypeIfEmpty,
  isCherryManagedModel,
  omitKeysByPrefix
} from './values'

const CODEX_MANAGED_TOP_LEVEL_KEY_SET = new Set<string>(CODEX_MANAGED_TOP_LEVEL_KEYS)

export interface ClearCliConfigArgs {
  /** CLI tool whose config file should be scrubbed. */
  cliTool: string
}

/** Remove every Cherry-managed key from a CLI tool's config file, leaving user-owned keys intact. */
export async function clearCliConfig(args: ClearCliConfigArgs): Promise<void> {
  const { cliTool } = args
  if (!FILE_CONFIGURED_CLI_TOOLS.has(cliTool)) return

  switch (cliTool) {
    case CodeCli.CLAUDE_CODE: {
      const absPath = await resolveAbs(CLAUDE_SETTINGS_PATH)
      const existing = await readValidatedJsonOrNull(absPath, 'Claude Code settings')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
      if (next.permissions && typeof next.permissions === 'object') {
        const permissions = { ...(next.permissions as Record<string, any>) }
        for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) delete permissions[key]
        if (Object.keys(permissions).length > 0) next.permissions = permissions
        else delete next.permissions
      }
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
      const existing = await readValidatedTomlOrNull(absPath, 'Codex config')
      const existingAuth = await readValidatedJsonOrNull(authAbsPath, 'Codex auth')
      if (existing) {
        const next: Record<string, any> = {}
        for (const [key, value] of Object.entries(existing)) {
          if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key) && key !== 'model' && key !== 'model_provider') {
            next[key] = value
          }
        }
        if (next.model_providers && typeof next.model_providers === 'object') {
          next.model_providers = omitKeysByPrefix(next.model_providers as Record<string, any>, CHERRY_PROVIDER_PREFIX)
        }
        dropFeatureGoalsIfEmpty(next)
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
      const existing = await readValidatedJsonOrNull(absPath, 'OpenCode config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      for (const key of OPEN_CODE_MANAGED_TOP_LEVEL_KEYS) delete next[key]
      if (next.provider && typeof next.provider === 'object') {
        next.provider = omitKeysByPrefix(next.provider as Record<string, any>, CHERRY_PROVIDER_PREFIX)
      }
      await window.api.file.write(absPath, renderJsonFile(next))
      return
    }
    case CodeCli.GEMINI_CLI: {
      const envAbsPath = await resolveAbs(GEMINI_ENV_PATH)
      const envText = await readExternalOrNull(envAbsPath)
      if (envText !== null) {
        const envMap = parseDotenv(envText)
        for (const key of GEMINI_MANAGED_ENV_KEYS) envMap.delete(key)
        await window.api.file.write(envAbsPath, renderDotenvFile(envMap))
      }

      const settingsAbsPath = await resolveAbs(GEMINI_SETTINGS_PATH)
      const settings = await readValidatedJsonOrNull(settingsAbsPath, 'Gemini CLI settings')
      if (!settings) return
      applyManagedJsonSettings(settings, {}, GEMINI_MANAGED_SETTINGS_KEYS)
      dropSecurityAuthSelectedTypeIfEmpty(settings)
      if (settings.model && typeof settings.model === 'object') {
        delete settings.model.name
        if (Object.keys(settings.model as Record<string, any>).length === 0) delete settings.model
      }
      await window.api.file.write(settingsAbsPath, renderJsonFile(settings))
      return
    }
    case CodeCli.QWEN_CODE: {
      const absPath = await resolveAbs(QWEN_CONFIG_PATH)
      const existing = await readValidatedJsonOrNull(absPath, 'Qwen Code config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      if (next.env && typeof next.env === 'object') {
        next.env = omitKeysByPrefix(next.env as Record<string, any>, 'CHERRY_')
      }
      if (Array.isArray(next.modelProviders?.openai)) {
        const filtered = next.modelProviders.openai.filter((model: any) => !isCherryManagedModel(model))
        next.modelProviders = { ...next.modelProviders, openai: filtered }
      }
      applyManagedJsonSettings(next, {}, QWEN_MANAGED_SETTINGS_KEYS)
      dropSecurityAuthSelectedTypeIfEmpty(next)
      delete next.model
      await window.api.file.write(absPath, renderJsonFile(next))
      return
    }
    case CodeCli.KIMI_CODE: {
      const absPath = await resolveAbs(KIMI_CONFIG_PATH)
      const existing = await readValidatedTomlOrNull(absPath, 'Kimi Code config')
      if (!existing) return
      const next: Record<string, any> = { ...existing }
      for (const table of ['providers', 'models'] as const) {
        if (next[table] && typeof next[table] === 'object') {
          next[table] = omitKeysByPrefix(next[table] as Record<string, any>, CHERRY_PROVIDER_PREFIX)
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
