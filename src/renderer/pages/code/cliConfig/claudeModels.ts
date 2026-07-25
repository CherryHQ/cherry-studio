import type { UniqueModelId } from '@shared/data/types/model'

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

function getEnv(config: Record<string, unknown>): Record<string, unknown> {
  return config.env && typeof config.env === 'object' && !Array.isArray(config.env)
    ? (config.env as Record<string, unknown>)
    : {}
}

export function stripClaudeOneMMarker(value: string): string {
  const trimmed = value.trimEnd()
  if (trimmed.toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trimEnd()
  }
  return value
}

export function hasClaudeDetailedModels(config: Record<string, unknown>): boolean {
  const env = getEnv(config)
  return CLAUDE_DETAILED_MODEL_ROLES.some((role) => stripClaudeOneMMarker(stringValue(env[role.model]) ?? '').trim())
}

export function stripClaudeDetailedModels(config: Record<string, unknown>): Record<string, unknown> {
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
  config: Record<string, unknown>
): UniqueModelId | undefined {
  const env = getEnv(config)
  for (const role of CLAUDE_DETAILED_MODEL_ROLES) {
    const modelId = stripClaudeOneMMarker(stringValue(env[role.model]) ?? '').trim()
    // env values are user-typed; a value createUniqueModelId rejects yields no context model.
    if (modelId) return safeCreateUniqueModelId(providerId, modelId)
  }
  return undefined
}
