import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'

import { isTrustedSenderUrl, validateSender } from '../validateSender'

describe('isTrustedSenderUrl', () => {
  it('trusts packaged app pages loaded via file://', () => {
    expect(isTrustedSenderUrl('file:///Applications/CherryStudio.app/Contents/index.html')).toBe(true)
  })

  it('trusts a frame whose origin matches the dev server', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
  })

  it('rejects an origin that does not match the dev server', () => {
    expect(isTrustedSenderUrl('http://localhost:6666/index.html', 'http://localhost:5173')).toBe(false)
  })

  it('rejects remote https origins (MiniApp / webview SSRF vector)', () => {
    expect(isTrustedSenderUrl('https://evil.example.com/page')).toBe(false)
  })

  it('rejects empty or malformed urls', () => {
    expect(isTrustedSenderUrl('')).toBe(false)
    expect(isTrustedSenderUrl('not a url')).toBe(false)
  })
})

describe('validateSender', () => {
  // `parent` defaults to null (a top-level frame); pass a non-null frame to model a sub-frame.
  const evt = (type: string, url: string | null, parent: unknown = null): IpcMainInvokeEvent =>
    ({
      sender: { getType: () => type },
      senderFrame: url === null ? null : { url, parent }
    }) as unknown as IpcMainInvokeEvent

  it('rejects embedded <webview> guests regardless of url', () => {
    expect(validateSender(evt('webview', 'file:///app/index.html'))).toBe(false)
  })

  it('rejects a null senderFrame', () => {
    expect(validateSender(evt('window', null))).toBe(false)
  })

  it('accepts a top-level window loading a packaged file:// page', () => {
    expect(validateSender(evt('window', 'file:///app/index.html'))).toBe(true)
  })

  it('rejects a sub-frame (iframe) even when its url is an app file:// page', () => {
    const parentFrame = { url: 'file:///app/index.html' }
    expect(validateSender(evt('window', 'file:///app/embedded.html', parentFrame))).toBe(false)
  })

  it('rejects a window navigated to a remote origin', () => {
    expect(validateSender(evt('window', 'https://evil.example.com'))).toBe(false)
  })
})
