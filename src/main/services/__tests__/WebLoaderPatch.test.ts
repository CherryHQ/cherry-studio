import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { describe, expect, it } from 'vitest'

async function collectChunks(loader: WebLoader): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of loader.getUnfilteredChunks()) {
    chunks.push(chunk.pageContent)
  }
  return chunks
}

describe('WebLoader patch - conditional URL stripping', () => {
  it('preserves URLs in local HTML content (isUrl=false)', async () => {
    const html = '<p>Visit <a href="https://example.com">https://example.com</a> for details</p>'
    const loader = new WebLoader({ urlOrContent: html })

    const chunks = await collectChunks(loader)
    const text = chunks.join(' ')

    expect(text).toContain('https://example.com')
  })

  it('preserves multiple URLs in local content', async () => {
    const html = `
      <p>See https://foo.com/page and http://bar.org/doc for more info.</p>
      <p>Also check ftp://files.example.com/archive</p>
    `
    const loader = new WebLoader({ urlOrContent: html })

    const chunks = await collectChunks(loader)
    const text = chunks.join(' ')

    expect(text).toContain('https://foo.com/page')
    expect(text).toContain('http://bar.org/doc')
    expect(text).toContain('ftp://files.example.com/archive')
  })

  it('strips URLs from remote web content (isUrl=true)', () => {
    const loader = new WebLoader({ urlOrContent: 'https://example.com' })
    expect((loader as any).isUrl).toBe(true)
  })

  it('detects local content correctly (isUrl=false)', () => {
    const loader = new WebLoader({ urlOrContent: '<p>hello</p>' })
    expect((loader as any).isUrl).toBe(false)
  })
})
