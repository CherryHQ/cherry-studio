import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { LocalBaiduProvider } from '../LocalBaiduProvider'
import { LocalBingProvider } from '../LocalBingProvider'
import { LocalGoogleProvider } from '../LocalGoogleProvider'

const baseProvider: Omit<ResolvedWebSearchProvider, 'id' | 'name'> = {
  type: 'local',
  usingBrowser: true,
  apiKey: '',
  apiHost: '',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

describe('local web search SERP parsers', () => {
  it('parses Google SERP title, url, and snippet', () => {
    const provider = new LocalGoogleProvider({
      ...baseProvider,
      id: 'local-google',
      name: 'Google'
    })

    const html = `
      <div id="search">
        <div class="MjjYud">
          <a href="/url?q=https://example.com/article&sa=U"><h3>Example Title</h3></a>
          <div class="VwiC3b">Example snippet from Google.</div>
        </div>
      </div>
    `

    const results = (provider as any).parseValidUrls(html)
    expect(results).toEqual([
      {
        title: 'Example Title',
        url: 'https://example.com/article',
        content: 'Example snippet from Google.'
      }
    ])
  })

  it('parses Bing SERP title, url, and snippet', () => {
    const provider = new LocalBingProvider({
      ...baseProvider,
      id: 'local-bing',
      name: 'Bing'
    })

    const encodedUrl = `a1${Buffer.from('https://example.com/bing').toString('base64')}`
    const html = `
      <div id="b_results">
        <div class="b_algo">
          <h2><a href="https://www.bing.com/ck/a?u=${encodedUrl}">Bing Title</a></h2>
          <div class="b_caption"><p>Bing snippet text.</p></div>
        </div>
      </div>
    `

    const results = (provider as any).parseValidUrls(html)
    expect(results).toEqual([
      {
        title: 'Bing Title',
        url: 'https://example.com/bing',
        content: 'Bing snippet text.'
      }
    ])
  })

  it('parses Baidu SERP title, url, and snippet', () => {
    const provider = new LocalBaiduProvider({
      ...baseProvider,
      id: 'local-baidu',
      name: 'Baidu'
    })

    const html = `
      <div id="content_left">
        <div class="result">
          <h3><a href="https://example.com/baidu">Baidu Title</a></h3>
          <div class="c-abstract">Baidu snippet text.</div>
        </div>
      </div>
    `

    const results = (provider as any).parseValidUrls(html)
    expect(results).toEqual([
      {
        title: 'Baidu Title',
        url: 'https://example.com/baidu',
        content: 'Baidu snippet text.'
      }
    ])
  })
})
