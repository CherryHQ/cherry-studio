import { application } from '@application'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { AGENT_LANGUAGE_MAX_LENGTH } from '@shared/data/api/schemas/agents'

/**
 * Trimmed, length-bounded language label, or null when empty or over
 * AGENT_LANGUAGE_MAX_LENGTH. The same bound is enforced on writes by the
 * per-agent zod schema.
 */
export function normalizeAgentLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > AGENT_LANGUAGE_MAX_LENGTH) return null
  return trimmed
}

function resolveGlobalAgentLanguage(): string | null {
  try {
    return normalizeAgentLanguage(application.get('PreferenceService').get('agent.language'))
  } catch {
    return null
  }
}

/**
 * Resolve the effective reply language for an agent without implicit UI-locale coupling.
 *
 * - Global `agent.language`: `null`/missing/empty = no constraint; non-empty string = default.
 * - Per-agent `configuration.language`: `undefined` = inherit global, `null` = explicitly no
 *   constraint, non-empty string = override (whitespace-only inherits).
 * - Values are human-readable language labels (e.g. "English", "ไทย"), not app locale codes.
 */
export function resolveEffectiveAgentLanguage(agent: AgentEntity): string | null {
  const perAgent = (agent.configuration as Record<string, unknown> | undefined)?.language

  if (perAgent === null) return null
  if (typeof perAgent === 'string' && perAgent.trim() !== '') {
    return normalizeAgentLanguage(perAgent)
  }
  // Per-agent undefined / whitespace-only / unexpected type => inherit global
  return resolveGlobalAgentLanguage()
}
