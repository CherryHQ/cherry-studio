import * as XLSX from '@e965/xlsx'
import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiUsageRecordListResponse } from '@shared/data/api/schemas/aiUsageRecords'
import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'

import { displayModelId } from '../usageAnalytics'
import {
  buildUsageExportFileStem,
  buildUsageWorkbookBytes,
  fetchAllUsageEntries,
  mapUsageRecordRow,
  USAGE_EXPORT_COLUMN_IDS,
  type UsageExportContext,
  type UsageRecordExportQuery,
  type UsageRecordExportResolvers,
  type UsageWorkbookLabels
} from '../usageExport'

const query: UsageRecordExportQuery = { from: 1, to: 1000, sortBy: 'createdAt', sortOrder: 'desc' }
const context: UsageExportContext = {
  windowKey: '30d',
  query,
  timezone: 'America/Los_Angeles',
  locale: 'zh-CN',
  exportedAt: '2026-11-09T12:34:56.000Z',
  display: {
    persistedCurrency: null,
    costCurrency: null,
    groupBy: 'provider',
    chartMetric: 'tokens',
    chartType: 'bar',
    rollup: 'total',
    topCount: 10,
    heatmapMetric: 'requests'
  }
}
const resolve: UsageRecordExportResolvers = {
  providerName: (id, snapshot) => snapshot || id,
  modalityLabel: () => '语言',
  modelDisplay: displayModelId,
  sourceLabel: (entry) => (entry.sourceId ? entry.sourceName || entry.sourceId : '语言')
}
function record(id: number, values: Partial<AiUsageRecordEntry> = {}): AiUsageRecordEntry {
  return {
    id: `record-${id}`,
    requestId: `request-${id}`,
    recordKind: 'invocation',
    requestCount: 1,
    messageKind: null,
    messageId: null,
    providerId: 'provider-1',
    providerName: '提供商 &<>',
    sourceType: 'assistant',
    sourceId: 'assistant-1',
    sourceName: '来源 &<>',
    sourceIcon: null,
    modelId: 'provider::model-1',
    modelName: '=1+1',
    modality: 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    noCacheTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    imageCount: null,
    cost: null,
    costCurrency: null,
    costSource: null,
    costBreakdown: null,
    pricingSnapshot: null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    createdAt: '2026-11-09T01:02:03.000Z',
    ...values
  }
}
function page(items: AiUsageRecordEntry[], total: number, nextCursor?: string): AiUsageRecordListResponse {
  return { items, total, nextCursor }
}
const labels: UsageWorkbookLabels = {
  usageSheetName: 'Usage',
  metadataSheetName: 'Metadata',
  columns: USAGE_EXPORT_COLUMN_IDS.map((id) => `列 ${id}`),
  metadata: [
    { label: '报告周期', value: '30d / 30 天' },
    { label: 'From', value: '1 / 1970-01-01T00:00:00.001Z (inclusive)' },
    { label: 'To', value: '1000 / 1970-01-01T00:00:01.000Z (inclusive)' },
    { label: '时区', value: context.timezone },
    { label: '导出时间', value: context.exportedAt },
    { label: '报告语言', value: context.locale },
    { label: '视图设置', value: JSON.stringify(context.display) },
    { label: '明细排序', value: 'createdAt / desc' },
    { label: '实际记录查询', value: JSON.stringify(query) },
    { label: '导出记录数', value: '2 / 2' },
    { label: '数值说明', value: 'Unknown values are blank. Large integers are text.' }
  ]
}

