import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { describe, expect, it } from 'vitest'

describe('WebLoader URL preservation (patch)', () => {
  it('preserves HTTP URLs in HTML content', async () => {
    const html = '<p>Visit <a href="https://example.com/docs">docs</a> for details.</p>'
    const loader = new WebLoader({ urlOrContent: html, chunkSize: 2000, chunkOverlap: 0 })

    const chunks: string[] = []
    for await (const chunk of loader.getUnfilteredChunks()) {
      chunks.push(chunk.pageContent)
    }

    const text = chunks.join(' ')
    expect(text).toContain('https://example.com/docs')
  })

  it('preserves bare URLs in plain HTML', async () => {
    const html = '<p>See https://example.com/guide and ftp://files.example.com/data.zip</p>'
    const loader = new WebLoader({ urlOrContent: html, chunkSize: 2000, chunkOverlap: 0 })

    const chunks: string[] = []
    for await (const chunk of loader.getUnfilteredChunks()) {
      chunks.push(chunk.pageContent)
    }

    const text = chunks.join(' ')
    expect(text).toContain('https://example.com/guide')
    expect(text).toContain('ftp://files.example.com/data.zip')
  })
})
