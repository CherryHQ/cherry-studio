import { CodeCli } from '@shared/types/codeCli'

import { parseDotenv } from './dotenv'
import { getDraftFile } from './draftFiles'
import { parseJsonOrThrow, parseTomlOrThrow } from './file'
import { CLAUDE_MANAGED_ENV_KEYS, CLAUDE_MANAGED_PERMISSION_KEYS, CLAUDE_MANAGED_TOP_LEVEL_KEYS } from './managedKeys'
import {
  codexConfigToPermissionMode,
  isClaudePermissionMode,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  isOpenCodePermissionMode
} from './permissionModes'
import { sanitizeGeminiConfigBlob, sanitizeKimiConfigBlob, sanitizeQwenConfigBlob } from './sanitize'
import type { CliConfigConnection, CliConfigFileDraft } from './types'
import { asRecord, findCherryProviderKey, isCherryManagedModel, stringValue } from './values'

export function extractConnectionFromCliConfigDraft(
  cliTool: string,
  files: CliConfigFileDraft[]
): CliConfigConnection | null {
  const connection = extractConnectionFromCliConfigDraftInternal(cliTool, files)
  if (!connection) return null
  // An existing-but-empty config file (e.g. `{}`) parses to an all-undefined connection object,
  // which is truthy — callers doing `if (!connection)` would otherwise misread it as a real,
  // non-matching foreign connection instead of "no connection info here".
  return connection.baseUrl || connection.apiKey || connection.model ? connection : null
}

function extractConnectionFromCliConfigDraftInternal(
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
        const providerKey = findCherryProviderKey(providers)
        const provider = asRecord(providerKey ? providers[providerKey] : undefined)
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
        const modelEntry = models.find((item: any) => isCherryManagedModel(item))
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
          if (key === 'effortLevel') {
            if (isClaudeReasoningEffort(settings[key])) out[key] = settings[key]
          } else if (settings[key] !== undefined) out[key] = settings[key]
        }
        const permissions = asRecord(settings.permissions)
        for (const key of CLAUDE_MANAGED_PERMISSION_KEYS) {
          if (key === 'defaultMode' && isClaudePermissionMode(permissions[key])) {
            out.permissions = { ...asRecord(out.permissions), [key]: permissions[key] }
          }
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
        const permissionMode = codexConfigToPermissionMode(config)
        if (permissionMode) out.permissionMode = permissionMode
        if (isCodexReasoningEffort(config.model_reasoning_effort)) out.reasoningEffort = config.model_reasoning_effort
        const providerKey = stringValue(config.model_provider)
        const provider = providerKey ? asRecord(asRecord(config.model_providers)[providerKey]) : {}
        if (provider.name === 'OpenAI') out.remoteCompaction = true
        return out
      }
      case CodeCli.OPEN_CODE: {
        const config = parseJsonOrThrow(getDraftFile(files, 'opencode-config')?.content ?? '')
        const out: Record<string, any> = {}
        if (config.autoCompact === true) out.autoCompact = true
        if (isOpenCodePermissionMode(config.permission)) out.permissionMode = config.permission
        const providers = asRecord(config.provider)
        const providerKey = findCherryProviderKey(providers)
        const provider = asRecord(providerKey ? providers[providerKey] : undefined)
        const model = asRecord(Object.entries(asRecord(provider.models))[0]?.[1])
        if (model.reasoning === true) out.env = { OPENCODE_REASONING: 'true' }
        return out
      }
      case CodeCli.GEMINI_CLI: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'gemini-settings')?.content ?? '')
        return sanitizeGeminiConfigBlob(settings)
      }
      case CodeCli.QWEN_CODE: {
        const settings = parseJsonOrThrow(getDraftFile(files, 'qwen-settings')?.content ?? '')
        return sanitizeQwenConfigBlob(settings)
      }
      case CodeCli.KIMI_CODE: {
        const config = parseTomlOrThrow(getDraftFile(files, 'kimi-config')?.content ?? '')
        return sanitizeKimiConfigBlob(config)
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