describe('usage export pagination', () => {
  beforeEach(() => {
    mockDataApiService.get.mockReset()
  })

  it.each([201, 401])('exports all %s rows serially without changing the query or order', async (count) => {
    const entries = Array.from({ length: count }, (_, i) => record(i))
    const releases: Array<() => void> = []
    mockDataApiService.get.mockImplementation(async (_path, options) => {
      const start = Number(options?.query.cursor ?? 0)
      await new Promise<void>((release) => releases.push(release))
      return page(entries.slice(start, start + 200), count, start + 200 < count ? String(start + 200) : undefined)
    })
    const progress = vi.fn()
    const result = fetchAllUsageEntries(query, () => {}, progress)
    expect(mockDataApiService.get.mock.calls).toHaveLength(1)
    for (let i = 0; i < Math.ceil(count / 200); i++) {
      expect(releases).toHaveLength(i + 1)
      releases[i]()
      await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(i + 1))
    }
    expect(await result).toEqual({ entries, total: count })
    expect(progress.mock.calls).toEqual(
      count === 201
        ? [
            [200, 201],
            [201, 201]
          ]
        : [
            [200, 401],
            [400, 401],
            [401, 401]
          ]
    )
    for (const [index, [path, options]] of mockDataApiService.get.mock.calls.entries()) {
      expect(path).toBe('/ai-usage-records')
      expect(options?.query).toEqual({ ...query, limit: 200, ...(index ? { cursor: String(index * 200) } : {}) })
      expect(options?.query).not.toHaveProperty('costCurrency')
    }
  })

  it('retains the effective currency only for cost sorting and accepts an empty result', async () => {
    mockDataApiService.get.mockResolvedValue(page([], 0))
    const costQuery = { from: 1, to: 2, sortBy: 'cost', sortOrder: 'asc', costCurrency: 'CNY' } as const
    expect(await fetchAllUsageEntries(costQuery, () => {})).toEqual({ entries: [], total: 0 })
    expect(mockDataApiService.get.mock.calls[0][1]?.query).toEqual({ ...costQuery, limit: 200 })
  })

  it.each([
    ['total changed', [page([record(1)], 2, 'a'), page([record(2)], 3)], 'DATA_CHANGED'],
    ['duplicate ID', [page([record(1)], 2, 'a'), page([record(1)], 2)], 'INVALID_PAGINATION'],
    ['duplicate cursor', [page([record(1)], 3, 'a'), page([record(2)], 3, 'a')], 'INVALID_PAGINATION'],
    ['empty page with cursor', [page([], 2, 'a')], 'INVALID_PAGINATION'],
    ['total reached with cursor', [page([record(1)], 1, 'a')], 'INVALID_PAGINATION'],
    ['too few rows at end', [page([record(1)], 2)], 'DATA_CHANGED'],
    ['too many rows at end', [page([record(1), record(2)], 1)], 'DATA_CHANGED'],
    ['Excel limit exceeded', [page([], 1_048_576)], 'LIMIT_EXCEEDED'],
    ...[NaN, Infinity, -1, 1.5].map(
      (total) => [`invalid total ${total}`, [page([], total)], 'INVALID_PAGINATION'] as const
    )
  ] as const)('rejects %s without returning partial data', async (_name, pages, code) => {
    for (const response of pages) mockDataApiService.get.mockResolvedValueOnce(response)
    const success = vi.fn()
    await expect(fetchAllUsageEntries(query, () => {}).then(success)).rejects.toMatchObject({
      name: 'UsageExportError',
      code
    })
    expect(success).not.toHaveBeenCalled()
  })

  it('propagates a second-page transport error unchanged, without retry or partial success', async () => {
    const error = new Error('transport failed')
    mockDataApiService.get.mockResolvedValueOnce(page([record(1)], 2, 'a')).mockRejectedValueOnce(error)
    const success = vi.fn()
    await expect(fetchAllUsageEntries(query, () => {}).then(success)).rejects.toBe(error)
    expect(success).not.toHaveBeenCalled()
    expect(mockDataApiService.get.mock.calls).toHaveLength(2)
  })

  it.each([1, 2, 3, 4])('wraps invalidation at checkpoint %s as ABORTED with its cause', async (checkpoint) => {
    const cause = new Error('unmounted')
    const assertValid = vi.fn(() => {
      if (assertValid.mock.calls.length === checkpoint) throw cause
    })
    mockDataApiService.get.mockResolvedValueOnce(page([record(1)], 2, 'a')).mockResolvedValueOnce(page([record(2)], 2))
    const success = vi.fn()
    await expect(fetchAllUsageEntries(query, assertValid).then(success)).rejects.toMatchObject({
      code: 'ABORTED',
      cause
    })
    expect(success).not.toHaveBeenCalled()
  })
})

