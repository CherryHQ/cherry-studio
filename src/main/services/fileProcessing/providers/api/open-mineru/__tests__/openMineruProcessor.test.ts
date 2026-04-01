import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeTaskMock } = vi.hoisted(() => ({
  executeTaskMock: vi.fn()
}))

vi.mock('../utils', () => ({
  executeTask: executeTaskMock
}))

import { fileProcessingTaskStore } from '../../../../runtime/FileProcessingTaskStore'
import { openMineruProcessor } from '../openMineruProcessor'

describe('openMineruProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileProcessingTaskStore.clear()
  })

  it('deletes task state after persisting a successful markdown conversion result', async () => {
    const processor = openMineruProcessor as any

    fileProcessingTaskStore.create('open-mineru', 'task-1', {
      status: 'processing',
      progress: 0
    })

    executeTaskMock.mockResolvedValueOnce(Buffer.from('zip'))

    const persistSpy = vi.spyOn(processor, 'persistMarkdownConversionResult').mockResolvedValueOnce('/tmp/output.md')

    await processor.runTask('task-1', {
      apiHost: 'http://127.0.0.1:8000',
      file: {
        id: 'file-1',
        path: '/tmp/input.pdf'
      }
    })

    expect(executeTaskMock).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledWith('file-1', expect.any(Buffer))
    expect(fileProcessingTaskStore.get('open-mineru', 'task-1')).toEqual({
      status: 'completed',
      progress: 100,
      markdownPath: '/tmp/output.md'
    })
  })

  it('returns completed status from task state and deletes it after consumption', async () => {
    fileProcessingTaskStore.create('open-mineru', 'task-2', {
      status: 'completed',
      progress: 100,
      markdownPath: '/tmp/output.md'
    })

    await expect(openMineruProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'open-mineru',
      markdownPath: '/tmp/output.md'
    })

    expect(fileProcessingTaskStore.get('open-mineru', 'task-2')).toBeUndefined()
  })
})
