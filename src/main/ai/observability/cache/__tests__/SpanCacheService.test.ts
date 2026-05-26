import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpanCacheService } from '../SpanCacheService'

function span(overrides: Partial<SpanEntity>): SpanEntity {
  return {
    id: 'span',
    name: 'span',
    parentId: '',
    traceId: 'trace',
    status: 'OK',
    kind: 'internal',
    attributes: undefined,
    isEnd: true,
    events: undefined,
    startTime: 1,
    endTime: 2,
    links: undefined,
    ...overrides
  }
}

describe('SpanCacheService', () => {
  let service: SpanCacheService
  let traceDir: string

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    traceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'span-cache-service-'))
    vi.mocked(application.getPath).mockReset()
    vi.mocked(application.getPath).mockReturnValue(traceDir)
    mockMainLoggerService.error.mockClear()
    service = new SpanCacheService()
  })

  afterEach(async () => {
    await fs.rm(traceDir, { recursive: true, force: true })
  })

  it('activates without touching the trace path', async () => {
    await service._doInit()

    expect(service.isActivated).toBe(true)
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('keeps live spans in memory and reads them without touching the trace path', async () => {
    await service._doInit()
    service.setTopicId('trace-a', 'topic-a')
    service.saveEntity(span({ id: 'root', traceId: 'trace-a', modelName: undefined }))
    service.saveEntity(span({ id: 'model-a', traceId: 'trace-a', modelName: 'model-a' }))
    service.saveEntity(span({ id: 'model-b', traceId: 'trace-a', modelName: 'model-b' }))

    const spans = await service.getSpans('topic-a', 'trace-a', 'model-a')

    expect(spans.map((item) => item.id)).toEqual(['root', 'model-a'])
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('lazily reads historical trace data when memory has no matching trace', async () => {
    await service._doInit()
    const topicDir = path.join(traceDir, 'topic-a')
    await fs.mkdir(topicDir, { recursive: true })
    await fs.writeFile(
      path.join(topicDir, 'trace-a'),
      `${JSON.stringify(span({ id: 'history', topicId: 'topic-a', traceId: 'trace-a', modelName: 'model-a' }))}\n`
    )

    const spans = await service.getSpans('topic-a', 'trace-a', 'model-a')

    expect(spans.map((item) => item.id)).toEqual(['history'])
    expect(application.getPath).toHaveBeenCalledWith('feature.trace')
  })

  it('returns an empty list for missing history without logging an error', async () => {
    await service._doInit()

    await expect(service.getSpans('topic-a', 'missing-trace')).resolves.toEqual([])
    expect(mockMainLoggerService.error).not.toHaveBeenCalled()
  })
})
