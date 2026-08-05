import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type AbsoluteFilePath, AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'

import { fileUrlToPath, isDangerExt, normalizeExt, toFileUrl, toSafeFileUrl } from '../url'

describe('normalizeExt', () => {
  it('normalizes dotted, cased, and boundary-padded extensions', () => {
    expect(normalizeExt('.EXE. ')).toBe('exe')
    expect(normalizeExt(' .EXE')).toBe('exe')
    expect(normalizeExt('\t..EXE')).toBe('exe')
    expect(normalizeExt('Pdf')).toBe('pdf')
    expect(normalizeExt(null)).toBeNull()
    expect(normalizeExt('...')).toBeNull()
  })

  it('returns null for normalized extensions that are not conservative bare suffixes', () => {
    expect(normalizeExt('tar.gz')).toBeNull()
    expect(normalizeExt('ex e')).toBeNull()
    expect(normalizeExt('dir/exe')).toBeNull()
    expect(normalizeExt('dir\\exe')).toBeNull()
    expect(normalizeExt('exe\0')).toBeNull()
    expect(normalizeExt('x'.repeat(256))).toBeNull()
  })
})

describe('isDangerExt', () => {
  it('returns false for null and empty string', () => {
    expect(isDangerExt(null)).toBe(false)
    expect(isDangerExt('')).toBe(false)
  })

  it('matches case-insensitively and normalizes legacy dotted extensions', () => {
    expect(isDangerExt('exe')).toBe(true)
    expect(isDangerExt('EXE')).toBe(true)
    expect(isDangerExt('Exe')).toBe(true)
    expect(isDangerExt('.exe')).toBe(true)
    expect(isDangerExt('exe.')).toBe(true)
    expect(isDangerExt('exe ')).toBe(true)
  })

  it('matches every category from the policy list', () => {
    const samples = [
      'sh',
      'exe',
      'bat',
      'cmd',
      'js',
      'py',
      'scpt',
      'msc',
      'inf',
      'application',
      'appref-ms',
      'lnk',
      'app',
      'desktop',
      'appimage',
      'run',
      'iso',
      'img',
      'vhd',
      'vhdx',
      'jar',
      'svg',
      'dmg',
      'pkg'
    ]
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
    expect(toFileUrl('/foo/bar baz.pdf' as AbsoluteFilePath)).toBe('file:///foo/bar%20baz.pdf')
    expect(toFileUrl('/foo/a#b.txt' as AbsoluteFilePath)).toBe('file:///foo/a%23b.txt')
    expect(toFileUrl('/foo/a?b.txt' as AbsoluteFilePath)).toBe('file:///foo/a%3Fb.txt')
  })

  it('preserves Windows drive letters unencoded', () => {
    expect(toFileUrl('C:\\foo\\bar baz.pdf' as AbsoluteFilePath)).toBe('file:///C:/foo/bar%20baz.pdf')
    expect(toFileUrl('D:\\folder\\file.txt' as AbsoluteFilePath)).toBe('file:///D:/folder/file.txt')
  })

  it('normalizes backslashes to forward slashes', () => {
    expect(toFileUrl('C:\\a\\b\\c.txt' as AbsoluteFilePath)).toBe('file:///C:/a/b/c.txt')
  })

  it('encodes non-ASCII characters', () => {
    expect(toFileUrl('/foo/中文.pdf' as AbsoluteFilePath)).toBe('file:///foo/%E4%B8%AD%E6%96%87.pdf')
  })

  // A UNC server belongs in the URL authority. Emitting `file:////server/...`
  // instead leaves the authority empty and demotes the server to path text,
  // which Node rejects with ERR_INVALID_FILE_URL_PATH — pinned below.
  it('puts the UNC server in the authority, not the path', () => {
    expect(toFileUrl('\\\\server\\share\\baz.pdf' as AbsoluteFilePath)).toBe('file://server/share/baz.pdf')
    expect(toFileUrl('\\\\server\\share' as AbsoluteFilePath)).toBe('file://server/share')
  })

  it('encodes UNC path segments while leaving the authority intact', () => {
    expect(toFileUrl('\\\\server\\share\\report final.pdf' as AbsoluteFilePath)).toBe(
      'file://server/share/report%20final.pdf'
    )
  })

  it('treats the forward-slash UNC spelling identically', () => {
    // `fileUrlToPath` decodes UNC to this form, so both spellings must agree.
    expect(toFileUrl('//server/share/baz.pdf' as AbsoluteFilePath)).toBe('file://server/share/baz.pdf')
  })

  it('emits a UNC URL that Node can convert back to a Windows UNC path', () => {
    const url = toFileUrl('\\\\server\\share\\baz.pdf' as AbsoluteFilePath)
    expect(fileURLToPath(url, { windows: true })).toBe('\\\\server\\share\\baz.pdf')
  })

  it('round-trips UNC through fileUrlToPath into the forward-slash form', () => {
    const url = toFileUrl('\\\\server\\share\\report final.pdf' as AbsoluteFilePath)
    const decoded = fileUrlToPath(url)
    expect(decoded).toBe('//server/share/report final.pdf')
    // The decoded form is itself a valid input that maps to the same URL.
    expect(toFileUrl(decoded as AbsoluteFilePath)).toBe(url)
  })
})

