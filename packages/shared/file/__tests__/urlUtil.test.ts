import { describe, expect, it } from 'vitest'

import type { FilePath } from '../types/common'
import { isDangerExt, toFileUrl, toSafeFileUrl } from '../urlUtil'

describe('isDangerExt', () => {
  it('returns false for null and empty string', () => {
    expect(isDangerExt(null)).toBe(false)
    expect(isDangerExt('')).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(isDangerExt('exe')).toBe(true)
    expect(isDangerExt('EXE')).toBe(true)
    expect(isDangerExt('Exe')).toBe(true)
  })

  it('matches every category from the policy list', () => {
    const samples = ['sh', 'exe', 'bat', 'cmd', 'lnk', 'app', 'desktop', 'jar', 'svg', 'dmg', 'pkg']
    for (const ext of samples) {
      expect(isDangerExt(ext)).toBe(true)
    }
  })

  it('returns false for plain document extensions', () => {
    for (const ext of ['pdf', 'txt', 'md', 'png', 'jpg', 'mp4']) {
      expect(isDangerExt(ext)).toBe(false)
    }
  })
})

describe('toFileUrl', () => {
  it('encodes unix paths with spaces and special chars', () => {
    expect(toFileUrl('/foo/bar baz.pdf' as FilePath)).toBe('file:///foo/bar%20baz.pdf')
    expect(toFileUrl('/foo/a#b.txt' as FilePath)).toBe('file:///foo/a%23b.txt')
    expect(toFileUrl('/foo/a?b.txt' as FilePath)).toBe('file:///foo/a%3Fb.txt')
  })

  it('preserves Windows drive letters unencoded', () => {
    expect(toFileUrl('C:\\foo\\bar baz.pdf' as FilePath)).toBe('file:///C:/foo/bar%20baz.pdf')
    expect(toFileUrl('D:\\folder\\file.txt' as FilePath)).toBe('file:///D:/folder/file.txt')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(toFileUrl('C:\\a\\b\\c.txt' as FilePath)).toBe('file:///C:/a/b/c.txt')
  })

  it('encodes non-ASCII characters', () => {
    expect(toFileUrl('/foo/中文.pdf' as FilePath)).toBe('file:///foo/%E4%B8%AD%E6%96%87.pdf')
  })
})

describe('toSafeFileUrl', () => {
  it('returns the file URL for non-dangerous extensions', () => {
    expect(toSafeFileUrl('/foo/bar.pdf' as FilePath, 'pdf')).toBe('file:///foo/bar.pdf')
    expect(toSafeFileUrl('/foo/img.png' as FilePath, 'png')).toBe('file:///foo/img.png')
  })

  it('returns the dirname URL for dangerous extensions', () => {
    expect(toSafeFileUrl('/foo/bar/payload.exe' as FilePath, 'exe')).toBe('file:///foo/bar')
    expect(toSafeFileUrl('/foo/bar/icon.svg' as FilePath, 'svg')).toBe('file:///foo/bar')
  })

  it('returns the dirname for dangerous extension on Windows paths', () => {
    expect(toSafeFileUrl('C:\\foo\\bar\\payload.exe' as FilePath, 'exe')).toBe('file:///C:/foo/bar')
  })

  it('handles null ext as safe (returns full file URL)', () => {
    expect(toSafeFileUrl('/foo/bar' as FilePath, null)).toBe('file:///foo/bar')
  })

  it('handles mixed separators when computing dirname', () => {
    // Defensive: mixed forward-slash / backslash inputs sometimes appear from
    // legacy IPC paths. The dirname should still pick the right cut point.
    expect(toSafeFileUrl('/a/b\\c.exe' as FilePath, 'exe')).toBe('file:///a/b')
  })
})
