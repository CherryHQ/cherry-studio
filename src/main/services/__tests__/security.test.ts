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
