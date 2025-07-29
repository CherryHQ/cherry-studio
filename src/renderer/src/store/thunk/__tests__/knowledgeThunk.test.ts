import { addFiles as addFilesAction, addItem, updateNotes } from '@renderer/store/knowledge'
import { FileMetadata, FileTypes, KnowledgeItem } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addFilesThunk, addItemThunk, addNoteThunk } from '../knowledgeThunk'

const mocks = vi.hoisted(() => {
  return {
    db: {
      knowledge_notes: {
        add: vi.fn()
      }
    },
    uuid: {
      v4: vi.fn()
    },
    actions: {
      addFiles: vi.fn((payload) => ({ type: 'ADD_FILES', payload })),
      addItem: vi.fn((payload) => ({ type: 'ADD_ITEM', payload })),
      updateNotes: vi.fn((payload) => ({ type: 'UPDATE_NOTES', payload }))
    }
  }
})

// Mock dependencies
vi.mock('@renderer/databases', () => ({
  db: mocks.db
}))

vi.mock('uuid', () => ({
  v4: mocks.uuid.v4
}))

// Mock action creators
vi.mock('@renderer/store/knowledge', () => ({
  addFiles: mocks.actions.addFiles,
  addItem: mocks.actions.addItem,
  updateNotes: mocks.actions.updateNotes
}))

// Create a mock dispatch function
const mockDispatch = vi.fn()

// Mock uuid to return predictable values
const mockUuid = 'test-uuid-123'

/**
 * Helper function to create a mock KnowledgeItem with default values.
 * @param type - The type of the knowledge item.
 * @param content - The content of the knowledge item.
 * @param timestamp - The timestamp for creation and update.
 * @param overrides - Optional overrides for any property.
 * @returns A mock KnowledgeItem.
 */
const createMockKnowledgeItem = (
  type: KnowledgeItem['type'],
  content: any,
  timestamp: number,
  overrides: Partial<KnowledgeItem> = {}
): KnowledgeItem => ({
  id: mockUuid,
  type,
  content,
  created_at: timestamp,
  updated_at: timestamp,
  processingStatus: 'pending',
  processingProgress: 0,
  processingError: '',
  retryCount: 0,
  ...overrides
})