describe('fileUrlToPath', () => {
  it('decodes unix file URLs with spaces and non-ASCII characters', () => {
    expect(fileUrlToPath('file:///foo/bar%20baz.pdf')).toBe('/foo/bar baz.pdf')
    expect(fileUrlToPath(new URL('file:///foo/%E4%B8%AD%E6%96%87.pdf'))).toBe('/foo/中文.pdf')
  })

  it('decodes Windows drive file URLs without a POSIX leading slash', () => {
    expect(fileUrlToPath('file:///C:/foo/bar%20baz.pdf')).toBe('C:/foo/bar baz.pdf')
  })

  it('preserves UNC hosts as network paths', () => {
    expect(fileUrlToPath('file://server/share/report%20final.pdf')).toBe('//server/share/report final.pdf')
  })

  it('throws for a non-file: URL', () => {
    expect(() => fileUrlToPath(new URL('https://example.com/foo.pdf'))).toThrow(TypeError)
  })

  it('throws on malformed percent-encoding', () => {
    expect(() => fileUrlToPath('file:///foo/%zz.pdf' as FileUrlString)).toThrow(URIError)
  })

  // Cross-module contract, not a restatement of the decode cases above: the
  // decoded path is fed straight into `AbsoluteFilePathSchema` by `file://` drop
  // handling (`useFileDragDrop`), so the two must agree on what "absolute" means.
  // They did not: this function emits Windows drive paths with forward slashes
  // (`C:/…`, required to stay the inverse of `toFileUrl`), while the schema once
  // accepted only `C:\…`. Every drop of a `file:///C:/…` value was rejected at the
  // IPC boundary and silently degraded into pasted text. Pin the agreement here —
  // the decode assertions above all still pass under a backslash-only schema.
  it('emits paths that satisfy AbsoluteFilePathSchema on every platform form', () => {
    const urls = [
      'file:///foo/bar%20baz.pdf', // POSIX
      'file:///C:/foo/bar%20baz.pdf', // Windows drive — the regressed case
      'file://server/share/report%20final.pdf' // Windows UNC
    ] as const

    for (const url of urls) {
      expect(AbsoluteFilePathSchema.safeParse(fileUrlToPath(url)).success).toBe(true)
    }
  })
})

describe('toSafeFileUrl', () => {
  it('returns the file URL for non-dangerous extensions', () => {
    expect(toSafeFileUrl('/foo/bar.pdf' as AbsoluteFilePath, 'pdf')).toBe('file:///foo/bar.pdf')
    expect(toSafeFileUrl('/foo/img.png' as AbsoluteFilePath, 'png')).toBe('file:///foo/img.png')
  })

  it('returns the dirname URL for dangerous extensions', () => {
    expect(toSafeFileUrl('/foo/bar/payload.exe' as AbsoluteFilePath, 'exe')).toBe('file:///foo/bar')
    expect(toSafeFileUrl('/foo/bar/payload.exe' as AbsoluteFilePath, '.exe')).toBe('file:///foo/bar')
    expect(toSafeFileUrl('/foo/bar/icon.svg' as AbsoluteFilePath, 'svg')).toBe('file:///foo/bar')
  })

  it('returns the dirname for dangerous extension on Windows paths', () => {
    expect(toSafeFileUrl('C:\\foo\\bar\\payload.exe' as AbsoluteFilePath, 'exe')).toBe('file:///C:/foo/bar')
  })

  it('keeps the UNC authority for a safe extension', () => {
    expect(toSafeFileUrl('\\\\server\\share\\img.png' as AbsoluteFilePath, 'png')).toBe('file://server/share/img.png')
  })

  it('strips the filename but keeps the UNC authority for a dangerous extension', () => {
    expect(toSafeFileUrl('\\\\server\\share\\sub\\payload.exe' as AbsoluteFilePath, 'exe')).toBe(
      'file://server/share/sub'
    )
    // Share root: the danger wrap must not degrade the authority into path text.
    expect(toSafeFileUrl('\\\\server\\share\\payload.exe' as AbsoluteFilePath, 'exe')).toBe('file://server/share')
  })

  it('handles null ext as safe (returns full file URL)', () => {
    expect(toSafeFileUrl('/foo/bar' as AbsoluteFilePath, null)).toBe('file:///foo/bar')
  })

  it('handles mixed separators when computing dirname', () => {
    // Defensive: mixed forward-slash / backslash inputs sometimes appear from
    // legacy IPC paths. The dirname should still pick the right cut point.
    expect(toSafeFileUrl('/a/b\\c.exe' as AbsoluteFilePath, 'exe')).toBe('file:///a/b')
  })

  it('wraps root-level dangerous files (POSIX / Windows drive root)', () => {
    // Regression: when a dangerous file sits directly under the filesystem
    // root, the wrap must still degrade to the parent directory. Returning
    // the original path here would defeat the entire safety contract — the
    // renderer would end up with `file:///payload.exe`, which `<embed>` /
    // `<img src>` can hand to OS file associations.
    expect(toSafeFileUrl('/payload.exe' as AbsoluteFilePath, 'exe')).toBe('file:///')
    expect(toSafeFileUrl('C:\\payload.exe' as AbsoluteFilePath, 'exe')).toBe('file:///C:/')
  })
})
