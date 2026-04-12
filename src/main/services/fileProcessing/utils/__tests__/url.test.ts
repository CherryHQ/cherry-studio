import { describe, expect, it } from 'vitest'

import { sanitizeFileProcessingRemoteUrl } from '../url'

describe('sanitizeFileProcessingRemoteUrl', () => {
  it('accepts public http and https urls', () => {
    expect(sanitizeFileProcessingRemoteUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
    expect(sanitizeFileProcessingRemoteUrl('http://example.com/path')).toBe('http://example.com/path')
  })

  it('rejects unsupported protocols', () => {
    expect(() => sanitizeFileProcessingRemoteUrl('file:///etc/passwd')).toThrowError(
      'Invalid remote url: file:///etc/passwd'
    )
  })

  it('rejects localhost and private ip targets', () => {
    expect(() => sanitizeFileProcessingRemoteUrl('http://localhost:3000/file')).toThrowError(
      'Unsafe remote url: local or private addresses are not allowed (localhost)'
    )
    expect(() => sanitizeFileProcessingRemoteUrl('http://127.0.0.1/file')).toThrowError(
      'Unsafe remote url: local or private addresses are not allowed (127.0.0.1)'
    )
    expect(() => sanitizeFileProcessingRemoteUrl('http://192.168.1.10/file')).toThrowError(
      'Unsafe remote url: local or private addresses are not allowed (192.168.1.10)'
    )
  })

  it('rejects credential-bearing urls', () => {
    expect(() => sanitizeFileProcessingRemoteUrl('https://user:pass@example.com/file')).toThrowError(
      'Unsafe remote url: credentials are not allowed'
    )
  })
})
