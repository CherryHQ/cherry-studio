import '@testing-library/jest-dom/vitest'

import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect, vi } from 'vitest'

expect.addSnapshotSerializer(styleSheetSerializer)

// Mock LoggerService globally for renderer tests
vi.mock('@logger', async () => {
  const { MockRendererLoggerService, mockRendererLoggerService } = await import('./__mocks__/RendererLoggerService')
  return {
    LoggerService: MockRendererLoggerService,
    loggerService: mockRendererLoggerService
  }
})

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }), // Mocking axios GET request
    post: vi.fn().mockResolvedValue({ data: {} }) // Mocking axios POST request
    // You can add other axios methods like put, delete etc. as needed
  }
}))

vi.stubGlobal('electron', {
  ipcRenderer: {
    on: vi.fn(),
    send: vi.fn()
  }
})
vi.stubGlobal('api', {
  file: {
    read: vi.fn().mockResolvedValue('[]'),
    writeWithId: vi.fn().mockResolvedValue(undefined)
  }
})
