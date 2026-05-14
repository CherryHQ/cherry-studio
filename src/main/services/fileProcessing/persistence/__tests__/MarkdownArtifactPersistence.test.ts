import { application } from '@application'
import type { FileEntryId } from '@shared/data/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanupResultsDirMock, createInternalEntryMock, persistResultMock } = vi.hoisted(() => ({
  cleanupResultsDirMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  persistResultMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'FileManager') {
        return {
          createInternalEntry: createInternalEntryMock
        }
      }

      throw new Error(`[MarkdownArtifactPersistence.test] Unknown service: ${name}`)
    })
  }
}))

vi.mock('../MarkdownResultStore', () => ({
  cleanupFileProcessingResultsDir: cleanupResultsDirMock,
  markdownResultStore: {
    persistResult: persistResultMock
  }
}))

const { markdownArtifactPersistence } = await import('../MarkdownArtifactPersistence')

describe('MarkdownArtifactPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistResultMock.mockResolvedValue('/tmp/file-processing/output.md')
    cleanupResultsDirMock.mockResolvedValue(true)
    createInternalEntryMock.mockResolvedValue({
      id: '019606a0-0000-7000-8000-000000000101' as FileEntryId
    })
  })

  it('persists normalized markdown output as a FileManager file artifact', async () => {
    const signal = new AbortController().signal

    await expect(
      markdownArtifactPersistence.persistArtifact({
        taskId: 'task-1',
        result: {
          kind: 'markdown',
          markdownContent: '# done'
        },
        signal
      })
    ).resolves.toEqual({
      kind: 'file',
      format: 'markdown',
      fileEntryId: '019606a0-0000-7000-8000-000000000101'
    })

    expect(persistResultMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      result: {
        kind: 'markdown',
        markdownContent: '# done'
      },
      signal
    })
    expect(application.get).toHaveBeenCalledWith('FileManager')
    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/file-processing/output.md'
    })
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('task-1')
  })

  it('cleans staging output when FileManager entry creation fails', async () => {
    createInternalEntryMock.mockRejectedValueOnce(new Error('internal create failed'))

    await expect(
      markdownArtifactPersistence.persistArtifact({
        taskId: 'task-1',
        result: {
          kind: 'markdown',
          markdownContent: '# failed'
        }
      })
    ).rejects.toThrow('internal create failed')

    expect(cleanupResultsDirMock).toHaveBeenCalledWith('task-1')
  })

  it('cleans staging output when markdown normalization fails after creating a staging dir', async () => {
    persistResultMock.mockRejectedValueOnce(new Error('normalization failed'))

    await expect(
      markdownArtifactPersistence.persistArtifact({
        taskId: 'task-1',
        result: {
          kind: 'markdown',
          markdownContent: '# failed'
        }
      })
    ).rejects.toThrow('normalization failed')

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('task-1')
  })
})
