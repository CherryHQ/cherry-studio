import type { CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { normalizeAssistantMessageCitations } from '../normalizeCitations'

describe('normalizeAssistantMessageCitations', () => {
  it('projects source-url parts into text part references', () => {
    const message = {
      id: 'msg-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Moonshot Kimi K2.6[1][2]' },
        { type: 'source-url', sourceId: 'citation-0', url: 'https://source1.test', title: 'Source 1' },
        { type: 'source-url', sourceId: 'citation-1', url: 'https://source2.test', title: 'Source 2' }
      ]
    } as unknown as CherryUIMessage

    const normalized = normalizeAssistantMessageCitations(message)
    const textPart = normalized.parts[0] as any

    expect(textPart.providerMetadata.cherry.references).toEqual([
      {
        category: 'citation',
        citationType: 'web',
        content: {
          source: 'ai-sdk',
          results: [
            { number: 1, url: 'https://source1.test', title: 'Source 1' },
            { number: 2, url: 'https://source2.test', title: 'Source 2' }
          ]
        }
      }
    ])
    expect(normalized.parts[1]).toEqual(message.parts[1])
  })

  it('keeps source-url result numbers aligned with inline markers', () => {
    const message = {
      id: 'msg-source-numbering',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Moonshot Kimi K2.6[4][9]' },
        ...Array.from({ length: 9 }, (_, index) => ({
          type: 'source-url',
          sourceId: `citation-${index}`,
          url: `https://source${index + 1}.test`,
          title: `Source ${index + 1}`
        }))
      ]
    } as unknown as CherryUIMessage

    const normalized = normalizeAssistantMessageCitations(message)
    const refs = (normalized.parts[0] as any).providerMetadata.cherry.references

    expect(refs[0].content.results[3]).toMatchObject({ number: 4, url: 'https://source4.test' })
    expect(refs[0].content.results[8]).toMatchObject({ number: 9, url: 'https://source9.test' })
  })

  it('projects markdown reference sections into text part references', () => {
    const message = {
      id: 'msg-2',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: [
            '推荐选择：pandas + openpyxl [1][2]，XlsxWriter [4]，EPPlus [9]。',
            '',
            '## 参考文献',
            '',
            '[1] Gazoni, E., & Clark, C. (2010). *openpyxl: A Python library*. https://openpyxl.readthedocs.io/',
            '',
            '[2] McKinney, W. (2010). *Data Structures for Statistical Computing in Python*.',
            '',
            '[4] McNamara, J. (2013). *XlsxWriter: A Python module for creating Excel XLSX files*. https://xlsxwriter.readthedocs.io/',
            '',
            '[9] EPPlus Software. (2009). *EPPlus: Create advanced Excel spreadsheets using .NET*. https://github.com/EPPlusSoftware/EPPlus'
          ].join('\n')
        }
      ]
    } as unknown as CherryUIMessage

    const normalized = normalizeAssistantMessageCitations(message)
    const refs = (normalized.parts[0] as any).providerMetadata.cherry.references

    expect(refs).toHaveLength(1)
    expect(refs[0].content.source).toBe('websearch')
    expect(refs[0].content.results).toMatchObject([
      { number: 1, url: 'https://openpyxl.readthedocs.io/', title: 'openpyxl: A Python library' },
      { number: 2, url: '', title: 'Data Structures for Statistical Computing in Python' },
      {
        number: 4,
        url: 'https://xlsxwriter.readthedocs.io/',
        title: 'XlsxWriter: A Python module for creating Excel XLSX files'
      },
      {
        number: 9,
        url: 'https://github.com/EPPlusSoftware/EPPlus',
        title: 'EPPlus: Create advanced Excel spreadsheets using .NET'
      }
    ])
  })

  it('does not overwrite existing cherry references', () => {
    const message = {
      id: 'msg-3',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: 'Already cited [1]',
          providerMetadata: {
            cherry: {
              references: [
                {
                  category: 'citation',
                  citationType: 'web',
                  content: { source: 'websearch', results: [{ number: 1, url: 'https://existing.test' }] }
                }
              ]
            }
          }
        },
        { type: 'source-url', sourceId: 'citation-0', url: 'https://source1.test', title: 'Source 1' }
      ]
    } as unknown as CherryUIMessage

    expect(normalizeAssistantMessageCitations(message)).toBe(message)
  })
})
