import { expect, it } from 'vitest'

import { webSearchCatalog } from '../catalog'
import { bocha } from '../providers/bocha'
import { crawl4ai } from '../providers/crawl4ai'
import { exa } from '../providers/exa'
import { exaMcp } from '../providers/exaMcp'
import { firecrawl } from '../providers/firecrawl'
import { jina } from '../providers/jina'
import { parallel } from '../providers/parallel'
import { querit } from '../providers/querit'
import { searxng } from '../providers/searxng'
import { serply } from '../providers/serply'
import { tavily } from '../providers/tavily'
import { zhipu } from '../providers/zhipu'

it('exposes exactly the remote capability and authentication contract', () => {
  expect(
    webSearchCatalog.map((provider) => [
      provider.id,
      provider.name,
      provider.type,
      provider.capabilities.map((item) => [
        item.capability,
        item.requiresApiHost,
        item.requiresApiKey,
        item.defaultApiHost
      ])
    ])
  ).toEqual([
    ['zhipu', 'Zhipu', 'api', [['searchKeywords', true, true, 'https://open.bigmodel.cn/api/paas/v4/web_search']]],
    ['tavily', 'Tavily', 'api', [['searchKeywords', true, true, 'https://api.tavily.com']]],
    ['searxng', 'Searxng', 'api', [['searchKeywords', true, false, undefined]]],
    ['exa', 'Exa', 'api', [['searchKeywords', true, true, 'https://api.exa.ai']]],
    ['exa-mcp', 'ExaMCP', 'mcp', [['searchKeywords', true, false, 'https://mcp.exa.ai/mcp']]],
    ['bocha', 'Bocha', 'api', [['searchKeywords', true, true, 'https://api.bochaai.com']]],
    [
      'querit',
      'Querit',
      'api',
      [
        ['searchKeywords', true, true, 'https://api.querit.ai'],
        ['fetchUrls', true, true, 'https://api.querit.ai']
      ]
    ],
    [
      'jina',
      'Jina',
      'api',
      [
        ['searchKeywords', true, true, 'https://s.jina.ai'],
        ['fetchUrls', true, false, 'https://r.jina.ai']
      ]
    ],
    [
      'firecrawl',
      'Firecrawl',
      'api',
      [
        ['searchKeywords', true, false, 'https://api.firecrawl.dev'],
        ['fetchUrls', true, false, 'https://api.firecrawl.dev']
      ]
    ],
    ['crawl4ai', 'Crawl4AI', 'api', [['fetchUrls', true, false, undefined]]],
    ['parallel', 'Parallel', 'api', [['searchKeywords', true, true, 'https://api.parallel.ai']]],
    ['serply', 'Serply', 'api', [['searchKeywords', true, true, 'https://api.serply.io']]]
  ])
  expect(
    webSearchCatalog
      .filter((provider) => ['searxng', 'crawl4ai'].includes(provider.id))
      .every((provider) => !Object.hasOwn(provider.capabilities[0], 'defaultApiHost'))
  ).toBe(true)
})
it('shares frozen catalog records with every provider module', () => {
  const providers = [zhipu, tavily, searxng, exa, exaMcp, bocha, querit, jina, firecrawl, crawl4ai, parallel, serply]
  expect(Object.isFrozen(webSearchCatalog)).toBe(true)
  for (const [index, provider] of providers.entries()) {
    expect(provider.metadata).toBe(webSearchCatalog[index])
    expect(Object.isFrozen(provider.metadata)).toBe(true)
    expect(Object.isFrozen(provider.metadata.capabilities)).toBe(true)
    expect(provider.metadata.capabilities.every(Object.isFrozen)).toBe(true)
  }
})
