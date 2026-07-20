import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'

import { isTrustedSenderUrl, validateSender } from '../validateSender'

// A representative packaged app root (asar bundle); the renderer entry lives under it.
const APP_ROOT = '/Applications/CherryStudio.app/Contents/Resources/app.asar'

describe('isTrustedSenderUrl', () => {
  it('trusts a packaged app page whose file path is inside the app root', () => {
    expect(isTrustedSenderUrl(`file://${APP_ROOT}/out/renderer/index.html`, null, APP_ROOT)).toBe(true)
  })

  it('rejects a file:// page outside the app root (downloaded/exported HTML)', () => {
    expect(isTrustedSenderUrl('file:///Users/victim/Downloads/evil.html', null, APP_ROOT)).toBe(false)
  })

  it('rejects a file:// path that merely shares a prefix with the app root', () => {
    expect(isTrustedSenderUrl(`file://${APP_ROOT}-evil/index.html`, null, APP_ROOT)).toBe(false)
  })

  it('rejects file:// urls with percent-encoded path separators (encoded-traversal attempt)', () => {
    // `%2f` is an encoded slash: fileURLToPath throws ERR_INVALID_FILE_URL_PATH → caught → false.
    expect(isTrustedSenderUrl(`file://${APP_ROOT}/..%2f..%2fevil.html`, null, APP_ROOT)).toBe(false)
    // `%2e%2e` are encoded dots with real slashes: decode to `../../` and normalize outside the root.
    expect(isTrustedSenderUrl(`file://${APP_ROOT}/%2e%2e/%2e%2e/evil.html`, null, APP_ROOT)).toBe(false)
  })

  it('trusts a frame whose origin matches the dev server', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', 'http://localhost:5173', APP_ROOT)).toBe(true)
  })

  it('rejects an origin that does not match the dev server', () => {
    expect(isTrustedSenderUrl('http://localhost:6666/index.html', 'http://localhost:5173', APP_ROOT)).toBe(false)
  })

  it('rejects remote https origins (MiniApp / webview SSRF vector)', () => {
    expect(isTrustedSenderUrl('https://evil.example.com/page', null, APP_ROOT)).toBe(false)
  })

  it('rejects empty or malformed urls', () => {
    expect(isTrustedSenderUrl('', null, APP_ROOT)).toBe(false)
    expect(isTrustedSenderUrl('not a url', null, APP_ROOT)).toBe(false)
  })
})

describe('validateSender', () => {
  const APP_ROOT = '/app'
  // `parent` defaults to null (a top-level frame); pass a non-null frame to model a sub-frame.
  const evt = (type: string, url: string | null, parent: unknown = null): IpcMainInvokeEvent =>
    ({
      sender: { getType: () => type },
      senderFrame: url === null ? null : { url, parent }
    }) as unknown as IpcMainInvokeEvent

  it('rejects embedded <webview> guests regardless of url', () => {
    expect(validateSender(evt('webview', 'file:///app/index.html'), APP_ROOT)).toBe(false)
  })

  it('rejects a null senderFrame', () => {
    expect(validateSender(evt('window', null), APP_ROOT)).toBe(false)
  })

  it('accepts a top-level window loading a packaged file:// page inside the app root', () => {
    expect(validateSender(evt('window', 'file:///app/index.html'), APP_ROOT)).toBe(true)
  })

  it('rejects a sub-frame (iframe) even when its url is an app file:// page', () => {
    const parentFrame = { url: 'file:///app/index.html' }
    expect(validateSender(evt('window', 'file:///app/embedded.html', parentFrame), APP_ROOT)).toBe(false)
  })

  it('rejects a window navigated to a remote origin', () => {
    expect(validateSender(evt('window', 'https://evil.example.com'), APP_ROOT)).toBe(false)
  })

  it('rejects a top-level window loading a file:// page outside the app root', () => {
    expect(validateSender(evt('window', 'file:///tmp/evil.html'), APP_ROOT)).toBe(false)
  })
})