describe('knowledgeThunk', () => {
  const mockFileMetadata: FileMetadata[] = [
    {
      id: 'file1',
      name: 'test.pdf',
      origin_name: 'test.pdf',
      path: '/fake/path/test.pdf',
      size: 1024,
      ext: '.pdf',
      type: FileTypes.DOCUMENT,
      created_at: new Date().toISOString(),
      count: 1
    },
    {
      id: 'file2',
      name: 'document.txt',
      origin_name: 'document.txt',
      path: '/fake/path/document.txt',
      size: 512,
      ext: '.txt',
      type: FileTypes.TEXT,
      created_at: new Date().toISOString(),
      count: 1
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uuid.v4.mockReturnValue(mockUuid)
    mockDispatch.mockClear()
  })

  describe('addFilesThunk', () => {
    it('should dispatch addFiles action with properly formatted and unique file items', () => {
      const baseId = 'test-base-id'
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)

      // Ensure uuid mock returns unique values for this test
      mocks.uuid.v4.mockReturnValueOnce('test-uuid-1').mockReturnValueOnce('test-uuid-2')

      addFilesThunk(baseId, mockFileMetadata)(mockDispatch)

      const expectedItems: KnowledgeItem[] = mockFileMetadata.map((file, index) =>
        createMockKnowledgeItem('file', file, timestamp, { id: `test-uuid-${index + 1}` })
      )

      expect(mockDispatch).toHaveBeenCalledWith(addFilesAction({ baseId, items: expectedItems }))
      // Also verify that v4 was called for each file
      expect(mocks.uuid.v4).toHaveBeenCalledTimes(mockFileMetadata.length)
    })

    it('should handle empty file array', () => {
      const baseId = 'test-base-id'
      vi.spyOn(Date, 'now').mockReturnValue(Date.now())

      addFilesThunk(baseId, [])(mockDispatch)

      expect(mockDispatch).toHaveBeenCalledWith(addFilesAction({ baseId, items: [] }))
    })

    it('should use same timestamp for all files', () => {
      const baseId = 'test-base-id'
      const timestamp = 123456789
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)

      addFilesThunk(baseId, mockFileMetadata)(mockDispatch)

      const dispatchedAction = mockDispatch.mock.calls[0][0]
      const items = dispatchedAction.payload.items

      items.forEach((item: KnowledgeItem) => {
        expect(item.created_at).toBe(timestamp)
        expect(item.updated_at).toBe(timestamp)
      })
    })
  })

  describe('addNoteThunk', () => {
    it('should add note to database and dispatch updateNotes action', async () => {
      const baseId = 'test-base-id'
      const noteContent = 'This is a test note'
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)
      mocks.db.knowledge_notes.add.mockResolvedValue(undefined)

      await addNoteThunk(baseId, noteContent)(mockDispatch)

      const expectedNote = createMockKnowledgeItem('note', noteContent, timestamp)
      expect(mocks.db.knowledge_notes.add).toHaveBeenCalledWith(expectedNote)

      const expectedNoteRef = createMockKnowledgeItem('note', '', timestamp)
      expect(mockDispatch).toHaveBeenCalledWith(updateNotes({ baseId, item: expectedNoteRef }))
    })

    it('should handle empty note content', async () => {
      const baseId = 'test-base-id'
      const noteContent = ''
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)
      mocks.db.knowledge_notes.add.mockResolvedValue(undefined)

      await addNoteThunk(baseId, noteContent)(mockDispatch)

      const expectedNote = createMockKnowledgeItem('note', '', timestamp)
      expect(mocks.db.knowledge_notes.add).toHaveBeenCalledWith(expectedNote)

      const expectedNoteRef = createMockKnowledgeItem('note', '', timestamp)
      expect(mockDispatch).toHaveBeenCalledWith(updateNotes({ baseId, item: expectedNoteRef }))
    })

    it('should not dispatch and re-throw the error on database failure', async () => {
      const baseId = 'test-base-id'
      const noteContent = 'Test note'
      const dbError = new Error('Database error')
      mocks.db.knowledge_notes.add.mockRejectedValue(dbError)

      await expect(addNoteThunk(baseId, noteContent)(mockDispatch)).rejects.toThrow(dbError)

      expect(mockDispatch).not.toHaveBeenCalled()
    })
  })

  describe('addItemThunk', () => {
    it('should dispatch addItem action with url type', () => {
      const baseId = 'test-base-id'
      const content = 'Test content'
      const type = 'url'
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)

      addItemThunk(baseId, type, content)(mockDispatch)

      const expectedItem = createMockKnowledgeItem(type, content, timestamp)
      expect(mockDispatch).toHaveBeenCalledWith(addItem({ baseId, item: expectedItem }))
    })

    it('should handle empty content', () => {
      const baseId = 'test-base-id'
      const content = ''
      const type = 'url'
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)

      addItemThunk(baseId, type, content)(mockDispatch)

      const expectedItem = createMockKnowledgeItem(type, '', timestamp)
      expect(mockDispatch).toHaveBeenCalledWith(addItem({ baseId, item: expectedItem }))
    })

    it('should use consistent initial values', () => {
      const baseId = 'test-base-id'
      const content = 'Test'
      const type = 'url'
      const timestamp = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(timestamp)

      addItemThunk(baseId, type, content)(mockDispatch)

      const dispatchedAction = mockDispatch.mock.calls[0][0]
      const item = dispatchedAction.payload.item

      expect(item.processingStatus).toBe('pending')
      expect(item.processingProgress).toBe(0)
      expect(item.processingError).toBe('')
      expect(item.retryCount).toBe(0)
    })
  })
})
