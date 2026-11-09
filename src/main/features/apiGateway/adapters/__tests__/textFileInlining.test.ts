import { describe, expect, it } from 'vitest'

import { inlineTextFileContent } from '../converters/textFileInlining'

describe('inlineTextFileContent encodings', () => {
  it.each(['text/plain', 'text/markdown'])('preserves short valid UTF-8 in %s', (type) => {
    expect(inlineTextFileContent(type, `data:${type};base64,dGhlIGVuZCDDqQ==`)).toBe('the end é')
  })
  it('honors explicit UTF-8 over statistical detection', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain;charset=utf-8;base64,dGhlIGVuZCDDqQ==')).toBe(
      'the end é'
    )
  })
  it('honors an explicit legacy charset even when bytes are valid UTF-8', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain;charset="iso-8859-1";base64,w6k=')).toBe('Ã©')
  })
  it('decodes non-UTF-8 percent escapes with the declared charset', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain;CHARSET=windows-1252,the%20end%20%E9')).toBe(
      'the end é'
    )
  })
  it('preserves literal plus signs and UTF-8 percent escapes', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain,the+end%20%C3%A9')).toBe('the+end é')
  })
  it('keeps the file part for unsupported declared encodings', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain;charset=not-an-encoding;base64,YQ==')).toBeUndefined()
  })
  it('retains legacy autodetection when bytes are not valid UTF-8', () => {
    expect(inlineTextFileContent('text/plain', 'data:text/plain;base64,dGhlIGVuZCDp')).toBe('the end é')
  })
  it.each(['%', '%A', '%GG'])('rejects malformed percent escape %s', (suffix) => {
    expect(() => inlineTextFileContent('text/plain', `data:text/plain,${suffix}`)).toThrow(URIError)
  })
})
