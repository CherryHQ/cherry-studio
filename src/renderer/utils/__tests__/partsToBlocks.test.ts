import type { ContentReference } from '@shared/data/types/message'
import { CitationType, ReferenceCategory } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { convertReferencesToCitations } from '../partsToBlocks'

describe('partsToBlocks citation helpers', () => {
  it('preserves explicit citation numbers from web results', () => {
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.WEB,
        content: {
          source: 'websearch',
          results: [
            { number: 1, url: 'https://one.test', title: 'One' },
            { number: 4, url: 'https://four.test', title: 'Four' },
            { number: 9, url: 'https://nine.test', title: 'Nine' }
          ]
        }
      }
    ]

    expect(convertReferencesToCitations(references).map((citation) => citation.number)).toEqual([1, 4, 9])
  })

  it('assigns missing citation numbers around explicit citation numbers', () => {
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.WEB,
        content: {
          source: 'websearch',
          results: [
            { url: 'https://one.test', title: 'One' },
            { number: 4, url: 'https://four.test', title: 'Four' },
            { url: 'https://two.test', title: 'Two' }
          ]
        }
      }
    ]

    expect(convertReferencesToCitations(references).map((citation) => citation.number)).toEqual([1, 4, 2])
  })

  it('keeps numbered bibliography entries without urls for hover-only citations', () => {
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.WEB,
        content: {
          source: 'websearch',
          results: [{ number: 2, url: '', title: 'Data Structures for Statistical Computing in Python' }]
        }
      }
    ]

    expect(convertReferencesToCitations(references)).toEqual([
      {
        number: 2,
        url: '',
        title: 'Data Structures for Statistical Computing in Python',
        content: undefined,
        showFavicon: true,
        type: 'websearch'
      }
    ])
  })

  // v1 stored the whole markdown link in sourceUrl, which is neither linkable nor readable.
  it('unwraps the v1 markdown-link source url of a knowledge citation', () => {
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.KNOWLEDGE,
        content: [{ id: 1, content: 'chunk', sourceUrl: '[Quarterly Report.pdf](http://file/9f3c.pdf)', type: 'file' }]
      }
    ]

    expect(convertReferencesToCitations(references)).toEqual([
      {
        number: 1,
        url: 'http://file/9f3c.pdf',
        title: 'Quarterly Report.pdf',
        content: 'chunk',
        showFavicon: true,
        type: 'knowledge'
      }
    ])
  })

  it('keeps a non-link knowledge source url as-is', () => {
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.KNOWLEDGE,
        content: [{ id: 1, content: 'chunk', sourceUrl: '/Users/me/docs/notes.md', type: 'file' }]
      }
    ]

    expect(convertReferencesToCitations(references)).toEqual([
      {
        number: 1,
        url: '/Users/me/docs/notes.md',
        title: '/Users/me/docs/notes.md',
        content: 'chunk',
        showFavicon: true,
        type: 'knowledge'
      }
    ])
  })
})
