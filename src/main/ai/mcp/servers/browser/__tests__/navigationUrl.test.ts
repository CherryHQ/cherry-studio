import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BROWSER_FILE_ACCESS_DISABLED_MESSAGE,
  isBrowserFileInput,
  resolveBrowserNavigationTarget,
  resolveBrowserNavigationUrl
} from '../navigationUrl'

let dir = ''
let linkName = ''

function setupFixtures(): void {
  dir = mkdtempSync(path.join(tmpdir(), 'browser-nav-'))
  writeFileSync(path.join(dir, 'hello.html'), '<html><body>hi</body></html>')
  mkdirSync(path.join(dir, 'sub'))
  try {
    symlinkSync(path.join(dir, 'hello.html'), path.join(dir, 'link.html'), 'file')
    linkName = 'link.html'
  } catch {
    // Symlink creation needs privileges on some Windows setups — tests that
    // need the link skip themselves when it could not be created.
    linkName = ''
  }
}

function teardownFixtures(): void {
  if (dir) rmSync(dir, { recursive: true, force: true })
}

function fileUrlOf(name: string): string {
  return pathToFileURL(path.join(dir, name)).href
}

describe('resolveBrowserNavigationTarget http branch', () => {
  it('passes https URLs through unchanged', () => {
    expect(resolveBrowserNavigationTarget('https://example.com/x')).toEqual({
      kind: 'http',
      url: 'https://example.com/x'
    })
  })

  it('still rejects private hosts, malformed urls and credentials', () => {
    expect(() => resolveBrowserNavigationTarget('http://localhost:3000/file')).toThrowError(/local or private/)
    expect(() => resolveBrowserNavigationTarget('not-a-url')).toThrowError(/Invalid (remote|browser) url/)
    expect(() => resolveBrowserNavigationTarget('https://user:pass@example.com/file')).toThrowError(/credentials/)
  })

  it('rejects non-http(s)/file schemes', () => {
    for (const raw of ['ftp://example.com/file', 'gopher://example.com/file', 'javascript:alert(1)']) {
      expect(() => resolveBrowserNavigationTarget(raw)).toThrowError(`Invalid browser url: ${raw}`)
    }
  })
})

describe('resolveBrowserNavigationTarget file branch', () => {
  beforeAll(setupFixtures)
  afterAll(teardownFixtures)

  it('denies file URLs and bare paths by default', () => {
    const fileUrl = fileUrlOf('hello.html')
    expect(() => resolveBrowserNavigationTarget(fileUrl)).toThrowError(BROWSER_FILE_ACCESS_DISABLED_MESSAGE)
    expect(() => resolveBrowserNavigationTarget(path.join(dir, 'hello.html'))).toThrowError(
      BROWSER_FILE_ACCESS_DISABLED_MESSAGE
    )
  })

  it('opens an existing file:// URL when allowed', () => {
    const fileUrl = fileUrlOf('hello.html')
    const target = resolveBrowserNavigationTarget(fileUrl, { allowFile: true })
    expect(target.kind).toBe('file')
    // tmpdir() itself may be symlinked (macOS /var): the URL is built from
    // the validated canonical path, and the fragment is preserved.
    const canonical = realpathSync(path.join(dir, 'hello.html'))
    if (target.kind === 'file') {
      expect(target.filePath).toBe(canonical)
      expect(target.url).toBe(pathToFileURL(canonical).href)
    }
    expect(resolveBrowserNavigationUrl(fileUrl, { allowFile: true })).toBe(pathToFileURL(canonical).href)
  })

  it('preserves the fragment and drops the query of file:// URLs', () => {
    const target = resolveBrowserNavigationTarget(`${fileUrlOf('hello.html')}?x=1#section`, { allowFile: true })
    expect(target.kind).toBe('file')
    if (target.kind === 'file') {
      expect(target.url.endsWith('#section')).toBe(true)
      expect(target.url).not.toContain('?x=1')
    }
  })

  it('opens a bare absolute path when allowed and strips quotes', () => {
    const bare = path.join(dir, 'hello.html')
    const target = resolveBrowserNavigationTarget(`"${bare}"`, { allowFile: true })
    expect(target.kind).toBe('file')
    // tmpdir() itself may be symlinked (macOS /var), so compare canonical forms.
    expect(target.url).toBe(pathToFileURL(realpathSync(bare)).href)
  })

  it('resolves symlinks to their canonical target', () => {
    if (!linkName) return
    const canonical = realpathSync(path.join(dir, 'hello.html'))
    const target = resolveBrowserNavigationTarget(path.join(dir, linkName), { allowFile: true })
    expect(target.kind).toBe('file')
    if (target.kind === 'file') {
      expect(target.filePath).toBe(canonical)
      expect(target.url).toBe(pathToFileURL(canonical).href)
    }
  })

  it('rejects missing files, directories and relative paths', () => {
    expect(() => resolveBrowserNavigationTarget(fileUrlOf('missing.html'), { allowFile: true })).toThrowError(
      /Local file not found/
    )
    expect(() => resolveBrowserNavigationTarget(path.join(dir, 'sub'), { allowFile: true })).toThrowError(/directory/)
    expect(() => resolveBrowserNavigationTarget('relative/report.html', { allowFile: true })).toThrowError(
      /must be absolute/
    )
  })

  it('treats a localhost authority as local, other hosts as remote shares', () => {
    const canonical = realpathSync(path.join(dir, 'hello.html'))
    const localTarget = resolveBrowserNavigationTarget(
      `file://localhost${fileUrlOf('hello.html').slice('file://'.length)}`,
      {
        allowFile: true
      }
    )
    expect(localTarget.kind).toBe('file')
    if (localTarget.kind === 'file') {
      expect(localTarget.filePath).toBe(canonical)
    }
    expect(() => resolveBrowserNavigationTarget('file://remotehost/share/x.html', { allowFile: true })).toThrowError(
      /Remote file shares/
    )
  })

  it('rejects remote shares, UNC paths and file credentials', () => {
    expect(() => resolveBrowserNavigationTarget('file://server/share/x.html', { allowFile: true })).toThrowError(
      /Remote file shares/
    )
    expect(() => resolveBrowserNavigationTarget('\\\\server\\share\\x.html', { allowFile: true })).toThrowError(
      /Remote file shares/
    )
    expect(() => resolveBrowserNavigationTarget('//server/share/x.html', { allowFile: true })).toThrowError(
      /Remote file shares/
    )
    expect(() => resolveBrowserNavigationTarget('\\\\?\\UNC\\server\\share\\x.html', { allowFile: true })).toThrowError(
      /Remote file shares/
    )
    expect(() => resolveBrowserNavigationTarget('//server/share/x.html')).toThrowError(
      BROWSER_FILE_ACCESS_DISABLED_MESSAGE
    )
    expect(() => resolveBrowserNavigationTarget('file://user:pass@/tmp/x.html', { allowFile: true })).toThrowError(
      /credentials|Invalid browser url/
    )
  })
})

describe('isBrowserFileInput', () => {
  it('detects file URLs, absolute paths and home paths', () => {
    expect(isBrowserFileInput('file:///D:/a.html')).toBe(true)
    expect(isBrowserFileInput('D:\\report\\out.html')).toBe(true)
    expect(isBrowserFileInput('/tmp/out.html')).toBe(true)
    expect(isBrowserFileInput('~/report.html')).toBe(true)
    expect(isBrowserFileInput('https://example.com/x')).toBe(false)
    expect(isBrowserFileInput('example.com')).toBe(false)
  })
})