describe('usage workbook data contract', () => {
  it('maps all scalar fields into their documented column positions', () => {
    const entry = record(1, {
      requestCount: 2,
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 3,
      noCacheTokens: 4,
      cacheReadTokens: 5,
      cacheWriteTokens: 6,
      imageCount: 7,
      timeFirstTokenMs: 100,
      timeCompletionMs: 2100,
      timeThinkingMs: 8,
      cost: 0.125,
      costCurrency: 'CNY',
      costSource: 'computed',
      apiKeyId: 'key-1',
      apiKeyLabel: 'Primary',
      apiKeyMasked: 'sk-****0001',
      apiKeyAttribution: 'explicit'
    })
    expect(mapUsageRecordRow(entry, resolve)).toEqual([
      '=1+1',
      '提供商 &<>',
      '来源 &<>',
      '2026-11-09T01:02:03.000Z',
      30,
      0.125,
      'CNY',
      100,
      10,
      'record-1',
      'invocation',
      2,
      'provider-1',
      'provider::model-1',
      'assistant',
      'assistant-1',
      'language',
      10,
      20,
      3,
      4,
      5,
      6,
      7,
      2100,
      8,
      'computed',
      'key-1',
      'Primary',
      'sk-****0001',
      'explicit',
      undefined
    ])
  })

  it('round-trips 32 scalar columns, numeric precision, blanks, literal strings and ordered metadata', async () => {
    const entries = Object.freeze([
      Object.freeze(
        record(1, {
          totalTokens: 999_999_999_999_999,
          cost: 0.000000123,
          costCurrency: 'USD',
          timeFirstTokenMs: 0,
          timeCompletionMs: 2000,
          outputTokens: 10,
          requestCount: 0
        })
      ),
      Object.freeze(
        record(2, {
          totalTokens: 1_000_000_000_000_001,
          inputTokens: 1_000_000_000_000_001,
          requestCount: 1_000_000_000_000_002,
          timeThinkingMs: 1_000_000_000_000_003,
          cost: 0
        })
      )
    ])
    const original = structuredClone({ entries, labels, context })
    const bytes = await buildUsageWorkbookBytes(entries, context, labels, resolve)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const workbook = XLSX.read(bytes, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['Usage', 'Metadata'])
    const usage = workbook.Sheets.Usage
    expect(usage['!ref']).toBe('A1:AF3')
    expect(XLSX.utils.sheet_to_json(usage, { header: 1 })[0]).toEqual(
      [
        'model',
        'provider',
        'source',
        'createdAt',
        'totalTokens',
        'cost',
        'costCurrency',
        'timeFirstTokenMs',
        'tokensPerSecond',
        'recordId',
        'recordKind',
        'requestCount',
        'providerId',
        'modelId',
        'sourceType',
        'sourceId',
        'modality',
        'inputTokens',
        'outputTokens',
        'reasoningTokens',
        'noCacheTokens',
        'cacheReadTokens',
        'cacheWriteTokens',
        'imageCount',
        'timeCompletionMs',
        'timeThinkingMs',
        'costSource',
        'apiKeyId',
        'apiKeyLabel',
        'apiKeyMasked',
        'apiKeyAttribution',
        'authMethod'
      ].map((id) => `列 ${id}`)
    )
    for (const [cell, value, type] of [
      ['A2', '=1+1', 's'],
      ['B2', '提供商 &<>', 's'],
      ['C2', '来源 &<>', 's'],
      ['D2', '2026-11-09T01:02:03.000Z', 's'],
      ['E2', 999_999_999_999_999, 'n'],
      ['F2', 0.000000123, 'n'],
      ['H2', 0, 'n'],
      ['I2', 5, 'n'],
      ['L2', 0, 'n'],
      ['N2', 'provider::model-1', 's'],
      ['E3', '1000000000000001', 's'],
      ['F3', 0, 'n'],
      ['R3', '1000000000000001', 's'],
      ['L3', '1000000000000002', 's'],
      ['Z3', '1000000000000003', 's']
    ])
      expect(usage[cell]).toMatchObject({ v: value, t: type })
    expect(usage.A2.f).toBeUndefined()
    expect(usage.R2).toBeUndefined()
    expect(usage.AF2).toBeUndefined()
    expect(workbook.Sheets.Metadata['!ref']).toBe('A1:B11')
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Metadata, { header: 1 })).toEqual(
      labels.metadata.map(({ label, value }) => [label, value])
    )
    const second = XLSX.read(await buildUsageWorkbookBytes(entries, context, labels, resolve), { type: 'array' })
    expect(second.Sheets).toEqual(workbook.Sheets)
    expect({ entries, labels, context }).toEqual(original)
  })

  it('adds fallback token counts exactly before writing text and leaves wholly unknown values blank', async () => {
    const entries = [
      record(1),
      record(2, { inputTokens: 0 }),
      record(3, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER - 1 })
    ]
    const usage = XLSX.read(await buildUsageWorkbookBytes(entries, context, labels, resolve), { type: 'array' }).Sheets
      .Usage
    expect(usage.E2).toBeUndefined()
    expect(usage.F2).toBeUndefined()
    expect(usage.E3).toMatchObject({ v: 0, t: 'n' })
    expect(usage.E4).toMatchObject({ v: '18014398509481981', t: 's' })
    const unknown = mapUsageRecordRow(record(1, { cost: undefined as unknown as null }), resolve)
    expect(unknown[5]).toBeUndefined()
    expect(unknown[8]).toBeUndefined()
    expect(mapUsageRecordRow(record(1, { modelName: null, sourceId: null }), resolve).slice(0, 3)).toEqual([
      'model-1',
      '提供商 &<>',
      '语言'
    ])
  })

  it('keeps headers for an empty workbook and uses the supplied optional metadata header', async () => {
    const emptyLabels = { ...labels, metadata: [{ label: '记录数', value: '0 / 0' }], numberPolicyHeader: '元信息' }
    const workbook = XLSX.read(await buildUsageWorkbookBytes([], context, emptyLabels, resolve), { type: 'array' })
    expect(workbook.Sheets.Usage['!ref']).toBe('A1:AF1')
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Metadata, { header: 1 })).toEqual([
      ['元信息', ''],
      ['记录数', '0 / 0']
    ])
    await expect(buildUsageWorkbookBytes([], context, { ...labels, columns: ['bad'] }, resolve)).rejects.toThrow('32')
  })

  it('uses frozen local calendar days and cleans only the filename stem', () => {
    const range = { from: new Date(2026, 10, 8, 23, 59, 59).getTime(), to: new Date(2026, 10, 9, 0, 0, 1).getTime() }
    const date = new Date(2026, 10, 10, 1, 2, 3)
    expect(buildUsageExportFileStem(context, range, date)).toBe('usage_30d_2026-11-08_2026-11-09_20261110-010203')
    const invalid = { ...context, windowKey: '30d/?:.x' as UsageExportContext['windowKey'] }
    const stem = buildUsageExportFileStem(invalid, range, date)
    expect(stem).toBe('usage_30d____x_2026-11-08_2026-11-09_20261110-010203')
    expect(stem + '.xlsx').toMatch(/[^.]\.xlsx$/)
    expect(stem).not.toMatch(/_xlsx|\.xlsx|[<>:"/\\|?*.]/)
  })

  it('uses local date getters when the local calendar day differs from UTC', () => {
    const from = Date.parse('2026-11-09T07:59:59Z')
    const to = Date.parse('2026-11-09T08:00:01Z')
    const exportedAt = new Date('2026-11-10T07:02:03Z')
    const shifted = (date: Date) => new Date(date.getTime() - 8 * 60 * 60 * 1000)
    const spies = [
      vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(function (this: Date) {
        return shifted(this).getUTCFullYear()
      }),
      vi.spyOn(Date.prototype, 'getMonth').mockImplementation(function (this: Date) {
        return shifted(this).getUTCMonth()
      }),
      vi.spyOn(Date.prototype, 'getDate').mockImplementation(function (this: Date) {
        return shifted(this).getUTCDate()
      }),
      vi.spyOn(Date.prototype, 'getHours').mockImplementation(function (this: Date) {
        return shifted(this).getUTCHours()
      }),
      vi.spyOn(Date.prototype, 'getMinutes').mockImplementation(function (this: Date) {
        return shifted(this).getUTCMinutes()
      }),
      vi.spyOn(Date.prototype, 'getSeconds').mockImplementation(function (this: Date) {
        return shifted(this).getUTCSeconds()
      })
    ]
    try {
      expect(buildUsageExportFileStem(context, { from, to }, exportedAt)).toBe(
        'usage_30d_2026-11-08_2026-11-09_20261109-230203'
      )
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
