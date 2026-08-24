import { CHERRY_PROVIDER_PREFIX } from './constants'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import { codexPermissionModeToConfig, isCodexPermissionMode, isCodexReasoningEffort } from './permissionModes'
import {
  asRecord,
  dropFeatureGoalsIfEmpty,
  dropSecurityAuthSelectedTypeIfEmpty,
  isCherryManagedModel,
  omitKeysByPrefix
} from './values'

/**
 * "Own login" config builders for the tool-param file of each login-capable CLI.
 *
 * Each strips every Cherry-managed credential / model / provider key (mirroring
 * `clearCliConfig`) and re-applies only the model-independent tool params from
 * the already-sanitized blob, so the CLI keeps using its own stored account
 * login. Credential-only side files (Codex `auth.json`, Gemini `.env`) carry no
 * tool params and are scrubbed by `clearCliConfig` on select, not here.
 */

const CODEX_MANAGED_TOP_LEVEL_KEY_SET = new Set<string>(CODEX_MANAGED_TOP_LEVEL_KEYS)

export function buildCodexOwnLoginConfig(
  existingToml: Record<string, any>,
  blob: Record<string, any>
): Record<string, any> {
  const next: Record<string, any> = {}
  for (const [key, value] of Object.entries(existingToml)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key) && key !== 'model' && key !== 'model_provider') {
      next[key] = value
    }
  }
  if (next.model_providers && typeof next.model_providers === 'object') {
    next.model_providers = omitKeysByPrefix(next.model_providers as Record<string, any>, CHERRY_PROVIDER_PREFIX)
  }
  if (blob.disableResponseStorage === true) next.disable_response_storage = true
  if (isCodexPermissionMode(blob.permissionMode)) {
    Object.assign(next, codexPermissionModeToConfig(blob.permissionMode))
  }
  if (isCodexReasoningEffort(blob.reasoningEffort)) next.model_reasoning_effort = blob.reasoningEffort
  if (blob.goalMode === true) {
    const features = asRecord(next.features)
    features.goals = true
    next.features = features
  } else {
    dropFeatureGoalsIfEmpty(next)
  }
  return next
}

export function buildGeminiOwnLoginSettings(
  settings: Record<string, any>,
  blob: Record<string, any>
): Record<string, any> {
  const next = { ...settings }
  applyManagedJsonSettings(next, blob, GEMINI_MANAGED_SETTINGS_KEYS)
  dropSecurityAuthSelectedTypeIfEmpty(next)
  if (next.model && typeof next.model === 'object') {
    delete next.model.name
    if (Object.keys(next.model as Record<string, any>).length === 0) delete next.model
  }
  return next
}

export function buildQwenOwnLoginConfig(existing: Record<string, any>, blob: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...existing }
  if (next.env && typeof next.env === 'object') {
    next.env = omitKeysByPrefix(next.env as Record<string, any>, 'CHERRY_')
  }
  if (Array.isArray(next.modelProviders?.openai)) {
    const filtered = next.modelProviders.openai.filter((model: any) => !isCherryManagedModel(model))
    next.modelProviders = { ...next.modelProviders, openai: filtered }
  }
  applyManagedJsonSettings(next, blob, QWEN_MANAGED_SETTINGS_KEYS)
  dropSecurityAuthSelectedTypeIfEmpty(next)
  delete next.model
  return next
}

export function buildKimiOwnLoginConfig(existing: Record<string, any>, blob: Record<string, any>): Record<string, any> {
  const next: Record<string, any> = { ...existing }
  for (const table of ['providers', 'models'] as const) {
    if (next[table] && typeof next[table] === 'object') {
      next[table] = omitKeysByPrefix(next[table] as Record<string, any>, CHERRY_PROVIDER_PREFIX)
    }
  }
  applyManagedTomlSettings(next, blob)
  delete next.default_model
  return next
}
