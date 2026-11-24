import { useEffect } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { isVoiceRecognitionOff } from '@renderer/utils/voiceRecognitionPreference'

export function useDictationEnabled(): boolean {
  const [modelId] = usePreference('feature.voice.recognition.model_id')
  useEffect(() => {
    void preferenceService.ensureFreshSubscription('feature.voice.recognition.model_id').catch(() => undefined)
  }, [])
  return !isVoiceRecognitionOff(modelId)
}
