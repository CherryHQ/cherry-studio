import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addAssistantPreset,
  removeAssistantPreset,
  setAssistantPresets,
  updateAssistantPreset,
  updateAssistantPresetSettings
} from '@renderer/store/assistants'
import type { AssistantPreset, AssistantSettings } from '@renderer/types'

export function useAssistantPresets() {
  const presets = useAppSelector((state) => state.assistants.presets)
  const dispatch = useAppDispatch()

  return {
    presets,
    setAssistantPresets: (presets: AssistantPreset[]) => dispatch(setAssistantPresets(presets)),
    addAssistantPreset: (preset: AssistantPreset) => dispatch(addAssistantPreset(preset)),
    removeAssistantPreset: (id: string) => dispatch(removeAssistantPreset({ id }))
  }
}

export function useAssistantPreset(id: string) {
  // FIXME: undefined is not handled
  const preset = useAppSelector((state) => state.assistants.presets.find((a) => a.id === id) as AssistantPreset)
  const dispatch = useAppDispatch()

  return {
    preset,
    updateAssistantPreset: (preset: AssistantPreset) => dispatch(updateAssistantPreset(preset)),
    updateAssistantPresetSettings: (settings: Partial<AssistantSettings>) => {
      dispatch(updateAssistantPresetSettings({ assistantId: preset.id, settings }))
    }
  }
}
