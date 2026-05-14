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
      fileProcessingArtifactPersistence.persistArtifact({
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
      fileProcessingArtifactPersistence.persistArtifact({
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
      fileProcessingArtifactPersistence.persistArtifact({
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
      fileProcessingArtifactPersistence.persistArtifact({
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

  it('cleans up only FileManager-backed artifacts', async () => {
    await fileProcessingArtifactPersistence.cleanupArtifacts({
      taskId: 'task-1',
      artifacts: [
        {
          kind: 'text',
          format: 'plain',
          text: 'ocr text'
        },
        {
          kind: 'file',
          format: 'markdown',
          fileEntryId: '019606a0-0000-7000-8000-000000000101'
        }
      ]
    })

    expect(application.get).toHaveBeenCalledWith('FileManager')
    expect(permanentDeleteMock).toHaveBeenCalledWith('019606a0-0000-7000-8000-000000000101')
  })

  it('does not fail artifact cleanup when FileManager deletion fails', async () => {
    permanentDeleteMock.mockRejectedValueOnce(new Error('delete failed'))

    await expect(
      fileProcessingArtifactPersistence.cleanupArtifacts({
        taskId: 'task-1',
        artifacts: [
          {
            kind: 'file',
            format: 'markdown',
            fileEntryId: '019606a0-0000-7000-8000-000000000101'
          }
        ]
      })
    ).resolves.toBeUndefined()
  })
})
