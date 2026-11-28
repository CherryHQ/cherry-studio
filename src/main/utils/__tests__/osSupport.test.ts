import { describe, expect, it } from 'vitest'

import {
  MIN_SUPPORTED_WINDOWS_BUILD,
  isLegacyWindowsRelease,
  isSupportedWindowsRelease,
  parseWindowsRelease
} from '../osSupport'

describe('osSupport', () => {
  it('exposes the Windows 10 1809 floor', () => {
    expect(MIN_SUPPORTED_WINDOWS_BUILD).toBe(17763)
  })

  describe('parseWindowsRelease', () => {
    it('parses Win10/11 kernel versions', () => {
      expect(parseWindowsRelease('10.0.17763')).toEqual({ major: 10, minor: 0, build: 17763 })
      expect(parseWindowsRelease('10.0.22000')).toEqual({ major: 10, minor: 0, build: 22000 })
    })

    it('parses legacy NT 6.x versions', () => {
      expect(parseWindowsRelease('6.1.7601')).toEqual({ major: 6, minor: 1, build: 7601 })
      expect(parseWindowsRelease('6.3.9600')).toEqual({ major: 6, minor: 3, build: 9600 })
    })

    it('returns null parts for garbage', () => {
      expect(parseWindowsRelease('')).toEqual({ major: null, minor: null, build: null })
      expect(parseWindowsRelease('not-a-version')).toEqual({ major: null, minor: null, build: null })
    })
  })

  describe('isSupportedWindowsRelease', () => {
    it.each(['6.1.7601', '6.2.9200', '6.3.9600', '10.0.10240', '10.0.17134'])(
      'rejects unsupported Windows release %s',
      (release) => {
        expect(isSupportedWindowsRelease(release, 'win32')).toBe(false)
      }
    )

    it.each(['10.0.17763', '10.0.19044', '10.0.22000', '10.0.26100'])(
      'accepts supported Windows release %s',
      (release) => {
        expect(isSupportedWindowsRelease(release, 'win32')).toBe(true)
      }
    )

    it('lets non-Windows platforms through', () => {
      expect(isSupportedWindowsRelease('6.1.7601', 'darwin')).toBe(true)
      expect(isSupportedWindowsRelease('6.1.7601', 'linux')).toBe(true)
    })

    it('fails open on unparseable versions', () => {
      expect(isSupportedWindowsRelease('', 'win32')).toBe(true)
      expect(isSupportedWindowsRelease('unknown', 'win32')).toBe(true)
    })
  })

  describe('isLegacyWindowsRelease', () => {
    it('flags NT 6.x as legacy', () => {
      expect(isLegacyWindowsRelease('6.1.7601')).toBe(true)
      expect(isLegacyWindowsRelease('6.3.9600')).toBe(true)
    })

    it('does not flag Win10/11 or garbage', () => {
      expect(isLegacyWindowsRelease('10.0.17763')).toBe(false)
      expect(isLegacyWindowsRelease('')).toBe(false)
    })
  })
})
