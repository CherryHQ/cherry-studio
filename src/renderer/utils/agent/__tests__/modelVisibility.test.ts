import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isModelVisibleOutsideAgent, isProviderVisibleOutsideAgent } from '../modelVisibility'

const model = (providerId: string) => ({ providerId }) as Model
const provider = (id: string, authMethods?: Provider['authMethods']) => ({ id, authMethods }) as Provider

describe('Agent-only model visibility', () => {
  it('keeps managed Cloud and external-CLI providers out of non-Agent selectors', () => {
    const cloudProvider = provider(CHERRY_CLOUD_PROVIDER_ID)
    const cliProvider = provider('claude-code', ['external-cli'])

    expect(isProviderVisibleOutsideAgent(cloudProvider)).toBe(false)
    expect(isModelVisibleOutsideAgent(model(CHERRY_CLOUD_PROVIDER_ID), cloudProvider)).toBe(false)
    expect(isProviderVisibleOutsideAgent(cliProvider)).toBe(false)
    expect(isModelVisibleOutsideAgent(model(cliProvider.id), cliProvider)).toBe(false)
  })

  it('keeps ordinary providers available outside Agent', () => {
    const openai = provider('openai', ['api-key'])

    expect(isProviderVisibleOutsideAgent(openai)).toBe(true)
    expect(isModelVisibleOutsideAgent(model(openai.id), openai)).toBe(true)
  })
})
