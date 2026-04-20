import { vi } from 'vitest'

const startTask = vi.fn()
const getTaskResult = vi.fn()

export const MockMainMarkdownTaskServiceExport = {
  markdownTaskService: {
    startTask,
    getTaskResult
  },
  markdownTaskServiceMock: {
    startTask,
    getTaskResult,
    reset: () => {
      startTask.mockReset()
      getTaskResult.mockReset()
    }
  }
}
