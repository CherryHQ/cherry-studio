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
})
