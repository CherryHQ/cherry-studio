import { application } from '@application'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const firstLine = value.split(/\r?\n/)[0] ?? ''
  const trimmed = firstLine.trim()
  if (!trimmed) return null
  if (trimmed === 'auto') return null
  return trimmed
}

/**
 * Resolve the effective reply language for an agent without implicit UI-locale coupling.
 *
 * Two-level policy without a magic string:
 * - Global `agent.language`: `null`/missing/empty/`auto` = no constraint, non-empty single-line string = default.
 * - Per-agent `configuration.language`: `undefined` = inherit global, `null`/`auto` = explicitly no constraint,
 *   non-empty single-line string = override. Legacy persisted `'auto'` maps to `null`.
 * - Values are trimmed single-line human-readable strings (e.g. "English", "ไทย"), not app locale codes.
 *   Locale codes persisted earlier are still mapped at prompt-render time via `languageEnglishNameMap`.
 * - No `getAppLanguage()` fallback — following the UI language must be an explicit user choice.
 */
export function resolveEffectiveAgentLanguage(agent: AgentEntity): string | null {
  const perAgent = (agent.configuration as Record<string, unknown> | undefined)?.language

  if (perAgent === null) return null
  if (typeof perAgent === 'string') {
    const trimmed = perAgent.trim()
    if (trimmed === 'auto') return null
    if (trimmed !== '') {
      const n = normalizeLanguage(perAgent)
      if (n !== null) return n
      return null
    }
    // whitespace-only => inherit global
  } else if (perAgent !== undefined) {
    // unexpected type => inherit global
  }

  // Inherit global (per-agent undefined or whitespace-only)
  try {
    const globalRaw = application.get('PreferenceService').get('agent.language') as unknown
    if (globalRaw === null || globalRaw === undefined) return null
    return normalizeLanguage(globalRaw)
  } catch {
    return null
  }
}
