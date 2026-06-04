import { describe, expect, it } from 'vitest'

import { CHERRYIN_PROVIDER_ID, resolveFreeTrialLinkedProviderId } from '../freeTrialModel'

describe('resolveFreeTrialLinkedProviderId', () => {
  it('resolves CherryAI trial models from raw ids', () => {
    expect(
      resolveFreeTrialLinkedProviderId({
        providerId: 'cherryai',
        modelId: 'Qwen/Qwen3-8B'
      })
    ).toBe(CHERRYIN_PROVIDER_ID)
  })

  it('resolves CherryAI trial models from unique ids', () => {
    expect(
      resolveFreeTrialLinkedProviderId({
        providerId: 'cherryai',
        modelId: 'cherryai::Qwen/Qwen3-Next-80B-A3B-Instruct'
      })
    ).toBe(CHERRYIN_PROVIDER_ID)
  })

  it('prefers api model id and ignores non-CherryAI providers', () => {
    expect(
      resolveFreeTrialLinkedProviderId({
        providerId: 'cherryai',
        modelId: 'cherryai::display-id',
        apiModelId: 'Qwen/Qwen3-8B'
      })
    ).toBe(CHERRYIN_PROVIDER_ID)

    expect(
      resolveFreeTrialLinkedProviderId({
        providerId: 'openai',
        modelId: 'Qwen/Qwen3-8B'
      })
    ).toBeUndefined()
  })
})
