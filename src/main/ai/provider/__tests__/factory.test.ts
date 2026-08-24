import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { getAiSdkProviderId } from '../factory'

describe('getAiSdkProviderId — resolves from the model active endpoint (#B3)', () => {
  const provider = makeProvider({
    id: 'silicon',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://api.siliconflow.cn/v1',
        adapterFamily: 'openai-compatible'
      },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
        baseUrl: 'https://api.siliconflow.cn',
        adapterFamily: 'anthropic'
      }
    }
  })

  it('uses the model active endpoint adapterFamily, not the provider default', () => {
    const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })
    expect(getAiSdkProviderId(provider, model)).toBe('anthropic')
  })

  it('falls back to the provider default endpoint when the model declares none', () => {
    const model = makeModel({ endpointTypes: undefined })
    expect(getAiSdkProviderId(provider, model)).toBe('openai-compatible')
  })
})
