import { readFile } from 'node:fs/promises'

import type { FileInfo } from '@shared/file/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sharpPipeline = {
  grayscale: vi.fn(),
  normalize: vi.fn(),
  sharpen: vi.fn(),
  png: vi.fn(),
  toBuffer: vi.fn()
}

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => sharpPipeline)
}))

import { loadFileProcessingOcrImage } from '../ocr'

describe('loadFileProcessingOcrImage', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    sharpPipeline.grayscale.mockReset()
    sharpPipeline.normalize.mockReset()
    sharpPipeline.sharpen.mockReset()
    sharpPipeline.png.mockReset()
    sharpPipeline.toBuffer.mockReset()

    sharpPipeline.grayscale.mockReturnValue(sharpPipeline)
    sharpPipeline.normalize.mockReturnValue(sharpPipeline)
    sharpPipeline.sharpen.mockReturnValue(sharpPipeline)
    sharpPipeline.png.mockReturnValue(sharpPipeline)
  })

  it('loads and preprocesses a v2 FileInfo path', async () => {
    const raw = Buffer.from('raw-image')
    const processed = Buffer.from('processed-image')
    vi.mocked(readFile).mockResolvedValue(raw)
    sharpPipeline.toBuffer.mockResolvedValue(processed)

    await expect(loadFileProcessingOcrImage({ path: '/tmp/scan.png' as FileInfo['path'] })).resolves.toBe(processed)

    expect(readFile).toHaveBeenCalledWith('/tmp/scan.png')
    expect(sharpPipeline.grayscale).toHaveBeenCalled()
    expect(sharpPipeline.normalize).toHaveBeenCalled()
    expect(sharpPipeline.sharpen).toHaveBeenCalled()
    expect(sharpPipeline.png).toHaveBeenCalledWith({ quality: 100 })
  })
})
