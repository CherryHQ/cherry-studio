import type {
  DefaultAssistantPreference,
  DefaultAssistantPreferenceSettings
} from '@shared/data/preference/preferenceTypes'
import { AssistantSettingsSchema } from '@shared/data/types/assistant'
import type { ZodType } from 'zod'

import { mergeOldAssistants } from '../AssistantMigrator'
import type { OldAssistant } from './AssistantMappings'

function normalizeOldAssistant(value: unknown): OldAssistant | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Partial<OldAssistant>
  return {
    ...source,
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : 'default'
  } as OldAssistant
}

function resolveLegacyDefaultAssistant(sources: Record<string, unknown>): OldAssistant | null {
  const defaultAssistant = normalizeOldAssistant(sources.defaultAssistant)
  const assistants = Array.isArray(sources.assistants)
    ? sources.assistants.map(normalizeOldAssistant).filter((item): item is OldAssistant => item !== null)
    : []
  const primary = assistants.find((assistant) => assistant.id === 'default') ?? null

  if (primary && defaultAssistant) {
    return mergeOldAssistants(primary, defaultAssistant)
  }

  return primary ?? defaultAssistant
}

function sanitizeDefaultAssistantSettings(source: OldAssistant): DefaultAssistantPreferenceSettings {
  const legacySettings: Record<string, unknown> = source.settings ? { ...source.settings } : {}
  if (source.mcpMode != null) legacySettings.mcpMode = source.mcpMode
  if (source.enableWebSearch != null) legacySettings.enableWebSearch = source.enableWebSearch

  const shape = AssistantSettingsSchema.shape as Record<string, ZodType>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(legacySettings)) {
    if (key === 'contextCount') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        out.contextCount = Math.floor(value)
      }
      continue
    }

    const fieldSchema = shape[key]
    if (!fieldSchema) continue
    const parsed = fieldSchema.safeParse(value)
    if (parsed.success) out[key] = parsed.data
  }

  return out as DefaultAssistantPreferenceSettings
}

export function transformDefaultAssistantPreference(sources: Record<string, unknown>): Record<string, unknown> {
  const source = resolveLegacyDefaultAssistant(sources)
  if (!source) return {}

  const preference: DefaultAssistantPreference = {}
  if (typeof source.name === 'string' && source.name.length > 0) {
    preference.name = source.name
  }
  if (typeof source.emoji === 'string') {
    preference.emoji = source.emoji
  }
  if (typeof source.prompt === 'string') {
    preference.prompt = source.prompt
  }

  const settings = sanitizeDefaultAssistantSettings(source)
  if (Object.keys(settings).length > 0) {
    preference.settings = settings
  }

  return Object.keys(preference).length > 0 ? { 'chat.default_assistant': preference } : {}
}
