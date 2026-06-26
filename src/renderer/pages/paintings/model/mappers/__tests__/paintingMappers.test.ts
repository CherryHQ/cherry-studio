import type { FileMetadata } from '@renderer/types/file'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { recordToPaintingData } from '../recordToPaintingData'

const { mockDataApiGet, mockGetPhysicalPath } = vi.hoisted(() => ({
  mockDataApiGet: vi.fn(),
  mockGetPhysicalPath: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: mockDataApiGet
  }
}))

vi.stubGlobal('window', {
  api: {
    file: {
      getPhysicalPath: mockGetPhysicalPath
    }
  }
})

describe('recordToPaintingData', () => {
  const file: FileMetadata = {
    id: 'file-1',
    name: 'file-1.png',
    origin_name: 'file-1.png',
    path: '/tmp/file-1.png',
    size: 10,
    ext: '.png',
    type: 'image',
    created_at: '2026-01-01T00:00:00.000Z',
    count: 1
  }

  const record: PaintingRecord = {
    id: 'painting-1',
    providerId: 'silicon',
    modelId: 'silicon::model-1',
    prompt: 'draw a cat',
    files: {
      output: ['file-1', 'missing-file'],
      input: ['input-file-1', 'missing-input-file']
    },
    // Generation snapshot + canvas placement — must survive the round-trip.
    mode: 'edit',
    params: { seed: '42', size: '1024x1024' },
    canvasX: 100,
    canvasY: 200,
    canvasW: 320,
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    mockDataApiGet.mockReset()
    mockGetPhysicalPath.mockReset()
    mockDataApiGet.mockImplementation(async (path: string) => {
      // DataApi path is `/files/entries/${id}` after template-literal resolution.
      const id = path.split('/').pop() ?? ''
      if (id === 'file-1' || id === 'input-file-1') {
        return {
          id,
          origin: 'internal',
          name: id,
          ext: 'png',
          size: 10,
          createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
          updatedAt: Date.parse('2026-01-01T00:00:00.000Z')
        }
      }
      throw new Error(`not found: ${id}`)
    })
    mockGetPhysicalPath.mockImplementation(async ({ id }: { id: string }) => `/tmp/${id}.png`)
  })

  it('hydrates a Painting record into PaintingData with resolved files', async () => {
    const result = await recordToPaintingData(record)

    expect(result).toEqual({
      id: 'painting-1',
      providerId: 'silicon',
      mode: 'edit',
      model: 'model-1',
      prompt: 'draw a cat',
      // `name` is the on-disk filename (`${id}${ext}`) — Artboard's
      // FileManager.getFileUrl appends it to `Data/Files/` to build the
      // <img src>. `origin_name` carries the user-facing display name.
      files: [{ ...file, name: 'file-1.png', origin_name: 'file-1.png', path: '/tmp/file-1.png' }],
      // `inputFiles` are raw v2 `FileEntry[]` — the painting form passes them
      // through to canonicalGenerate which pre-fetches bytes via
      // `window.api.file.binaryImage`. No FileMetadata adaption.
      inputFiles: [
        {
          id: 'input-file-1',
          origin: 'internal',
          name: 'input-file-1',
          ext: 'png',
          size: 10,
          createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
          updatedAt: Date.parse('2026-01-01T00:00:00.000Z')
        }
      ],
      persistedAt: '2026-01-01T00:00:00.000Z',
      // Generation snapshot + canvas placement flow straight through.
      params: { seed: '42', size: '1024x1024' },
      canvasX: 100,
      canvasY: 200,
      canvasW: 320,
      status: undefined
    })
  })

  it('resolves model to undefined when modelId is null', async () => {
    const paintingData = await recordToPaintingData({ ...record, id: 'painting-null-model', modelId: null })
    expect(paintingData.model).toBeUndefined()
  })

  it('mirrors the persisted generation status (failed → retry-able)', async () => {
    const paintingData = await recordToPaintingData({ ...record, id: 'painting-failed', status: 'failed' })
    expect(paintingData.status).toBe('failed')
  })
})
