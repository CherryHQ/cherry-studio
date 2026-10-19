import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notesRequestSchemas } from '@shared/ipc/schemas/notes'
import type { NotesTreeNode } from '@shared/types/note'

const service = vi.hoisted(() => ({
  cancel: vi.fn(),
  search: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    NotesSearchService: service
  } as Parameters<typeof mockApplicationFactory>[0])
})

import { notesHandlers } from '../notes'

const { application } = await import('@application')
const applicationGet = vi.mocked(application.get)

const node: NotesTreeNode = {
  id: 'note-1',
  name: 'Note',
  type: 'file',
  treePath: 'Note.md',
  externalPath: '/notes/Note.md',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z'
}
const ctx = { senderId: 'window-1' }
const nullSenderCtx = { senderId: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notesHandlers', () => {
  it.each([1_001, 32_768])('accepts path-derived note IDs of length %s throughout the tree', (length) => {
    const externalPath = `/${'a'.repeat(length - 1)}`
    const file = { ...node, id: externalPath, externalPath, treePath: externalPath }
    const input = {
      requestId: 'long-path',
      nodes: [{ ...node, type: 'folder', children: [file] }, node],
      keyword: 'note',
      options: {},
      maxResults: 10
    }

    const parsed = notesRequestSchemas['notes.full_text.search'].input.parse(input)
    expect(parsed.nodes[0].children?.[0]).toEqual(file)
    expect(parsed.nodes[1]).toEqual(node)
  })

  it('rejects an ID exceeding the supported path length', () => {
    const input = {
      requestId: 'oversized-id',
      nodes: [{ ...node, id: 'a'.repeat(32_769) }],
      keyword: 'note',
      options: {},
      maxResults: 10
    }

    expect(notesRequestSchemas['notes.full_text.search'].input.safeParse(input).success).toBe(false)
  })

  it('returns no results without resolving the service when the sender has no window identity', async () => {
    await expect(
      notesHandlers['notes.full_text.search'](
        { requestId: 'search-1', nodes: [node], keyword: 'note', options: {}, maxResults: 10 },
        nullSenderCtx
      )
    ).resolves.toEqual([])

    expect(applicationGet).not.toHaveBeenCalled()
    expect(service.search).not.toHaveBeenCalled()
  })

  it('delegates one search operation with trusted sender scope', async () => {
    const expected = [{ ...node, matchType: 'filename' as const, matches: [], score: 100 }]
    service.search.mockResolvedValue(expected)

    await expect(
      notesHandlers['notes.full_text.search'](
        {
          requestId: 'search-1',
          nodes: [node],
          keyword: 'note',
          options: { caseSensitive: true },
          maxResults: 10
        },
        ctx
      )
    ).resolves.toEqual(expected)

    expect(applicationGet).toHaveBeenCalledWith('NotesSearchService')
    expect(service.search).toHaveBeenCalledWith(
      {
        nodes: [node],
        keyword: 'note',
        options: { caseSensitive: true },
        maxResults: 10
      },
      { requestId: 'search-1', senderId: 'window-1' }
    )
  })

  it('cancels only the caller window request', async () => {
    await notesHandlers['notes.full_text.cancel']({ requestId: 'search-1' }, ctx)

    expect(applicationGet).toHaveBeenCalledWith('NotesSearchService')
    expect(service.cancel).toHaveBeenCalledWith({ requestId: 'search-1', senderId: 'window-1' })
  })

  it('ignores cancellation from a sender without a managed window identity', async () => {
    await expect(notesHandlers['notes.full_text.cancel']({ requestId: 'search-1' }, nullSenderCtx)).resolves.toBe(
      undefined
    )

    expect(applicationGet).not.toHaveBeenCalled()
    expect(service.cancel).not.toHaveBeenCalled()
  })
})
