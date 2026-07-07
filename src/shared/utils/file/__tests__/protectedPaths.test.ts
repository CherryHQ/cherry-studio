import { describe, expect, it } from 'vitest'

import { isProtectedSystemPath } from '../protectedPaths'

describe('isProtectedSystemPath', () => {
  it('matches the v1 POSIX system-root guard', () => {
    expect(isProtectedSystemPath('/')).toBe(true)
    expect(isProtectedSystemPath('/usr')).toBe(true)
    expect(isProtectedSystemPath('/etc')).toBe(true)
    expect(isProtectedSystemPath('/System')).toBe(true)
  })

  it('does not block POSIX subdirectories or unrelated top-level directories', () => {
    expect(isProtectedSystemPath('/usr/local')).toBe(false)
    expect(isProtectedSystemPath('/etc/cherry')).toBe(false)
    expect(isProtectedSystemPath('/System/Library')).toBe(false)
    expect(isProtectedSystemPath('/Applications')).toBe(false)
    expect(isProtectedSystemPath('/Users/me/Data')).toBe(false)
  })

  it('matches the v1 Windows drive-root guard', () => {
    expect(isProtectedSystemPath('C:\\')).toBe(true)
    expect(isProtectedSystemPath('c:\\')).toBe(true)
    expect(isProtectedSystemPath('D:/')).toBe(true)
  })

  it('does not block Windows subdirectories', () => {
    expect(isProtectedSystemPath('C:\\Windows')).toBe(false)
    expect(isProtectedSystemPath('C:\\Program Files')).toBe(false)
    expect(isProtectedSystemPath('C:\\Users\\me\\Data')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(isProtectedSystemPath('')).toBe(false)
    expect(isProtectedSystemPath('  ')).toBe(false)
  })
})
