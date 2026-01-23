import type { FeatureCapability } from '@renderer/config/fileProcessing'
import type { FileProcessorMerged } from '@renderer/hooks/useFileProcessors'
import { getEffectiveApiHost } from '@renderer/hooks/useFileProcessors'
import type { FeatureUserConfig, FileProcessorOverride } from '@shared/data/presets/fileProcessing'
import { useCallback, useEffect, useState } from 'react'

interface UseApiProcessorSettingsProps {
  processor: FileProcessorMerged | undefined
  capability: FeatureCapability | undefined
  updateConfig: (update: FileProcessorOverride) => void
}

interface UseApiProcessorSettingsReturn {
  // State
  apiKeyInput: string
  apiHostInput: string
  showApiKey: boolean
  // Setters
  setApiKeyInput: (value: string) => void
  setApiHostInput: (value: string) => void
  toggleShowApiKey: () => void
  // Actions
  handleFieldBlur: (field: 'apiKey' | 'apiHost', localValue: string) => void
  // Computed
  hasDefaultApiHost: boolean
}

export function useApiProcessorSettings({
  processor,
  capability,
  updateConfig
}: UseApiProcessorSettingsProps): UseApiProcessorSettingsReturn {
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiHostInput, setApiHostInput] = useState('')

  const hasDefaultApiHost = Boolean(capability && Object.prototype.hasOwnProperty.call(capability, 'defaultApiHost'))
  const effectiveApiHost = processor && capability ? (getEffectiveApiHost(processor, capability) ?? '') : ''

  // Sync state with processor changes
  useEffect(() => {
    if (!processor) {
      setApiKeyInput('')
      setApiHostInput('')
      return
    }

    setApiKeyInput(processor.apiKey || '')
    setApiHostInput(effectiveApiHost)
  }, [processor, effectiveApiHost])

  const toggleShowApiKey = useCallback(() => {
    setShowApiKey((prev) => !prev)
  }, [])

  const handleFieldBlur = useCallback(
    (field: 'apiKey' | 'apiHost', localValue: string) => {
      if (!processor) return

      if (field === 'apiKey') {
        const savedApiKey = processor.apiKey ?? ''
        if (localValue !== savedApiKey) {
          updateConfig({ apiKey: localValue })
        }
        return
      }

      if (!capability) return

      let trimmedHost = localValue.trim()
      if (trimmedHost.endsWith('/')) {
        trimmedHost = trimmedHost.slice(0, -1)
      }

      const savedHost = effectiveApiHost ?? ''
      if (trimmedHost === savedHost) {
        setApiHostInput(trimmedHost)
        return
      }

      const featureConfigs: FeatureUserConfig[] = processor.featureConfigs ? [...processor.featureConfigs] : []
      const existingIndex = featureConfigs.findIndex((config) => config.feature === capability.feature)

      if (existingIndex >= 0) {
        featureConfigs[existingIndex] = {
          ...featureConfigs[existingIndex],
          apiHost: trimmedHost
        }
      } else {
        featureConfigs.push({ feature: capability.feature, apiHost: trimmedHost })
      }

      updateConfig({ featureConfigs })
      setApiHostInput(trimmedHost)
    },
    [capability, effectiveApiHost, processor, updateConfig]
  )

  return {
    apiKeyInput,
    apiHostInput,
    showApiKey,
    setApiKeyInput,
    setApiHostInput,
    toggleShowApiKey,
    handleFieldBlur,
    hasDefaultApiHost
  }
}
