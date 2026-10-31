export const AGENT_LANGUAGE_MAX_LENGTH = 50

export const AGENT_LANGUAGE_PRESETS: readonly string[] = [
  'English',
  '中文',
  '日本語',
  '한국어',
  'ไทย',
  'Français',
  'Deutsch',
  'Español',
  'Português',
  'Русский'
]

export type AgentLanguageValidation = { ok: true; value: string } | { ok: false; errorKey: string }

// Mirrors AgentLanguageSchema: trimmed 1-50 chars, rejects CR LF U+2028 U+2029.
const SINGLE_LINE_PATTERN = new RegExp('[\\r\\n\\u2028\\u2029]')

export function validateAgentLanguageInput(raw: unknown): AgentLanguageValidation {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: false, errorKey: 'settings.agent.language.error.empty' }
  if (value.length > AGENT_LANGUAGE_MAX_LENGTH) return { ok: false, errorKey: 'settings.agent.language.error.too_long' }
  if (SINGLE_LINE_PATTERN.test(value)) return { ok: false, errorKey: 'settings.agent.language.error.multiline' }
  return { ok: true, value }
}

export function normalizeAgentLanguageInput(raw: unknown): string | null {
  const result = validateAgentLanguageInput(raw)
  return result.ok ? result.value : null
}

export type AgentLanguageMode = 'inherit' | 'off' | 'custom'

export function resolveAgentLanguagePreview(
  mode: AgentLanguageMode,
  customDraft: string,
  globalLanguage: string | null
): string | null {
  if (mode === 'off') return null
  if (mode === 'custom') return normalizeAgentLanguageInput(customDraft) ?? globalLanguage
  return globalLanguage
}
