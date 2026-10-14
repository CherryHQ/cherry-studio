import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/platform', () => ({ isDev: true }))

import { devtoolsFeature } from '../devtools'

const originalDevtoolsSetting = process.env.AI_SDK_DEVTOOLS

afterEach(() => {
  if (originalDevtoolsSetting === undefined) {
    delete process.env.AI_SDK_DEVTOOLS
  } else {
    process.env.AI_SDK_DEVTOOLS = originalDevtoolsSetting
  }
})

describe('devtoolsFeature', () => {
  it('is disabled by default in development', () => {
    delete process.env.AI_SDK_DEVTOOLS

    expect(devtoolsFeature.applies?.({} as never)).toBe(false)
  })

  it('requires an explicit opt-in', () => {
    process.env.AI_SDK_DEVTOOLS = '1'
    expect(devtoolsFeature.applies?.({} as never)).toBe(true)

    process.env.AI_SDK_DEVTOOLS = 'true'
    expect(devtoolsFeature.applies?.({} as never)).toBe(false)
  })
})
