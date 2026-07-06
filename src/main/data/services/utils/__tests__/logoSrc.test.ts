import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationGet, loggerWarn } = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: applicationGet }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: loggerWarn }) }
}))

import { resolveLogoSrc } from '../logoSrc'

describe('resolveLogoSrc', () => {
  beforeEach(() => {
    applicationGet.mockReset()
    loggerWarn.mockReset()
  })

  it('returns undefined without touching FileManager when there is no id', () => {
    expect(resolveLogoSrc(null)).toBeUndefined()
    expect(resolveLogoSrc(undefined)).toBeUndefined()
    expect(resolveLogoSrc('')).toBeUndefined()
    expect(applicationGet).not.toHaveBeenCalled()
  })

  it('resolves a file id to a file:// URL via FileManager', () => {
    const getUrl = vi.fn(() => 'file:///files/abc.webp')
    applicationGet.mockReturnValue({ getUrl })

    expect(resolveLogoSrc('abc')).toBe('file:///files/abc.webp')
    expect(getUrl).toHaveBeenCalledWith('abc')
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('logs and degrades to undefined when getUrl throws (never silently swallows)', () => {
    applicationGet.mockReturnValue({
      getUrl: () => {
        throw new Error('not found')
      }
    })

    expect(resolveLogoSrc('gone')).toBeUndefined()
    expect(loggerWarn).toHaveBeenCalledOnce()
  })

  it('logs and degrades to undefined when FileManager is unavailable', () => {
    applicationGet.mockImplementation(() => {
      throw new Error('unknown service')
    })

    expect(resolveLogoSrc('any')).toBeUndefined()
    expect(loggerWarn).toHaveBeenCalledOnce()
  })
})
