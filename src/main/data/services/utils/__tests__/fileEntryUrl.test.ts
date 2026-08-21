import { describe, expect, it, vi } from 'vitest'

const { applicationGet } = vi.hoisted(() => ({ applicationGet: vi.fn() }))

vi.mock('@application', () => ({
  application: { get: applicationGet }
}))

import { resolveFileEntryUrl } from '../fileEntryUrl'

describe('resolveFileEntryUrl', () => {
  it('returns undefined without touching FileManager when there is no id', () => {
    expect(resolveFileEntryUrl(null)).toBeUndefined()
    expect(resolveFileEntryUrl(undefined)).toBeUndefined()
    expect(resolveFileEntryUrl('')).toBeUndefined()
    expect(applicationGet).not.toHaveBeenCalled()
  })

  it('resolves a file id to a file:// URL via FileManager', () => {
    applicationGet.mockReturnValue({ getUrl: vi.fn(() => 'file:///files/abc.webp') })
    expect(resolveFileEntryUrl('abc')).toBe('file:///files/abc.webp')
  })
})
