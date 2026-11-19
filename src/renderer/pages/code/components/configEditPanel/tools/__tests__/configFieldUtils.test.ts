import { describe, expect, it, vi } from 'vitest'

import { makeUpdateSectionField } from '../configFieldUtils'

describe('CLI configuration section updates', () => {
  it('replaces a malformed array section without writing numeric keys into the configuration', () => {
    const onChange = vi.fn()
    const config = { general: ['stale'], unrelated: { enabled: true } }
    makeUpdateSectionField(config, onChange)('general', 'theme', 'dark')
    expect(onChange).toHaveBeenCalledWith({ general: { theme: 'dark' }, unrelated: { enabled: true } })
    expect(config.general).toEqual(['stale'])
  })
})
