import { describe, expect, it } from 'vitest'

import type { ContentReference } from '@shared/data/types/message'
import { CitationType, ReferenceCategory } from '@shared/data/types/message'

import { convertReferencesToCitationReferences, convertReferencesToCitations } from '../partsToBlocks'

describe('partsToBlocks citation helpers', () => {
  it('preserves known citation numbers and valid fields beside malformed stored entries', () => {
    const references: readonly unknown[] = [
      null,
      'invalid reference',
      { category: 'metadata' },
      { category: 'citation', citationType: 'web', content: { results: [{ url: 'https://web.test' }] } },
      {
        category: 'citation',
        citationType: 'knowledge',
        content: [
          null,
          { id: 3, content: 'File text', sourceUrl: '[Manual.pdf](http://file/entry-1)' },
          { id: 3, content: 'Second text', sourceUrl: { invalid: true } }
        ]
      },
      {
        category: 'citation',
        citationType: 'memory',
        content: [null, { memory: 'Remember this', hash: '1234567890abcdef' }, { memory: 'Keep this', hash: 42 }]
      }
    ]

    expect(
      convertReferencesToCitations(references).map(({ number, url, title, content }) => ({
        number,
        url,
        title,
        content
      }))
    ).toEqual([
      { number: 1, url: 'https://web.test', title: 'web.test', content: undefined },
      { number: 3, url: 'http://file/entry-1', title: 'Manual.pdf', content: 'File text' },
      { number: 2, url: '', title: '', content: 'Second text' },
      { number: 4, url: '', title: 'Memory 12345678', content: 'Remember this' },
      { number: 5, url: '', title: 'Memory', content: 'Keep this' }
    ])
  })

  it('uses only validated web source names for inline citation references', () => {
    const references: readonly unknown[] = [
      null,
      { category: 'metadata' },
      { category: 'citation', citationType: 'web', content: { source: 'gemini' } },
      { category: 'citation', citationType: 'web', content: { source: { invalid: true } } },
      { category: 'citation', citationType: 'knowledge', content: [] }
    ]

    expect(convertReferencesToCitationReferences(references, 'part-1')).toEqual([
      { citationBlockId: 'part-1', citationBlockSource: 'gemini' },
      { citationBlockId: 'part-1', citationBlockSource: undefined },
      { citationBlockId: 'part-1', citationBlockSource: undefined }
    ])
  })

  it('preserves grounding chunk numbers and support data while skipping invalid web entries', () => {
    const groundingSupports = [{ segment: { text: 'a claim' }, groundingChunkIndices: [1, 3] }]
    const references: ContentReference[] = [
      {
        category: ReferenceCategory.CITATION,
        citationType: CitationType.WEB,
        content: {
          source: 'gemini',
          results: {
            groundingChunks: [
              null,
              { web: { uri: 'https://one.test', title: 'One' } },
              { web: { uri: 42 } },
              { web: { uri: 'https://two.test', title: 'Two' } }
            ],
            groundingSupports
          }
        }
      }
    ]

    expect(convertReferencesToCitations(references)).toEqual([
      {
        number: 2,
        url: 'https://one.test',
        title: 'One',
        showFavicon: true,
        type: 'websearch',
        metadata: groundingSupports
      },
      {
        number: 4,
        url: 'https://two.test',
        title: 'Two',
        showFavicon: true,
        type: 'websearch',
        metadata: groundingSupports
      }
    ])
  })

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
