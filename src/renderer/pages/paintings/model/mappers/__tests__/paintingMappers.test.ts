import type { FileMetadata } from '@renderer/types'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paintingDataToCreateDto } from '../paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../paintingDataToUpdateDto'
import { recordsToPaintingDataList, recordToPaintingData } from '../recordToPaintingData'

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

describe('paintingMappers', () => {
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
      mode: 'generate',
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
      persistedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('round-trips painting through create DTO carrying only the frozen-receipt fields', async () => {
    const paintingDataList = await recordsToPaintingDataList([record])
    const paintingData = paintingDataList[0]

    expect(paintingDataList).toHaveLength(1)

    expect(
      paintingDataToCreateDto({
        ...paintingData,
        providerId: 'silicon'
      })
    ).toEqual({
      id: 'painting-1',
      providerId: 'silicon',
      modelId: 'model-1',
      prompt: 'draw a cat',
      files: {
        output: ['file-1'],
        input: ['input-file-1']
      }
    })
  })

  it('handles modelId: null — model resolves to undefined and round-trips as absent modelId', async () => {
    const nullModelRecord: PaintingRecord = {
      ...record,
      id: 'painting-null-model',
      modelId: null
    }

    const paintingData = await recordToPaintingData(nullModelRecord)
    expect(paintingData.model).toBeUndefined()

    const createDto = paintingDataToCreateDto({ ...paintingData, providerId: 'silicon' })
    expect(createDto.modelId).toBeUndefined()

    const updateDto = paintingDataToUpdateDto(paintingData)
    expect(updateDto.modelId).toBeUndefined()
  })

  it('translates a PaintingData into an UpdatePaintingDto', async () => {
    const paintingDataList = await recordsToPaintingDataList([record])
    const paintingData = paintingDataList[0]

    expect(paintingDataToUpdateDto(paintingData)).toEqual({
      providerId: 'silicon',
      modelId: 'model-1',
      prompt: 'draw a cat',
      files: {
        output: ['file-1'],
        input: ['input-file-1']
      }
    })
  })
})
