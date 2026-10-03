import { describe, expect, it } from 'vitest'

import { bytesLookBinary } from '../binaryText'

const encode = (text: string) => new TextEncoder().encode(text)

describe('bytesLookBinary', () => {
  it('flags a byte prefix containing a NUL as binary', () => {
    expect(bytesLookBinary(new Uint8Array([0x48, 0x69, 0x00, 0x21]))).toBe(true)
  })

  it('treats NUL-free bytes as text, including UTF-8 multibyte content', () => {
    expect(bytesLookBinary(encode('hello world'))).toBe(false)
    expect(bytesLookBinary(encode('日本語のテキスト — em dash'))).toBe(false)
  })

  it('is empty-safe', () => {
    expect(bytesLookBinary(new Uint8Array(0))).toBe(false)
  })
})
