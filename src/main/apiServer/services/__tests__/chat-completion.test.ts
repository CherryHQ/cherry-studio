import { describe, it, expect } from 'vitest'
import { ensureApiHostHasVersion } from '../chat-completion'

describe('ensureApiHostHasVersion', () => {
  it('appends /v1 when apiHost has no version segment', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com')).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('does not append when apiHost already has /v1', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com/v1')).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('does not append when apiHost has /v2', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com/v2')).toBe('https://integrate.api.nvidia.com/v2')
  })

  it('removes trailing slash and then appends /v1 if missing', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com/')).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('ignores fragment-only element when deciding path version', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com/#test')).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('preserves strings with explicit legacy version marker', () => {
    expect(ensureApiHostHasVersion('https://integrate.api.nvidia.com/v1alpha')).toBe('https://integrate.api.nvidia.com/v1alpha')
  })

  it('returns non-string values unchanged (type safety)', () => {
    expect(ensureApiHostHasVersion('')).toBe('')
  })
})
