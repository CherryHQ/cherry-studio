import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { knowledgeSearchMock, knowledgeAddItemsMock } = vi.hoisted(() => ({
  knowledgeSearchMock: vi.fn<() => Promise<unknown[]>>(),
  knowledgeAddItemsMock: vi.fn<() => Promise<unknown>>()
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'KnowledgeService') return { search: knowledgeSearchMock, addItems: knowledgeAddItemsMock }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

import { manageKnowledge, searchKnowledge } from '../knowledgeLookup'

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

describe('manageKnowledge add', () => {
  it('persists the full source path for a file add so same-path conflict detection stays consistent', async () => {
    // Regression: a runtime file add previously stored `source` as the basename while
    // UI adds store the full path, so a real same-path re-add missed the conflict and
    // duplicated. `source` must be the full path across producers.
    knowledgeAddItemsMock.mockResolvedValueOnce({ status: 'added' })

    const result = await manageKnowledge({ baseId: 'base1', action: 'add', type: 'file', path: '/a/report.pdf' }, [])

    expect(knowledgeAddItemsMock).toHaveBeenCalledWith('base1', [
      { type: 'file', data: { source: '/a/report.pdf', path: '/a/report.pdf' } }
    ])
    expect(result).toEqual({ action: 'add', added: ['/a/report.pdf'] })
  })
})
