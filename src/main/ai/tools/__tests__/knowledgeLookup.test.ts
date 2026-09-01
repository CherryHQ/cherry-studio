import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { knowledgeSearchMock } = vi.hoisted(() => ({
  knowledgeSearchMock: vi.fn<() => Promise<unknown[]>>()
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { search: knowledgeSearchMock }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

import {
  KNOWLEDGE_UNREADABLE_OUTPUT_NOTE,
  knowledgeListModelOutput,
  knowledgeManageModelOutput,
  knowledgeReadModelOutput,
  searchKnowledge
} from '../knowledgeLookup'

const CITE_ID = /^[0-9a-f]{8}-\d+$/

afterEach(() => vi.restoreAllMocks())

describe('searchKnowledge', () => {
  it('assigns prefixed sequential citation ids across merged base results', async () => {
    knowledgeSearchMock.mockResolvedValueOnce([
      { pageContent: 'chunk one', score: 0.9, conceptId: 'c1', title: 'Doc 1', metadata: { itemType: 'file' } },
      { pageContent: 'chunk two', score: 0.5, conceptId: 'c2', title: 'Doc 2', metadata: { itemType: 'file' } }
    ])
    const output = await searchKnowledge('query', ['base1'], [])
    expect(Array.isArray(output)).toBe(true)
    const ids = (output as Array<{ id: string }>).map((r) => r.id)
    ids.forEach((id) => expect(id).toMatch(CITE_ID))
    expect(ids.map((id) => id.split('-')[1])).toEqual(['1', '2'])
  })

  it('tags each hit with the base it came from', async () => {
    // conceptId is base-relative, so without baseId two bases' `README.md` are
    // indistinguishable downstream — and kb_read needs the baseId to follow a hit up.
    knowledgeSearchMock
      .mockResolvedValueOnce([
        { pageContent: 'from A', score: 0.9, conceptId: 'README.md', title: 'README', metadata: { itemType: 'file' } }
      ])
      .mockResolvedValueOnce([
        { pageContent: 'from B', score: 0.8, conceptId: 'README.md', title: 'README', metadata: { itemType: 'file' } }
      ])

    const output = (await searchKnowledge('query', ['base1', 'base2'], [])) as Array<{
      baseId: string
      conceptId: string
    }>

    expect(output.map((r) => [r.baseId, r.conceptId])).toEqual([
      ['base1', 'README.md'],
      ['base2', 'README.md']
    ])
  })
})

// `toModelOutput` re-runs over every stored tool part on each turn, so a part whose output no longer
// matches a known shape must render a note. Throwing there fails the whole request — the reported
// symptom was a knowledge-base conversation that could not be continued until the base was removed.
describe('model output formatters on unreadable stored output', () => {
  const listInput = { query: null, groupId: null, baseId: null, cursor: null }

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a rendered marker string', '<persisted-output>…</persisted-output>'],
    ['an MCP result envelope', { content: [{ type: 'text', text: 'kb_list output' }] }],
    ['an object with neither items nor nodes', {}],
    ['nodes without the array', { baseId: 'base1', nodes: undefined }],
    ['items without the array', { total: 3, items: undefined }]
  ])('kb_list renders the note for %s instead of throwing', (_label, output) => {
    expect(knowledgeListModelOutput(output as never, listInput)).toEqual({
      type: 'text',
      value: KNOWLEDGE_UNREADABLE_OUTPUT_NOTE
    })
  })

  it('kb_list still renders its known shapes', () => {
    expect(knowledgeListModelOutput({ items: [{ id: 'b1' }], total: 1 } as never, listInput)).toEqual({
      type: 'json',
      value: { items: [{ id: 'b1' }], total: 1 }
    })
    expect(
      knowledgeListModelOutput(
        { baseId: 'b1', totalItems: 0, truncated: false, nodes: [] },
        {
          ...listInput,
          baseId: 'b1'
        }
      )
    ).toEqual({ type: 'text', value: 'Knowledge base "b1" has no items yet.' })
  })

  it('kb_read and kb_manage render the note for a non-object output', () => {
    expect(knowledgeReadModelOutput(undefined as never)).toEqual({
      type: 'text',
      value: KNOWLEDGE_UNREADABLE_OUTPUT_NOTE
    })
    expect(knowledgeManageModelOutput('marker' as never)).toEqual({
      type: 'text',
      value: KNOWLEDGE_UNREADABLE_OUTPUT_NOTE
    })
  })
})
