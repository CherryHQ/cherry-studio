import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'

import { isAppRendererUrl, validateSender } from '../validateSender'

// A representative packaged app root (asar bundle); the renderer entry lives under it.
// Resolved because `fileURLToPath` rejects a driveless file: url on Windows.
const APP_ROOT = resolve('/Applications/CherryStudio.app/Contents/Resources/app.asar')
const appFileUrl = (...segments: string[]) => pathToFileURL(join(APP_ROOT, ...segments)).href

describe('isAppRendererUrl', () => {
  it('trusts a packaged app page whose file path is inside the app root', () => {
    expect(isAppRendererUrl(appFileUrl('out', 'renderer', 'index.html'), null, APP_ROOT)).toBe(true)
  })

  it('trusts a packaged app page when the launch path reaches the app through a directory link', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'cherry-sender-link-'))
    const realProgramsDir = join(fixtureRoot, 'real-programs')
    const linkedProgramsDir = join(fixtureRoot, 'linked-programs')
    const appRootFromLaunchPath = join(linkedProgramsDir, 'Cherry Studio', 'resources', 'app.asar')
    const realAppRoot = join(realProgramsDir, 'Cherry Studio', 'resources', 'app.asar')

    try {
      mkdirSync(dirname(realAppRoot), { recursive: true })
      writeFileSync(realAppRoot, '')
      symlinkSync(realProgramsDir, linkedProgramsDir, process.platform === 'win32' ? 'junction' : 'dir')

      const rendererPath = join(realpathSync.native(realAppRoot), 'out', 'renderer', 'windows', 'main', 'index.html')

      expect(isAppRendererUrl(pathToFileURL(rendererPath).href, null, appRootFromLaunchPath)).toBe(true)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('trusts a packaged app page when the renderer path reaches the app through a directory link', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'cherry-sender-renderer-link-'))
    const realProgramsDir = join(fixtureRoot, 'real-programs')
    const linkedProgramsDir = join(fixtureRoot, 'linked-programs')
    const realAppRoot = join(realProgramsDir, 'Cherry Studio', 'resources', 'app.asar')
    const appRootFromRendererPath = join(linkedProgramsDir, 'Cherry Studio', 'resources', 'app.asar')

    try {
      mkdirSync(dirname(realAppRoot), { recursive: true })
      writeFileSync(realAppRoot, '')
      symlinkSync(realProgramsDir, linkedProgramsDir, process.platform === 'win32' ? 'junction' : 'dir')

      const rendererPath = join(appRootFromRendererPath, 'out', 'renderer', 'windows', 'main', 'index.html')

      expect(isAppRendererUrl(pathToFileURL(rendererPath).href, null, realpathSync.native(realAppRoot))).toBe(true)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('rejects a file:// page outside the app root (downloaded/exported HTML)', () => {
    expect(isAppRendererUrl(pathToFileURL(resolve('/Users/victim/Downloads/evil.html')).href, null, APP_ROOT)).toBe(
      false
    )
  })

  it('rejects a file:// path that merely shares a prefix with the app root', () => {
    expect(isAppRendererUrl(pathToFileURL(join(`${APP_ROOT}-evil`, 'index.html')).href, null, APP_ROOT)).toBe(false)
  })

  it('rejects file:// urls with percent-encoded path separators (encoded-traversal attempt)', () => {
    const appRootUrl = pathToFileURL(APP_ROOT).href
    // `%2f` is an encoded slash: fileURLToPath throws ERR_INVALID_FILE_URL_PATH → caught → false.
    expect(isAppRendererUrl(`${appRootUrl}/..%2f..%2fevil.html`, null, APP_ROOT)).toBe(false)
    // `%2e%2e` are encoded dots with real slashes: decode to `../../` and normalize outside the root.
    expect(isAppRendererUrl(`${appRootUrl}/%2e%2e/%2e%2e/evil.html`, null, APP_ROOT)).toBe(false)
  })

  it('trusts a frame whose origin matches the dev server', () => {
    expect(isAppRendererUrl('http://localhost:5173/index.html', 'http://localhost:5173', APP_ROOT)).toBe(true)
  })

  it('rejects an origin that does not match the dev server', () => {
    expect(isAppRendererUrl('http://localhost:6666/index.html', 'http://localhost:5173', APP_ROOT)).toBe(false)
    expect(isAppRendererUrl('https://localhost:5173/index.html', 'http://localhost:5173', APP_ROOT)).toBe(false)
    expect(isAppRendererUrl('http://127.0.0.1:5173/index.html', 'http://localhost:5173', APP_ROOT)).toBe(false)
  })

  it('rejects a remote url that merely carries the dev-server address as text', () => {
    // Regression guard: a substring check would have let this navigate in-window.
    expect(
      isAppRendererUrl('https://evil.example.com/?next=http://localhost:5173', 'http://localhost:5173', APP_ROOT)
    ).toBe(false)
  })

  it('rejects a malformed dev server url', () => {
    expect(isAppRendererUrl('http://localhost:5173/index.html', 'not a url', APP_ROOT)).toBe(false)
  })

  it('rejects remote https origins (MiniApp / webview SSRF vector)', () => {
    expect(isAppRendererUrl('https://evil.example.com/page', null, APP_ROOT)).toBe(false)
  })

  it('rejects empty or malformed urls', () => {
    expect(isAppRendererUrl('', null, APP_ROOT)).toBe(false)
    expect(isAppRendererUrl('not a url', null, APP_ROOT)).toBe(false)
  })
})

describe('validateSender', () => {
  const APP_ROOT = resolve('/app')
  const indexUrl = pathToFileURL(join(APP_ROOT, 'index.html')).href
  // `parent` defaults to null (a top-level frame); pass a non-null frame to model a sub-frame.
  const evt = (type: string, url: string | null, parent: unknown = null): IpcMainInvokeEvent =>
    ({
      sender: { getType: () => type },
      senderFrame: url === null ? null : { url, parent }
    }) as unknown as IpcMainInvokeEvent

  it('rejects embedded <webview> guests regardless of url', () => {
    expect(validateSender(evt('webview', indexUrl), APP_ROOT)).toBe(false)
  })

  it('rejects a null senderFrame', () => {
    expect(validateSender(evt('window', null), APP_ROOT)).toBe(false)
  })

  it('accepts a top-level window loading a packaged file:// page inside the app root', () => {
    expect(validateSender(evt('window', indexUrl), APP_ROOT)).toBe(true)
  })

  it('rejects a sub-frame (iframe) even when its url is an app file:// page', () => {
    const parentFrame = { url: indexUrl }
    const embeddedUrl = pathToFileURL(join(APP_ROOT, 'embedded.html')).href
    expect(validateSender(evt('window', embeddedUrl, parentFrame), APP_ROOT)).toBe(false)
  })

  it('rejects a window navigated to a remote origin', () => {
    expect(validateSender(evt('window', 'https://evil.example.com'), APP_ROOT)).toBe(false)
  })

  it('rejects a top-level window loading a file:// page outside the app root', () => {
    expect(validateSender(evt('window', pathToFileURL(resolve('/tmp/evil.html')).href), APP_ROOT)).toBe(false)
  })
})
