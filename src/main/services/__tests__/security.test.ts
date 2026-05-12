import { describe, expect, it } from 'vitest'

import { isSafeExternalUrl } from '../security'

describe('isSafeExternalUrl', () => {
  it('allows http URLs', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/path?q=1')).toBe(true)
  })

  it('allows https URLs', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('https://example.com:8080/path')).toBe(true)
  })

  it('allows mailto URLs', () => {
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(true)
  })

  it('allows obsidian:// protocol', () => {
    expect(isSafeExternalUrl('obsidian://new?file=test&vault=myvault&clipboard')).toBe(true)
  })

  it('allows code-editor file-open deep-links on Unix paths', () => {
    expect(isSafeExternalUrl('vscode://file/C%3A/Users/foo/bar.ts?windowId=_blank')).toBe(true)
    expect(isSafeExternalUrl('vscode-insiders://file/C%3A/Users/foo/bar.ts')).toBe(true)
    expect(isSafeExternalUrl('cursor://file/C%3A/Users/foo/bar.ts?windowId=_blank')).toBe(true)
    expect(isSafeExternalUrl('zed://file/Users/foo/bar.ts')).toBe(true)
  })

  it('allows Zed file-open deep-links for Windows absolute paths', () => {
    // buildEditorUrl() for Zed emits `zed://file<path>` without a slash, so a
    // Windows path like C:\Users\foo\bar.ts produces zed://fileC%3A/...
    expect(isSafeExternalUrl('zed://fileC%3A/Users/foo/bar.ts')).toBe(true)
    expect(isSafeExternalUrl('zed://filed%3a/data/foo.ts')).toBe(true)
  })

  it('rejects editor deep-links with non-file authorities', () => {
    // command authority runs registered VS Code commands
    expect(isSafeExternalUrl('vscode://command/workbench.action.terminal.sendSequence?text=rm')).toBe(false)
    // extension URL handlers
    expect(isSafeExternalUrl('vscode://ms-python.python/do-something')).toBe(false)
    expect(isSafeExternalUrl('cursor://settings')).toBe(false)
    expect(isSafeExternalUrl('zed://extension/evil')).toBe(false)
    // missing authority entirely
    expect(isSafeExternalUrl('vscode:command/foo')).toBe(false)
  })

  it('rejects Zed deep-links that do not match the file-open shape', () => {
    // host starts with "file" but is not file or file<drive>
    expect(isSafeExternalUrl('zed://filename/path')).toBe(false)
    expect(isSafeExternalUrl('zed://files.evil.com/cmd')).toBe(false)
    // userinfo smuggling: "file" in userinfo, real host is attacker-controlled
    expect(isSafeExternalUrl('zed://file@evil.com/path')).toBe(false)
    expect(isSafeExternalUrl('vscode://file:pw@evil.com/path')).toBe(false)
  })

  it('rejects file:// protocol', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('file://localhost/tmp')).toBe(false)
  })

  it('rejects dangerous custom protocols', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('ms-msdt:something')).toBe(false)
    expect(isSafeExternalUrl('calculator:')).toBe(false)
    expect(isSafeExternalUrl('vbscript:MsgBox')).toBe(false)
  })

  it('rejects empty or malformed input', () => {
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('not-a-url')).toBe(false)
    expect(isSafeExternalUrl('://missing-scheme')).toBe(false)
  })

  it('handles mixed-case protocols via URL parser', () => {
    expect(isSafeExternalUrl('HTTP://example.com')).toBe(true)
    expect(isSafeExternalUrl('HTTPS://example.com')).toBe(true)
    expect(isSafeExternalUrl('FILE:///etc/passwd')).toBe(false)
  })
})
