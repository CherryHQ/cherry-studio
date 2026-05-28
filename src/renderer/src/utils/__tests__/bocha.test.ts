import { describe, expect, it } from 'vitest'

import { BochaSearchResponseSchema } from '../bocha'

describe('BochaSearchResponseSchema', () => {
  it('accepts image thumbnail objects from the latest Bocha response', () => {
    const result = BochaSearchResponseSchema.safeParse({
      code: 200,
      log_id: 'test-log-id',
      msg: null,
      data: {
        _type: 'SearchResponse',
        queryContext: {
          originalQuery: '测试查询'
        },
        webPages: {
          webSearchUrl: '',
          totalEstimatedMatches: 1,
          value: [
            {
              id: null,
              name: '网页结果',
              url: 'https://example.com/page',
              displayUrl: 'https://example.com/page',
              snippet: '网页摘要',
              summary: '网页总结',
              siteName: 'example.com',
              siteIcon: 'https://example.com/favicon.ico',
              datePublished: '2025-02-23T08:18:30+08:00',
              dateLastCrawled: '2025-02-23T08:18:30Z',
              cachedPageUrl: null,
              language: null,
              isFamilyFriendly: null,
              isNavigational: null
            }
          ],
          someResultsRemoved: false
        },
        images: {
          id: null,
          readLink: null,
          webSearchUrl: null,
          isFamilyFriendly: null,
          value: [
            {
              webSearchUrl: null,
              name: '图片结果',
              thumbnailUrl: 'https://example.com/thumbnail.jpg',
              datePublished: null,
              contentUrl: 'https://example.com/image.jpg',
              hostPageUrl: 'https://example.com/page',
              contentSize: null,
              encodingFormat: null,
              hostPageDisplayUrl: null,
              width: 553,
              height: 311,
              thumbnail: {
                height: 311,
                width: 553
              }
            }
          ]
        },
        videos: null
      }
    })

    expect(result.success).toBe(true)
  })
})
