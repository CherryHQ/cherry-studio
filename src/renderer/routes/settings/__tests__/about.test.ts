import { describe, expect, it, vi } from 'vitest'

// Cut the component import chain — the validateSearch contract is under test.
vi.mock('@renderer/pages/settings/AboutSettings', () => ({
  AboutSettings: () => null
}))

import { Route } from '../about'

const validate = Route.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>

describe('about settings route validateSearch', () => {
  it('keeps a supported Doctor panel and unrelated settings search', () => {
    expect(validate({ doctor: 'report', focusId: 'support' })).toEqual({ doctor: 'report', focusId: 'support' })
  })

  it('drops an unsupported Doctor panel without removing unrelated settings search', () => {
    expect(validate({ doctor: 'unknown', focusId: 'support' })).toEqual({ focusId: 'support' })
  })
})
