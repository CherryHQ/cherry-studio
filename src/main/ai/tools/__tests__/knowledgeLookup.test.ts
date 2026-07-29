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

import { searchKnowledge } from '../knowledgeLookup'

const CITE_ID = /^[a-z0-9]{3}-\d+$/

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
})
