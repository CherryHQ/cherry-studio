import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { generateText }
  } as Parameters<typeof mockApplicationFactory>[0])
})

import type { KnowledgeContentChunk } from '../chunk'
import { generateRetrievalProjections } from '../retrievalProjection'

const chunks: KnowledgeContentChunk[] = [
  {
    unitIndex: 7,
    charStart: 0,
    charEnd: 89,
    text: 'ValeHealth release rc-mini-2026-1 requires two approvers before production deployment.'
  }
]

describe('generateRetrievalProjections', () => {
  beforeEach(() => {
    generateText.mockReset()
  })

  it('dereferences a valid request-local span and uses bounded deterministic generation settings', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            text: 'ValeHealth release rc-mini-2026-1 requires two approvers.',
            spanId: 'S0001',
            anchors: ['ValeHealth', 'rc-mini-2026-1', 'two approvers']
          }
        ]
      })
    })

    await expect(generateRetrievalProjections(chunks, 'provider::fast-model')).resolves.toEqual([
      {
        unitIndex: 7,
        text: 'ValeHealth release rc-mini-2026-1 requires two approvers.'
      }
    ])
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        uniqueModelId: 'provider::fast-model',
        callOverrides: { temperature: 0, maxOutputTokens: 4096 },
        requestOptions: { maxRetries: 0 }
      })
    )
  })

  it('drops unknown citations and anchors absent from the cited raw span', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            text: 'ValeHealth uses PagerDuty for deployment alerts.',
            spanId: 'S0001',
            anchors: ['ValeHealth', 'PagerDuty']
          },
          {
            text: 'ValeHealth release rc-mini-2026-1 requires two approvers.',
            spanId: 'S9999',
            anchors: ['ValeHealth', 'rc-mini-2026-1']
          }
        ]
      })
    })

    await expect(generateRetrievalProjections(chunks, 'provider::fast-model')).resolves.toEqual([])
  })

  it('catches fabricated identifiers even when the model omits them from anchors', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            text: 'ValeHealth release rc-mini-2026-2 requires two approvers.',
            spanId: 'S0001',
            anchors: ['ValeHealth']
          }
        ]
      })
    })

    await expect(generateRetrievalProjections(chunks, 'provider::fast-model')).resolves.toEqual([])
  })

  it('preserves the same proposition when it cites different raw units', async () => {
    const repeatedChunks = [
      chunks[0],
      {
        ...chunks[0],
        unitIndex: 8
      }
    ]
    generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            text: 'ValeHealth release rc-mini-2026-1 requires two approvers.',
            spanId: 'S0001',
            anchors: ['ValeHealth', 'rc-mini-2026-1', 'two approvers']
          },
          {
            text: 'ValeHealth release rc-mini-2026-1 requires two approvers.',
            spanId: 'S0002',
            anchors: ['ValeHealth', 'rc-mini-2026-1', 'two approvers']
          }
        ]
      })
    })

    await expect(generateRetrievalProjections(repeatedChunks, 'provider::fast-model')).resolves.toEqual([
      { unitIndex: 7, text: 'ValeHealth release rc-mini-2026-1 requires two approvers.' },
      { unitIndex: 8, text: 'ValeHealth release rc-mini-2026-1 requires two approvers.' }
    ])
  })

  it('retries an invalid response once and keeps valid facts from the second response', async () => {
    generateText.mockResolvedValueOnce({ text: 'not json' }).mockResolvedValueOnce({
      text: '```json\n{"facts":[{"text":"ValeHealth requires two approvers.","spanId":"S0001","anchors":["ValeHealth","two approvers"]}]}\n```'
    })

    await expect(generateRetrievalProjections(chunks, 'provider::fast-model')).resolves.toHaveLength(1)
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('fails open after two invalid responses and does not call an invalid configured model', async () => {
    generateText.mockResolvedValue({ text: '{}' })

    await expect(generateRetrievalProjections(chunks, 'provider::fast-model')).resolves.toEqual([])
    expect(generateText).toHaveBeenCalledTimes(2)

    generateText.mockClear()
    await expect(generateRetrievalProjections(chunks, 'invalid-model-id')).resolves.toEqual([])
    expect(generateText).not.toHaveBeenCalled()
  })
})
