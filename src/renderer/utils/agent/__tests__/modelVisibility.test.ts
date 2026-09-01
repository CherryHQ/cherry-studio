import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { isModelVisibleOutsideAgent } from '../modelVisibility'

const model = (providerId: string) => ({ providerId }) as Model

describe('Agent-only model visibility', () => {
  it('keeps managed Cloud models out of non-Agent selectors', () => {
    expect(isModelVisibleOutsideAgent(model(CHERRY_CLOUD_PROVIDER_ID))).toBe(false)
  })

  it('keeps ordinary models available outside Agent', () => {
    expect(isModelVisibleOutsideAgent(model('openai'))).toBe(true)
  })
})
