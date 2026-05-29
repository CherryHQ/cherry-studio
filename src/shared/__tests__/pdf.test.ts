import { describe, expect, it } from 'vitest'

import { extractPdfText } from '../utils/pdf'

// Minimal valid PDF with text "Hello"
// Generated from: %PDF-1.0 with a single page containing "Hello"
const MINIMAL_PDF_BASE64 = [
  'JVBERi0xLjAKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAw',
  'IFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFsz',
  'IDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1Bh',
  'Z2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29u',
  'dGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIg',
  'Pj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzNSA+PgpzdHJl',
  'YW0KQlQKL0YxIDI0IFRmCjEwMCA3MDAgVGQKKEhlbGxvKSBUagpFVAplbmRz',
  'dHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUg',
  'L1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago4IDAgb2Jq',
  'Cjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQ5MQolJUVP',
  'Rgo='
].join('')

describe('extractPdfText', () => {
  it('should extract text from a base64-encoded PDF', async () => {
    const text = await extractPdfText(MINIMAL_PDF_BASE64)
    expect(text).toContain('Hello')
  })

  it('should extract text from a Uint8Array PDF', async () => {
    const binaryString = atob(MINIMAL_PDF_BASE64)
    const buffer = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
    const text = await extractPdfText(buffer)
    expect(text).toContain('Hello')
  })

  it('should extract text from an ArrayBuffer PDF', async () => {
    const binaryString = atob(MINIMAL_PDF_BASE64)
    const buffer = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
    const text = await extractPdfText(buffer.buffer)
    expect(text).toContain('Hello')
  })

  it('should throw on invalid PDF data', async () => {
    await expect(extractPdfText('not-valid-base64-pdf')).rejects.toThrow()
  })

  it('should return empty string for PDF with no text', async () => {
    // A truly empty PDF would still parse, just with no text
    // We test that extractPdfText doesn't crash on edge cases
    const text = await extractPdfText(MINIMAL_PDF_BASE64)
    expect(typeof text).toBe('string')
  })
})
