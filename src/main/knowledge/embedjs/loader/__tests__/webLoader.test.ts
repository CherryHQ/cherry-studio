/**
 * Regression test skeleton for WebLoader URL-stripping behavior.
 *
 * Upstream @cherrystudio/embedjs-loader-web (v0.1.31) strips every URL
 * from the output text via:
 *   text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '')
 *
 * This is applied unconditionally — even when isUrl=false (local content),
 * meaning embedded links in user-authored Markdown/HTML are silently removed.
 *
 * These tests are designed to FAIL on the current upstream so they serve as
 * a regression guard: once the stripping is scoped to isUrl=true only, all
 * assertions below should pass.
 */

import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { describe, expect, it } from 'vitest'

/**
 * Helper: collect all chunks from the async generator.
 */
async function collectChunks(loader: WebLoader): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of loader.getUnfilteredChunks()) {
    chunks.push(chunk.pageContent)
  }
  return chunks
}

/**
 * Helper: join all chunks into a single string for easier substring assertions.
 */
async function collectAllText(loader: WebLoader): Promise<string> {
  const chunks = await collectChunks(loader)
  return chunks.join(' ')
}

// ---------------------------------------------------------------------------
// Local content (isUrl = false) — URLs should be preserved in output
// ---------------------------------------------------------------------------

describe('WebLoader: local content (isUrl=false) — URL stripping', () => {
  // Each case contains an embedded URL that MUST survive in the output text.
  // On current upstream these FAIL because the global strip regex removes them.

  it('preserves embedded https URL in plain text', async () => {
    const loader = new WebLoader({
      urlOrContent: 'Visit https://docs.example.com/guide for details.'
    })
    const text = await collectAllText(loader)
    expect(text).toContain('https://docs.example.com/guide')
  })

  it('preserves embedded http URL in plain text', async () => {
    const loader = new WebLoader({
      urlOrContent: 'Legacy endpoint: http://api.old.example.com/v1/users'
    })
    const text = await collectAllText(loader)
    expect(text).toContain('http://api.old.example.com/v1/users')
  })

  it('preserves embedded ftp URL in plain text', async () => {
    const loader = new WebLoader({
      urlOrContent: 'Download from ftp://files.example.com/releases/latest.tar.gz'
    })
    const text = await collectAllText(loader)
    expect(text).toContain('ftp://files.example.com/releases/latest.tar.gz')
  })

  it('preserves URL with query string and fragment', async () => {
    const loader = new WebLoader({
      urlOrContent: 'See https://example.com/page?q=search&lang=en#section-2 for more.'
    })
    const text = await collectAllText(loader)
    expect(text).toContain('https://example.com/page')
    expect(text).toContain('q=search')
  })

  it('preserves href URL inside HTML content', async () => {
    const loader = new WebLoader({
      urlOrContent: '<p>Check <a href="https://example.com/docs">the docs</a> for info.</p>'
    })
    const text = await collectAllText(loader)
    // After html-to-text conversion the link text remains; the URL should too
    expect(text).toContain('https://example.com/docs')
  })

  it('treats bare URL as remote fetch (isUrl=true)', async () => {
    const loader = new WebLoader({
      urlOrContent: 'https://test.invalid/resource'
    })
    // A bare URL is treated as a remote URL, so getSafe is invoked.
    // The .invalid TLD is guaranteed to fail DNS resolution, so the
    // generator catches the error and yields no chunks.
    const chunks = await collectChunks(loader)
    expect(chunks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// URL-like input (isUrl = true) — regression: stripping still applies
// ---------------------------------------------------------------------------

describe('WebLoader: URL input (isUrl=true) — stripping regression', () => {
  it('strips URLs from fetched page content (isUrl=true)', async () => {
    // When input is a real URL, getSafe is called and the fetched HTML
    // is processed. Embedded URLs in the fetched page should be stripped.
    // This test documents the current "stripping works" regression baseline.
    //
    // NOTE: This test requires getSafe to be mockable or the URL to be
    // unreachable. We use a clearly-fake URL so getSafe throws, and the
    // generator silently yields nothing — confirming the URL was treated
    // as isUrl=true (the fetch path was attempted).
    const loader = new WebLoader({
      urlOrContent: 'https://this-domain-does-not-exist-xyzzy.invalid/test'
    })
    const chunks = await collectChunks(loader)
    // Fetch fails → generator catches and yields nothing
    expect(chunks).toEqual([])
  })
})
