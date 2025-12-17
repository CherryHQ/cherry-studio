import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistantPreset,
  removeAssistantPreset,
  setAssistantPresets,
  updateAssistantPreset,
  updateAssistantPresetSettings
} from '@renderer/store/assistants'
import type { AssistantPreset, AssistantSettings } from '@renderer/types'

const logger = loggerService.withContext('useAssistantPresets')

function ensurePresetsArray(storedPresets: unknown): AssistantPreset[] {
  if (Array.isArray(storedPresets)) {
    return storedPresets
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
    setAssistantPresets: (presets: AssistantPreset[]) => dispatch(setAssistantPresets(presets)),
    addAssistantPreset: (preset: AssistantPreset) => dispatch(addAssistantPreset(preset)),
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
    updateAssistantPreset: (preset: AssistantPreset) => dispatch(updateAssistantPreset(preset)),
    updateAssistantPresetSettings: (settings: Partial<AssistantSettings>) => {
      if (!preset) {
        logger.warn(`Failed to update assistant preset settings because preset with id ${id} is missing.`)
        return
      }
      dispatch(updateAssistantPresetSettings({ assistantId: preset.id, settings }))
    }
  }
}
