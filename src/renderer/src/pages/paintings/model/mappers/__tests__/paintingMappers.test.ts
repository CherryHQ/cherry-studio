import type { FileMetadata } from '@renderer/types'
import type { Painting as PaintingRecord } from '@shared/data/types/painting'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { paintingDataToCreateDto } from '../paintingDataToCreateDto'
import { paintingDataToUpdateDto } from '../paintingDataToUpdateDto'
import { recordsToPaintingDataList, recordToPaintingData } from '../recordToPaintingData'

const { mockGetFile } = vi.hoisted(() => ({
  mockGetFile: vi.fn()
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    getFile: mockGetFile
  }
}))

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
    mode: 'generate',
    model: 'model-1',
    prompt: 'draw a cat',
    params: {
      guidanceScale: 4.5,
      negativePrompt: 'low quality'
    },
    files: {
      output: ['file-1', 'missing-file'],
      input: []
    },
    parentId: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    mockGetFile.mockReset()
    mockGetFile.mockImplementation(async (id: string) => {
      if (id === 'file-1') {
        return file
      }

      return undefined
    })
  })

  it('should convert PaintingRecord into Canvas with resolved files', async () => {
    const result = await recordToPaintingData(record)

    expect(result).toEqual({
      id: 'painting-1',
      providerId: 'silicon',
      model: 'model-1',
      prompt: 'draw a cat',
      files: [file],
      guidanceScale: 4.5,
      negativePrompt: 'low quality'
    })
  })

  it('should convert multiple records and strip reserved keys from DTO params', async () => {
    const paintingDataList = await recordsToPaintingDataList([record])
    const paintingData = paintingDataList[0]

    expect(paintingDataList).toHaveLength(1)

    expect(
      paintingDataToCreateDto({
        ...paintingData,
        providerId: 'silicon',
        mode: 'generate'
      })
    ).toEqual({
      id: 'painting-1',
      providerId: 'silicon',
      mode: 'generate',
      model: 'model-1',
      prompt: 'draw a cat',
      params: {
        guidanceScale: 4.5,
        negativePrompt: 'low quality'
      },
      files: {
        output: ['file-1'],
        input: []
      }
    })

    expect(paintingDataToUpdateDto(paintingData)).toEqual({
      model: 'model-1',
      prompt: 'draw a cat',
      params: {
        guidanceScale: 4.5,
        negativePrompt: 'low quality'
      },
      files: {
        output: ['file-1'],
        input: []
      }
    })
  })
})
