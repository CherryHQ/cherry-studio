import type { TomlTable } from 'smol-toml'

import type { Serializable } from '@shared/types/serializable'

import type { CodexConfigOptions } from './builders'
import { CHERRY_PROVIDER_PREFIX } from './constants'
import {
  applyManagedJsonSettings,
  applyManagedTomlSettings,
  CODEX_MANAGED_TOP_LEVEL_KEYS,
  GEMINI_MANAGED_SETTINGS_KEYS,
  QWEN_MANAGED_SETTINGS_KEYS
} from './managedKeys'
import { codexPermissionModeToConfig, isCodexPermissionMode, isCodexReasoningEffort } from './permissionModes'
import type { CliConfigWriteArgs } from './types'
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

export function buildCodexOwnLoginConfig(existingToml: TomlTable, blob: CodexConfigOptions): TomlTable {
  const next: TomlTable = {}

  for (const [key, value] of Object.entries(existingToml)) {
    if (!CODEX_MANAGED_TOP_LEVEL_KEY_SET.has(key) && key !== 'model' && key !== 'model_provider') {
      next[key] = value
    }
  }

  if (next.model_providers && typeof next.model_providers === 'object') {
    // SAFETY: Only enumerable fields from the parsed TOML container are copied; no provider schema is assumed.
    next.model_providers = omitKeysByPrefix(next.model_providers as TomlTable, CHERRY_PROVIDER_PREFIX)
  }

  if (blob.disableResponseStorage === true) next.disable_response_storage = true

  if (isCodexPermissionMode(blob.permissionMode)) {
    Object.assign(next, codexPermissionModeToConfig(blob.permissionMode))
  }

  if (isCodexReasoningEffort(blob.reasoningEffort)) next.model_reasoning_effort = blob.reasoningEffort

  if (blob.goalMode === true) {
    // SAFETY: Existing feature fields are parsed TOML values; the container helper retains their native values.
    const features = asRecord(next.features) as TomlTable
    features.goals = true
    next.features = features
  } else {
    dropFeatureGoalsIfEmpty(next)
  }

  return next
}

export function buildGeminiOwnLoginSettings(
  settings: Record<string, Serializable>,
  blob: NonNullable<CliConfigWriteArgs['configBlob']>
) {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- Managed settings may add raw edited fields; preserve their value domain until JSON rendering.
  const next: Record<string, unknown> = { ...settings }
  applyManagedJsonSettings(next, blob, GEMINI_MANAGED_SETTINGS_KEYS)
  dropSecurityAuthSelectedTypeIfEmpty(next)

  if (next.model && typeof next.model === 'object') {
    const model = asRecord(next.model)
    delete model.name

    if (Object.keys(model).length === 0) delete next.model
  }

  return next
}

export function buildQwenOwnLoginConfig(
  existing: Record<string, Serializable>,
  blob: NonNullable<CliConfigWriteArgs['configBlob']>
) {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- Own-login settings accept raw edited fields; JSON rendering owns their final representation.
  const next: Record<string, unknown> = { ...existing }

  if (next.env && typeof next.env === 'object') {
    next.env = omitKeysByPrefix(asRecord(next.env), 'CHERRY_')
  }

  const modelProviders = asRecord(next.modelProviders)

  if (Array.isArray(modelProviders.openai)) {
    const filtered = modelProviders.openai.filter((model) => !isCherryManagedModel(model))
    next.modelProviders = { ...modelProviders, openai: filtered }
  }

  applyManagedJsonSettings(next, blob, QWEN_MANAGED_SETTINGS_KEYS)
  dropSecurityAuthSelectedTypeIfEmpty(next)
  delete next.model

  return next
}

export function buildKimiOwnLoginConfig(existing: TomlTable, blob: NonNullable<CliConfigWriteArgs['configBlob']>) {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening -- Native TOML fields and raw edited tool parameters remain unvalidated until TOML rendering.
  const next: Record<string, unknown> = { ...existing }

  for (const table of ['providers', 'models'] as const) {
    if (next[table] && typeof next[table] === 'object') {
      next[table] = omitKeysByPrefix(asRecord(next[table]), CHERRY_PROVIDER_PREFIX)
    }
  }

  applyManagedTomlSettings(next, blob)
  delete next.default_model

  return next
}
