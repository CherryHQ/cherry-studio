import type { Model, UniqueModelId } from '@shared/data/types/model'

import { gatewayModelIdFromAddress } from './gatewayModel'
import type { CliConfigWriteArgs } from './types'
import { safeCreateUniqueModelId, stringValue } from './values'

export const CLAUDE_DETAILED_MODEL_ROLES = [
  {
    roleKey: 'fable',
    model: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    name: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME'
  },
  {
    roleKey: 'opus',
    model: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME'
  },
  {
    roleKey: 'sonnet',
    model: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME'
  },
  {
    roleKey: 'haiku',
    model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME'
  }
] as const

export const CLAUDE_MODEL_ROLES = [
  ...CLAUDE_DETAILED_MODEL_ROLES,
  {
    roleKey: 'subagent',
    model: 'CLAUDE_CODE_SUBAGENT_MODEL'
  }
] as const

export const CLAUDE_DETAILED_MODEL_ENV_KEYS = CLAUDE_DETAILED_MODEL_ROLES.flatMap((role) => [role.model, role.name])

const ONE_M_MARKER = '[1M]'

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This env container comes from edited tool parameters; stringValue checks each model field before use.
function getEnv(config: NonNullable<CliConfigWriteArgs['configBlob']>): Record<string, unknown> {
  if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: Only the non-array container is checked; foreign env values remain unvalidated.
    return config.env as Record<string, unknown>
  }
  return {}
}

export function stripClaudeOneMMarker(value: string): string {
  const trimmed = value.trimEnd()
  if (trimmed.toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trimEnd()
  }
  return value
}

/**
 * Apply or remove the 1M context marker on a role model id. The marker is appended without a
 * separating space (`model[1M]`, Claude Code's documented form): Claude Code strips only the
 * bracket token, so a spaced marker leaves a trailing space in the model id it sends.
 */
export function setClaudeOneMMarker(value: string, enabled: boolean): string {
  const base = stripClaudeOneMMarker(value).trim()
  return enabled && base ? `${base}${ONE_M_MARKER}` : base
}

export function hasClaudeDetailedModels(config: NonNullable<CliConfigWriteArgs['configBlob']>): boolean {
  const env = getEnv(config)
  return CLAUDE_DETAILED_MODEL_ROLES.some((role) => stripClaudeOneMMarker(stringValue(env[role.model]) ?? '').trim())
}

export function stripClaudeDetailedModels(
  config: NonNullable<CliConfigWriteArgs['configBlob']>
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const env = getEnv(config)
  if (!Object.keys(env).length) return config

  const nextEnv = { ...env }
  for (const key of CLAUDE_DETAILED_MODEL_ENV_KEYS) {
    delete nextEnv[key]
  }

  const nextConfig = { ...config }
  if (Object.keys(nextEnv).length) nextConfig.env = nextEnv
  else delete nextConfig.env
  return nextConfig
}

export function getClaudeContextModelId(
  providerId: string,
  config: NonNullable<CliConfigWriteArgs['configBlob']>,
  gatewayModels?: Map<UniqueModelId, Model>
): UniqueModelId | undefined {
  const env = getEnv(config)
  for (const role of CLAUDE_DETAILED_MODEL_ROLES) {
    const modelId = stripClaudeOneMMarker(stringValue(env[role.model]) ?? '').trim()
    // Env values are user-typed; invalid direct ids and unknown gateway addresses yield no context model.
    if (modelId) {
      return gatewayModels
        ? gatewayModelIdFromAddress(modelId, gatewayModels)
        : safeCreateUniqueModelId(providerId, modelId)
    }
  }
  return undefined
}
