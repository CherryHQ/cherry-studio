import { application } from '@application'
import type { FileEntryId } from '@shared/data/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cleanupResultsDirMock, createInternalEntryMock, permanentDeleteMock, persistResultMock } = vi.hoisted(() => ({
  cleanupResultsDirMock: vi.fn(),
  createInternalEntryMock: vi.fn(),
  permanentDeleteMock: vi.fn(),
  persistResultMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'FileManager') {
        return {
          createInternalEntry: createInternalEntryMock,
          permanentDelete: permanentDeleteMock
        }
      }

      throw new Error(`[FileProcessingArtifactPersistence.test] Unknown service: ${name}`)
    })
  }
}))

vi.mock('../MarkdownResultStore', () => ({
  cleanupFileProcessingResultsDir: cleanupResultsDirMock,
  markdownResultStore: {
    persistResult: persistResultMock
  }
}))

const { fileProcessingArtifactPersistence } = await import('../FileProcessingArtifactPersistence')

describe('FileProcessingArtifactPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistResultMock.mockResolvedValue('/tmp/file-processing/output.md')
    cleanupResultsDirMock.mockResolvedValue(true)
    permanentDeleteMock.mockResolvedValue(undefined)
    createInternalEntryMock.mockResolvedValue({
      id: '019606a0-0000-7000-8000-000000000101' as FileEntryId
    })
  })

  it('persists normalized markdown output as a FileManager file artifact', async () => {
    const signal = new AbortController().signal

    await expect(
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
          kind: 'markdown',
          markdownContent: '# done'
        },
        signal
      })
    ).resolves.toEqual([
      {
        kind: 'file',
        format: 'markdown',
        fileEntryId: '019606a0-0000-7000-8000-000000000101'
      }
    ])

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

  it('returns text artifacts without touching markdown staging or FileManager', async () => {
    await expect(
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
          kind: 'text',
          text: 'ocr text'
        },
        signal: new AbortController().signal
      })
    ).resolves.toEqual([
      {
        kind: 'text',
        format: 'plain',
        text: 'ocr text'
      }
    ])

    expect(persistResultMock).not.toHaveBeenCalled()
    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('cleans staging output when FileManager entry creation fails', async () => {
    createInternalEntryMock.mockRejectedValueOnce(new Error('internal create failed'))

    await expect(
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
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
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
          kind: 'markdown',
          markdownContent: '# failed'
        }
      })
    ).rejects.toThrow('normalization failed')

    expect(createInternalEntryMock).not.toHaveBeenCalled()
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('task-1')
  })

  it('rolls back a created FileManager entry when commit is aborted after entry creation', async () => {
    const controller = new AbortController()
    createInternalEntryMock.mockImplementationOnce(async () => {
      controller.abort()
      return {
        id: '019606a0-0000-7000-8000-000000000101' as FileEntryId
      }
    })

    await expect(
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
          kind: 'markdown',
          markdownContent: '# aborted'
        },
        signal: controller.signal
      })
    ).rejects.toThrow(/abort/i)

    expect(application.get).toHaveBeenCalledWith('FileManager')
    expect(permanentDeleteMock).toHaveBeenCalledWith('019606a0-0000-7000-8000-000000000101')
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('task-1')
  })

  it('keeps the original commit error when rollback deletion fails', async () => {
    const controller = new AbortController()
    createInternalEntryMock.mockImplementationOnce(async () => {
      controller.abort()
      return {
        id: '019606a0-0000-7000-8000-000000000101' as FileEntryId
      }
    })
    permanentDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(
      fileProcessingArtifactPersistence.commitOutput({
        taskId: 'task-1',
        output: {
          kind: 'markdown',
          markdownContent: '# aborted'
        },
        signal: controller.signal
      })
    ).rejects.toThrow(/abort/i)

    expect(permanentDeleteMock).toHaveBeenCalledWith('019606a0-0000-7000-8000-000000000101')
  })
})
