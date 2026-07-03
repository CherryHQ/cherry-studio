import { CodeCli } from '@shared/types/codeCli'

import { CHERRY_PROVIDER_PREFIX } from './constants'
import { parseDotenv } from './dotenv'
import { getDraftFile } from './draftFiles'
import { parseJsonOrThrow, parseTomlOrThrow } from './file'
import {
  asRecord,
  CLAUDE_MANAGED_ENV_KEYS,
  CLAUDE_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  KIMI_MANAGED_SECTION_KEYS,
  KIMI_MANAGED_TOP_LEVEL_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import type { CliConfigConnection, CliConfigFileDraft } from './types'
import { numberValue, stringValue } from './values'

export function extractConnectionFromCliConfigDraft(
  cliTool: string,
  files: CliConfigFileDraft[]
): CliConfigConnection | null {
  try {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
        const env = asRecord(settings.env)
        return {
          baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
          apiKey: stringValue(env.ANTHROPIC_AUTH_TOKEN) ?? stringValue(env.ANTHROPIC_API_KEY),
          model: stringValue(env.ANTHROPIC_MODEL)
        }
      }
      case CodeCli.OPENAI_CODEX: {
        const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
        const auth = parseJsonOrThrow(getDraftFile(files, 'codex-auth')?.content ?? '')
        const providerKey = stringValue(config.model_provider)
        const provider = providerKey ? asRecord(asRecord(config.model_providers)[providerKey]) : {}
        return {
          baseUrl: stringValue(provider.base_url),
          apiKey: stringValue(auth.OPENAI_API_KEY),
          model: stringValue(config.model)
        }
      }
      case CodeCli.OPEN_CODE: {
        const config = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
        const providers = asRecord(config.provider)
        const entry = Object.entries(providers).find(([key]) => key.startsWith(CHERRY_PROVIDER_PREFIX))?.[1]
        const provider = asRecord(entry)
        const models = asRecord(provider.models)
        const modelEntry = Object.entries(models)[0]
        const model = stringValue(asRecord(modelEntry?.[1]).name) ?? modelEntry?.[0]
        return {
          baseUrl: stringValue(asRecord(provider.options).baseURL),
          apiKey: stringValue(asRecord(provider.options).apiKey),
          model
        }
      }
      case CodeCli.GEMINI_CLI: {
        const env = parseDotenv(getDraftFile(files, 'gemini-env')?.content ?? '')
        const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
        return {
          baseUrl: stringValue(env.get('GOOGLE_GEMINI_BASE_URL')),
          apiKey: stringValue(env.get('GEMINI_API_KEY')),
          model: stringValue(asRecord(settings.model).name)
        }
      }
      case CodeCli.QWEN_CODE: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
        const models = Array.isArray(settings.modelProviders?.openai) ? settings.modelProviders.openai : []
        const modelEntry = models.find(
          (item: any) =>
            item && typeof item === 'object' && typeof item.envKey === 'string' && item.envKey.startsWith('CHERRY_')
        )
        const envKey = stringValue(modelEntry?.envKey)
        return {
          baseUrl: stringValue(modelEntry?.baseUrl),
          apiKey: envKey ? stringValue(asRecord(settings.env)[envKey]) : undefined,
          model: stringValue(asRecord(settings.model).name) ?? stringValue(modelEntry?.id)
        }
      }
      case CodeCli.KIMI_CODE: {
        const config = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
        const modelKey = stringValue(config.default_model)
        const model = modelKey ? asRecord(asRecord(config.models)[modelKey]) : {}
        const providerKey = stringValue(model.provider) ?? modelKey
        const provider = providerKey ? asRecord(asRecord(config.providers)[providerKey]) : {}
        return {
          baseUrl: stringValue(provider.base_url),
          apiKey: stringValue(provider.api_key),
          model: stringValue(model.model) ?? modelKey
        }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

export function extractConfigFromCliConfigDraft(
  cliTool: string,
  files: CliConfigFileDraft[]
): Record<string, unknown> | null {
  try {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'claude-settings')?.content ?? '')
        const out: Record<string, any> = {}
        for (const key of CLAUDE_MANAGED_TOP_LEVEL_KEYS) {
          if (settings[key] !== undefined) out[key] = settings[key]
        }
        const env = { ...asRecord(settings.env) }
        for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']) {
          delete env[key]
        }
        for (const key of CLAUDE_MANAGED_ENV_KEYS) {
          if (env[key] !== undefined) out.env = { ...asRecord(out.env), [key]: env[key] }
        }
        return out
      }
      case CodeCli.OPENAI_CODEX: {
        const config = parseTomlOrThrow(getDraftFile(files, 'codex-config')?.content ?? '')
        const out: Record<string, any> = {}
        if (asRecord(config.features).goals === true) out.goalMode = true
        if (config.disable_response_storage === true) out.disableResponseStorage = true
        if (stringValue(config.model_reasoning_effort)) out.modelReasoningEffort = config.model_reasoning_effort
        if (stringValue(config.model_verbosity)) out.modelVerbosity = config.model_verbosity
        const contextWindow = numberValue(config.model_context_window)
        if (contextWindow !== undefined) out.modelContextWindow = contextWindow
        const autoCompactTokenLimit = numberValue(config.model_auto_compact_token_limit)
        if (autoCompactTokenLimit !== undefined) {
          out.modelAutoCompactTokenLimit = autoCompactTokenLimit
        }
        if (stringValue(config.personality)) out.personality = config.personality
        const providerKey = stringValue(config.model_provider)
        const provider = providerKey ? asRecord(asRecord(config.model_providers)[providerKey]) : {}
        if (provider.name === 'OpenAI') out.remoteCompaction = true
        return out
      }
      case CodeCli.OPEN_CODE: {
        const config = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
        const out: Record<string, any> = {}
        if (config.autoCompact === true) out.autoCompact = true
        const maxTurns = numberValue(config.maxTurns)
        if (maxTurns !== undefined) out.maxTurns = maxTurns
        const providers = asRecord(config.provider)
        const provider = asRecord(
          Object.entries(providers).find(([key]) => key.startsWith(CHERRY_PROVIDER_PREFIX))?.[1]
        )
        const model = asRecord(Object.entries(asRecord(provider.models))[0]?.[1])
        const options = asRecord(model.options)
        if (model.reasoning === true) out.env = { OPENCODE_REASONING: 'true' }
        if (stringValue(options.reasoningEffort)) out.reasoningEffort = options.reasoningEffort
        const thinking = asRecord(options.thinking)
        const thinkingConfig = asRecord(options.thinkingConfig)
        const budgetTokens = numberValue(thinking.budgetTokens)
        const thinkingBudget = numberValue(thinkingConfig.thinkingBudget)
        if (budgetTokens !== undefined) out.thinkingBudgetTokens = budgetTokens
        else if (thinkingBudget !== undefined) out.thinkingBudgetTokens = thinkingBudget
        return out
      }
      case CodeCli.GEMINI_CLI: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
        const out: Record<string, any> = {}
        for (const [section, keys] of Object.entries(GEMINI_MANAGED_SETTINGS_KEYS)) {
          const sourceSection = asRecord(settings[section])
          for (const key of keys) {
            if (sourceSection[key] !== undefined)
              out[section] = { ...asRecord(out[section]), [key]: sourceSection[key] }
          }
        }
        return out
      }
      case CodeCli.QWEN_CODE: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
        const out: Record<string, any> = {}
        for (const [section, keys] of Object.entries(QWEN_MANAGED_SETTINGS_KEYS)) {
          const sourceSection = asRecord(settings[section])
          for (const key of keys) {
            if (sourceSection[key] !== undefined)
              out[section] = { ...asRecord(out[section]), [key]: sourceSection[key] }
          }
        }
        return out
      }
      case CodeCli.KIMI_CODE: {
        const config = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
        const out: Record<string, any> = {}
        for (const key of KIMI_MANAGED_TOP_LEVEL_KEYS) {
          if (config[key] !== undefined) out[key] = config[key]
        }
        for (const [section, keys] of Object.entries(KIMI_MANAGED_SECTION_KEYS)) {
          const sourceSection = asRecord(config[section])
          for (const key of keys) {
            if (sourceSection[key] !== undefined)
              out[section] = { ...asRecord(out[section]), [key]: sourceSection[key] }
          }
        }
        return out
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
