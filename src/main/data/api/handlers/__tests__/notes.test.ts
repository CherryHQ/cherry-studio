import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listByRootMock, upsertMock, deleteByPathMock, rewritePathMock } = vi.hoisted(() => ({
  listByRootMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteByPathMock: vi.fn(),
  rewritePathMock: vi.fn()
}))

vi.mock('@data/services/NoteService', () => ({
  noteService: {
    listByRoot: listByRootMock,
    upsert: upsertMock,
    deleteByPath: deleteByPathMock,
    rewritePath: rewritePathMock
  }
}))

import { noteHandlers } from '../notes'

describe('noteHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delegate GET to noteService.listByRoot with parsed query', async () => {
    listByRootMock.mockResolvedValueOnce([{ path: '/notes/a.md', isStarred: true }])

    const result = await noteHandlers['/notes'].GET({ query: { rootPath: '/notes' } } as never)

    expect(listByRootMock).toHaveBeenCalledWith('/notes')
    expect(result).toEqual([{ path: '/notes/a.md', isStarred: true }])
  })

  it('should reject blank GET rootPath before calling the service', async () => {
    await expect(noteHandlers['/notes'].GET({ query: { rootPath: '   ' } } as never)).rejects.toHaveProperty(
      'name',
      'ZodError'
    )
    expect(listByRootMock).not.toHaveBeenCalled()
  })

  it('should delegate PATCH to noteService.upsert with parsed body', async () => {
    upsertMock.mockResolvedValueOnce({ path: '/notes/a.md', isStarred: true })

    await expect(
      noteHandlers['/notes'].PATCH({
        body: { rootPath: '/notes', path: '/notes/a.md', isStarred: true }
      } as never)
    ).resolves.toEqual({ path: '/notes/a.md', isStarred: true })

    expect(upsertMock).toHaveBeenCalledWith({ rootPath: '/notes', path: '/notes/a.md', isStarred: true })
  })

  it('should reject empty PATCH bodies before calling the service', async () => {
    await expect(
      noteHandlers['/notes'].PATCH({
        body: { rootPath: '/notes', path: '/notes/a.md' }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('should delegate DELETE to noteService.deleteByPath with recursive default preserved as optional', async () => {
    deleteByPathMock.mockResolvedValueOnce(undefined)

    await expect(
      noteHandlers['/notes'].DELETE({
        query: { rootPath: '/notes', path: '/notes/folder' }
      } as never)
    ).resolves.toBeUndefined()

    expect(deleteByPathMock).toHaveBeenCalledWith({ rootPath: '/notes', path: '/notes/folder' })
  })

  it('should delegate PATCH /notes/path to noteService.rewritePath with parsed body', async () => {
    rewritePathMock.mockResolvedValueOnce({ updated: 1 })

    await expect(
      noteHandlers['/notes/path'].PATCH({
        body: { rootPath: '/notes', fromPath: '/notes/a.md', toPath: '/notes/b.md', recursive: false }
      } as never)
    ).resolves.toEqual({ updated: 1 })

    expect(rewritePathMock).toHaveBeenCalledWith({
      rootPath: '/notes',
      fromPath: '/notes/a.md',
      toPath: '/notes/b.md',
      recursive: false
    })
  })
})
