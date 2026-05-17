import type { Model } from '@shared/data/types/model'

/**
 * Minimal valid Model fixture for main/ai tests.
 *
 * Defaults satisfy ModelSchema's required fields (id, providerId, name,
 * capabilities, supportsStreaming, isEnabled, isHidden). Pass overrides for
 * whatever the SUT actually reads.
 */
export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4',
    providerId: 'openai',
    name: 'GPT-4',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}
