import { vi } from 'vitest'

export const MockMainTesseractRuntimeServiceExport = {
  tesseractRuntimeService: {
    extract: vi.fn(async () => ({
      text: ''
    }))
  }
}
