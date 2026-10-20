import type { UniqueModelId } from '@shared/data/types/model'

import type { LocalVoiceModelDescriptor } from './localVoice'

/** Speech selections use the same provider-scoped identity as the model catalog. */
export type SpeechModelId = UniqueModelId

export type VoiceModelDescriptor = Omit<LocalVoiceModelDescriptor, 'id' | 'providerId'> & {
  readonly id: UniqueModelId
  readonly providerId: string
}
