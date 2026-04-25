import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistantPreset,
  removeAssistantPreset,
  setAssistantPresets,
  updateAssistantPreset,
  updateAssistantPresetSettings
} from '@renderer/store/assistants'
import type { AssistantPreset, AssistantSettings, LegacyAssistant } from '@renderer/types'

const logger = loggerService.withContext('useAssistantPresets')

// Presets still live in the Redux v1 slice (migration-era data, slated for
// removal alongside `store/assistants.ts`). The slice typings carry
// LegacyAssistant — at this boundary we cast back to the v2-shaped
// `AssistantPreset` exposed publicly. When the slice goes, this hook goes.
function ensurePresetsArray(storedPresets: unknown): AssistantPreset[] {
  if (Array.isArray(storedPresets)) {
    return storedPresets as unknown as AssistantPreset[]
  }
  logger.warn('Unexpected data type from state.assistants.presets, falling back to empty list.', {
    type: typeof storedPresets,
    value: storedPresets
  })
  return []
}

export function useAssistantPresets() {
  const storedPresets = useAppSelector((state) => state.assistants.presets)
  const presets = ensurePresetsArray(storedPresets)
  const dispatch = useAppDispatch()

  return {
    presets,
    setAssistantPresets: (next: AssistantPreset[]) =>
      dispatch(setAssistantPresets(next as unknown as LegacyAssistant[])),
    addAssistantPreset: (preset: AssistantPreset) => dispatch(addAssistantPreset(preset as unknown as LegacyAssistant)),
    removeAssistantPreset: (id: string) => dispatch(removeAssistantPreset({ id }))
  }
}

export function useAssistantPreset(id: string) {
  const storedPresets = useAppSelector((state) => state.assistants.presets)
  const presets = ensurePresetsArray(storedPresets)
  const preset = presets.find((a) => a.id === id)
  const dispatch = useAppDispatch()

  if (!preset) {
    logger.warn(`Assistant preset with id ${id} not found in state.`)
  }

  return {
    preset: preset,
    updateAssistantPreset: (next: AssistantPreset) =>
      dispatch(updateAssistantPreset(next as unknown as LegacyAssistant)),
    updateAssistantPresetSettings: (settings: Partial<AssistantSettings>) => {
      if (!preset) {
        logger.warn(`Failed to update assistant preset settings because preset with id ${id} is missing.`)
        return
      }
      dispatch(updateAssistantPresetSettings({ assistantId: preset.id, settings }))
    }
  }
}
