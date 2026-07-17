import { describe, expect, it, vi } from 'vitest'

const { applicationGet } = vi.hoisted(() => ({ applicationGet: vi.fn() }))

vi.mock('@application', () => ({
  application: { get: applicationGet }
}))

import { resolveEntityImageSrc } from '../entityImageSrc'

describe('resolveEntityImageSrc', () => {
  it('returns undefined without touching FileManager when there is no id', () => {
    expect(resolveEntityImageSrc(null)).toBeUndefined()
    expect(resolveEntityImageSrc(undefined)).toBeUndefined()
    expect(resolveEntityImageSrc('')).toBeUndefined()
    expect(applicationGet).not.toHaveBeenCalled()
  })

  it('resolves a file id to a file:// URL via FileManager', () => {
    applicationGet.mockReturnValue({ getUrl: vi.fn(() => 'file:///files/abc.webp') })
    expect(resolveEntityImageSrc('abc')).toBe('file:///files/abc.webp')
  })
})
