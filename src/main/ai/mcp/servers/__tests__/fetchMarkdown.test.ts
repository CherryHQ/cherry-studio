import { describe, expect, it, vi } from 'vitest'

const fetchRemoteText = vi.fn()

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: (...args: unknown[]) => fetchRemoteText(...args)
}))

const { Fetcher } = await import('../fetch')

const PAGE = `<html><head>
  <style>body{background:#eee;font-family:system-ui}h1{font-size:1.5em}</style>
  <script>window.analytics = {trackEverything: true}</script>
</head><body><h1>Example Domain</h1><p>Real prose.</p></body></html>`

describe('Fetcher.markdown', () => {
  it('keeps the prose and drops the stylesheet and scripts', async () => {
    fetchRemoteText.mockResolvedValue(PAGE)
    const result = await Fetcher.markdown({ url: 'https://example.com' })
    const markdown = result.content[0].text

    expect(markdown).toContain('Example Domain')
    expect(markdown).toContain('Real prose.')
    // These are what a model would otherwise be billed for on every fetched link.
    expect(markdown).not.toContain('background')
    expect(markdown).not.toContain('trackEverything')
  })
})
