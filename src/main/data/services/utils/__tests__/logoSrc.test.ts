import { describe, expect, it, vi } from 'vitest'

const { applicationGet } = vi.hoisted(() => ({ applicationGet: vi.fn() }))

vi.mock('@application', () => ({
  application: { get: applicationGet }
}))

import { resolveLogoSrc } from '../logoSrc'

describe('resolveLogoSrc', () => {
  it('returns undefined without touching FileManager when there is no id', () => {
    expect(resolveLogoSrc(null)).toBeUndefined()
    expect(resolveLogoSrc(undefined)).toBeUndefined()
    expect(resolveLogoSrc('')).toBeUndefined()
    expect(applicationGet).not.toHaveBeenCalled()
  })

  it('resolves a file id to a file:// URL via FileManager', () => {
    applicationGet.mockReturnValue({ getUrl: vi.fn(() => 'file:///files/abc.webp') })
    expect(resolveLogoSrc('abc')).toBe('file:///files/abc.webp')
  })
})
