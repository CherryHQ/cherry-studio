import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import type { RequestScope } from '../../scope'
import { arkEncryptedReasoningFeature, createArkEncryptedReasoningMiddleware } from '../arkEncryptedReasoning'

const scope = (providerId: string, apiModelId: string, aiSdkProviderId = 'open-responses') =>
  ({
    aiSdkProviderId,
    provider: { id: providerId, presetProviderId: providerId } as Provider,
    model: { id: apiModelId, apiModelId } as Model
  }) as unknown as RequestScope

describe('arkEncryptedReasoningFeature.applies', () => {
  it('activates only for Ark seed-2.x on the open-responses family', () => {
    expect(arkEncryptedReasoningFeature.applies!(scope('doubao', 'doubao-seed-2-1-pro-260628'))).toBe(true)
    expect(arkEncryptedReasoningFeature.applies!(scope('doubao', 'doubao-seed-evolving'))).toBe(true)
    expect(arkEncryptedReasoningFeature.applies!(scope('doubao', 'doubao-seed-1.6-250615'))).toBe(false)
    expect(arkEncryptedReasoningFeature.applies!(scope('deepseek', 'deepseek-v4-flash'))).toBe(false)
    expect(arkEncryptedReasoningFeature.applies!(scope('doubao', 'doubao-seed-2-1-pro-260628', 'openai'))).toBe(false)
  })
})

describe('middleware', () => {
  it('requests encrypted reasoning without clobbering existing openai options', async () => {
    const middleware = createArkEncryptedReasoningMiddleware()
    const result = await middleware.transformParams!({
      type: 'stream',
      params: { prompt: [], providerOptions: { openai: { reasoningEffort: 'high' } } } as never,
      model: {} as never
    })
    expect(result.providerOptions).toEqual({
      openai: { reasoningEffort: 'high', include: ['reasoning.encrypted_content'] }
    })
  })
})
