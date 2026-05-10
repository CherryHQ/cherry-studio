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
    mediaType: 'video',
    modelId: 'silicon::model-1',
    prompt: 'draw a cat',
    params: {
      guidanceScale: 4.5,
      negativePrompt: 'low quality',
      runtimeProviderId: 'old-provider',
      taskId: 'task-1',
      taskStatus: 'processing',
      generationStatus: 'running',
      generationTaskId: 'task-top-level',
      generationError: null,
      generationProgress: 32
    },
    files: {
      output: ['file-1', 'missing-file'],
      input: ['input-file-1', 'missing-input-file']
    },
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    mockGetFile.mockReset()
    mockGetFile.mockImplementation(async (id: string) => {
      if (id === 'file-1' || id === 'input-file-1') {
        return { ...file, id, name: `${id}.png` }
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
      mode: 'generate',
      mediaType: 'video',
      prompt: 'draw a cat',
      files: [{ ...file, name: 'file-1.png' }],
      inputFiles: [{ ...file, id: 'input-file-1', name: 'input-file-1.png' }],
      persistedAt: '2026-01-01T00:00:00.000Z',
      generationStatus: 'running',
      generationTaskId: 'task-top-level',
      generationError: null,
      generationProgress: 32,
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
      modelId: 'model-1',
      mode: 'generate',
      mediaType: 'video',
      prompt: 'draw a cat',
      params: {
        guidanceScale: 4.5,
        negativePrompt: 'low quality'
      },
      files: {
        output: ['file-1'],
        input: ['input-file-1']
      }
    })

    expect(paintingDataToCreateDto({ ...paintingData, mediaType: undefined }).mediaType).toBe('image')
  })

  it('should handle modelId: null — model resolves to undefined and round-trips as absent modelId', async () => {
    const nullModelRecord: PaintingRecord = {
      ...record,
      id: 'painting-null-model',
      modelId: null,
      params: {}
    }

    const paintingData = await recordToPaintingData(nullModelRecord)
    expect(paintingData.model).toBeUndefined()

    const createDto = paintingDataToCreateDto({ ...paintingData, providerId: 'silicon', mode: 'generate' })
    expect(createDto.modelId).toBeUndefined()

    const updateDto = paintingDataToUpdateDto(paintingData)
    expect(updateDto.modelId).toBeUndefined()
  })

  it('should strip reserved keys from DTO params and update DTO', async () => {
    const paintingDataList = await recordsToPaintingDataList([record])
    const paintingData = paintingDataList[0]

    expect(paintingDataToUpdateDto(paintingData)).toEqual({
      providerId: 'silicon',
      mode: 'generate',
      mediaType: 'video',
      modelId: 'model-1',
      prompt: 'draw a cat',
      params: {
        guidanceScale: 4.5,
        negativePrompt: 'low quality'
      },
      files: {
        output: ['file-1'],
        input: ['input-file-1']
      }
    })
  })
})
