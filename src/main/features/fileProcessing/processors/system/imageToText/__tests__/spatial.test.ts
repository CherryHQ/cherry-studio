import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recognizeFromPath = vi.hoisted(() => vi.fn())

vi.mock('@main/core/platform', () => ({ isLinux: false, isMac: true, isWin: false }))
vi.mock('@cherrystudio/mac-system-ocr', () => ({
  default: {
    RECOGNITION_LEVEL_ACCURATE: 1,
    recognizeFromPath
  }
}))

import { systemImageToTextHandler } from '../handler'

describe('systemImageToTextHandler macOS spatial output', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-spatial-ocr-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('converts real Vision observations to top-left source-image pixel boxes', async () => {
    const imagePath = path.join(tempDir, 'scan.png')
    const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    await fs.writeFile(imagePath, bytes)

    recognizeFromPath.mockResolvedValue({
      text: 'Cherry Studio',
      observations: [{ text: 'Cherry Studio', confidence: 0.92, x: 0.1, y: 0.2, width: 0.5, height: 0.1 }]
    })

    const prepared = await systemImageToTextHandler.prepare(
      FileInfoSchema.parse({
        path: imagePath,
        name: 'scan',
        size: bytes.length,
        ext: 'png',
        mime: 'image/png',
        type: FILE_TYPE.IMAGE,
        createdAt: 1,
        modifiedAt: 1
      }),
      {
        id: 'system',
        type: 'builtin',
        capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }],
        options: { langs: ['zh-Hans', 'en-US'] }
      } as never
    )

    if (prepared.mode !== 'background') throw new Error('expected a background job')
    await expect(prepared.execute({ signal: new AbortController().signal, reportProgress: () => {} })).resolves.toEqual(
      {
        kind: 'spatial-text',
        text: 'Cherry Studio',
        lines: [
          [
            {
              text: 'Cherry Studio',
              confidence: 0.92,
              box: { x: 20, y: 70, width: 100, height: 10 }
            }
          ]
        ]
      }
    )
    expect(recognizeFromPath).toHaveBeenCalledWith(imagePath, {
      recognitionLevel: 1,
      languages: 'zh-Hans,en-US'
    })
  })
})
