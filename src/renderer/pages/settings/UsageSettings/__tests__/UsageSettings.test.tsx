import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import UsageSettings from '../UsageSettings'

const usageDataOverride = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.unmock('@data/hooks/useCache')

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/components/Chart', () => ({
  Chart: () => null
}))

vi.mock('../UsageEntriesTable', () => ({
  UsageEntriesTable: () => null
}))

vi.mock('../useUsageData', () => {
  const totals = {
    costCurrency: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalNoCacheTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    recordCount: 0,
    requestCount: 0,
    estimatedRequestCount: 0,
    unpricedRequestCount: 0
  }

  return {
    useUsageData: () => ({
      costTotals: [],
      costCurrency: undefined,
      timelineBuckets: [],
      overviewBuckets: [],
      exploreBuckets: [],
      exploreTimelineRows: [],
      overviewTotals: totals,
      previousOverviewTotals: totals,
      exploreTotals: totals,
      exploreOther: totals,
      timelineLoading: false,
      overviewLoading: false,
      exploreStatsLoading: false,
      exploreTimelineLoading: false,
      ...usageDataOverride.current
    }),
    useUsageEntriesData: () => ({
      entries: [],
      total: 0,
      isLoading: false,
      isRefreshing: false,
      hasNext: false,
      loadNext: vi.fn()
    })
  }
})

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('UsageSettings', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    usageDataOverride.current = {}
  })

  it('starts on the documented defaults', () => {
    render(<UsageSettings />)

    expect(screen.getByRole('radio', { name: '最近 30 天' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('供应商')
    expect(screen.getByRole('combobox', { name: '指标' })).toHaveTextContent('Token')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('10')
    expect(screen.getByRole('button', { name: '柱状图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '按天' })).toHaveAttribute('aria-checked', 'true')
  })

  it('restores the view selections after leaving and returning to the page', async () => {
    const user = userEvent.setup()
    const first = render(<UsageSettings />)

    await user.click(screen.getByRole('radio', { name: '最近 90 天' }))
    await user.click(screen.getByRole('combobox', { name: '分组' }))
    await user.click(await screen.findByRole('option', { name: '模型' }))
    await user.click(screen.getByRole('button', { name: '饼图' }))
    await user.click(screen.getByRole('radio', { name: '总计' }))
    await user.click(screen.getByRole('combobox', { name: 'Top' }))
    await user.click(await screen.findByRole('option', { name: '20' }))

    first.unmount()
    render(<UsageSettings />)

    expect(screen.getByRole('radio', { name: '最近 90 天' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('模型')
    expect(screen.getByRole('button', { name: '饼图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '总计' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('20')
  })

  it('caps the dashboard column so ultrawide windows do not stretch charts', () => {
    render(<UsageSettings />)

    const overview = screen.getByRole('heading', { name: '概览' })
    const column = overview.closest('.mx-auto')

    // Layout contract: the usage dashboard is bounded (`max-w-6xl`), not full-bleed (`max-w-none`).
    expect(column).toHaveClass('max-w-6xl')
    expect(column).not.toHaveClass('max-w-none')
  })

  it('keeps the overview insight row when usage data exists', () => {
    usageDataOverride.current = {
      overviewTotals: {
        totalCost: 0,
        totalTokens: 100,
        totalNoCacheTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        requestCount: 1
      }
    }

    render(<UsageSettings />)

    expect(screen.getByText('活跃天数')).toBeInTheDocument()
    expect(screen.getByText('高峰日')).toBeInTheDocument()
    expect(screen.getByText('用量最高模型')).toBeInTheDocument()
    expect(screen.getByText('日均')).toBeInTheDocument()
  })

  it('shows the full total including Other and preserves the trend chart when returning from Total', async () => {
    const user = userEvent.setup()
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, totalTokens: 2400, requestCount: 12 },
      exploreTotals: { ...EMPTY_STATS_METRICS, totalTokens: 2400, requestCount: 12 },
      exploreBuckets: [
        {
          ...EMPTY_STATS_METRICS,
          groupBy: 'provider',
          providerId: 'openai',
          providerName: 'OpenAI',
          totalTokens: 1800,
          requestCount: 8
        }
      ],
      exploreOther: { ...EMPTY_STATS_METRICS, totalTokens: 600, requestCount: 4 }
    }
    render(<UsageSettings />)

    await user.click(screen.getByRole('button', { name: '折线图' }))
    await user.click(screen.getByRole('radio', { name: '总计' }))

    expect(screen.getByText('总计 · Token')).toBeInTheDocument()
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('2400')
    expect(screen.getByRole('button', { name: '折线图' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '柱状图' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('combobox', { name: '指标' }))
    await user.click(await screen.findByRole('option', { name: '请求数' }))
    expect(screen.getByText('总计 · 请求数')).toBeInTheDocument()
    expect(screen.getByLabelText('总计 · 请求数')).toHaveTextContent('12')

    await user.click(screen.getByRole('radio', { name: '按周' }))
    expect(screen.getByRole('button', { name: '折线图' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '折线图' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('waits for aggregate data before showing a zero total', () => {
    MockCacheUtils.setInitialState({ persist: [['settings.usage.rollup', 'total']] })
    usageDataOverride.current = { exploreStatsLoading: true }
    const view = render(<UsageSettings />)
    expect(screen.queryByLabelText('总计 · Token')).not.toBeInTheDocument()

    usageDataOverride.current = { exploreStatsLoading: false }
    view.rerender(<UsageSettings />)
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('0')
  })
  it('does not report a zero total when aggregate loading fails, and recovers to a real zero', () => {
    MockCacheUtils.setInitialState({ persist: [['settings.usage.rollup', 'total']] })
    usageDataOverride.current = { exploreStatsError: new Error('Stats unavailable') }
    const view = render(<UsageSettings />)

    expect(screen.queryByLabelText('总计 · Token')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    usageDataOverride.current = {}
    view.rerender(<UsageSettings />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('0')
  })
  it.each(['loading', 'error'])('does not show a numeric analysis summary while %s', (state) => {
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, requestCount: 1 },
      exploreStatsLoading: state === 'loading',
      exploreStatsError: state === 'error' ? new Error('Unavailable') : undefined
    }
    render(<UsageSettings />)
    const header = screen.getByText('分析').parentElement!
    expect(header).not.toHaveTextContent('· 0')
  })

  it('uses the aggregate response currency for the Total amount and analysis summary', () => {
    MockCacheUtils.setInitialState({
      persist: [
        ['settings.usage.rollup', 'total'],
        ['settings.usage.chart_metric', 'cost']
      ]
    })
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, requestCount: 1 },
      costCurrency: 'USD',
      exploreTotals: { ...EMPTY_STATS_METRICS, totalCost: 12, costCurrency: 'CNY' }
    }
    render(<UsageSettings />)
    expect(screen.getByLabelText('总计 · 成本')).toHaveTextContent('¥12.00')
    expect(screen.getByText('分析').parentElement!).toHaveTextContent('¥12.00')
  })

  it('shows usage analytics without the personal profile editor', () => {
    render(<UsageSettings />)
    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '头像' })).not.toBeInTheDocument()
  })
})

import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'

const usageExportMocks = vi.hoisted(() => ({ capture: vi.fn(), saveImage: vi.fn(), save: vi.fn() }))
vi.mock('@renderer/services/ExportService', () => ({
  exportService: { captureScrollableAsDataUrl: usageExportMocks.capture }
}))

function exportRecord(index: number): AiUsageRecordEntry {
  return {
    id: `export-${index}`,
    requestId: `request-${index}`,
    recordKind: 'invocation',
    requestCount: 1,
    messageKind: null,
    messageId: null,
    providerId: 'provider',
    providerName: 'Provider',
    sourceType: null,
    sourceId: null,
    sourceName: null,
    sourceIcon: null,
    modelId: 'model',
    modelName: 'Model',
    modality: 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    reasoningTokens: null,
    noCacheTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    imageCount: null,
    cost: 0,
    costCurrency: 'USD',
    costSource: null,
    costBreakdown: null,
    pricingSnapshot: null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    createdAt: '2026-11-09T00:00:00.000Z'
  }
}

async function selectUsageExport(format: 'PNG' | 'XLSX') {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '导出', exact: true }))
  await user.click(await screen.findByRole('menuitem', { name: `导出为 ${format}`, exact: true }))
}

describe('UsageSettings export', () => {
  beforeEach(async () => {
    MockCacheUtils.resetMocks()
    usageDataOverride.current = { aggregateReady: true, aggregateError: false }
    const hooks = await import('../useUsageData')
    vi.spyOn(hooks, 'useUsageEntriesData').mockReturnValue({
      entries: [],
      total: 0,
      isLoading: false,
      isRefreshing: false,
      entriesReady: true,
      entriesError: false,
      hasNext: false,
      loadNext: vi.fn()
    })
    usageExportMocks.capture.mockReset().mockResolvedValue('data:image/png;base64,aW1hZ2U=')
    usageExportMocks.saveImage.mockReset().mockResolvedValue(true)
    usageExportMocks.save.mockReset().mockResolvedValue('/tmp/usage.xlsx')
    Object.assign(window.api.file, { saveImage: usageExportMocks.saveImage, save: usageExportMocks.save })
    const { mockDataApiService } = await import('@test-mocks/renderer/DataApiService')
    mockDataApiService.get.mockReset().mockResolvedValue({ items: [], total: 0 })
  })

  it('captures the usage root and saves PNG with one extension and a success notice', async () => {
    const { waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    const view = render(<UsageSettings />)
    await selectUsageExport('PNG')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('用量导出成功'))
    expect(usageExportMocks.capture.mock.calls[0][0].current).toBe(
      view.container.querySelector('[data-usage-export-root]')
    )
    expect(usageExportMocks.saveImage).toHaveBeenCalledWith(
      expect.stringMatching(/^usage_30d_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{8}-\d{6}$/),
      'data:image/png;base64,aW1hZ2U='
    )
  })

  it('reports an unsaved PNG neutrally', async () => {
    const { waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    usageExportMocks.saveImage.mockResolvedValue(false)
    render(<UsageSettings />)
    await selectUsageExport('PNG')
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('图片未保存'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a rejected PNG save and restores the export button', async () => {
    const { waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    usageExportMocks.saveImage.mockRejectedValue(new Error('Save failed'))
    render(<UsageSettings />)
    await selectUsageExport('PNG')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith({ title: '无法导出用量', description: '无法生成用量图片' })
    )
    expect(screen.getByRole('button', { name: '导出', exact: true })).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('saves all 201 records from two pages as a readable XLSX with ordered metadata', async () => {
    const { act, waitFor } = await import('@testing-library/react')
    const { mockDataApiService } = await import('@test-mocks/renderer/DataApiService')
    const XLSX = await import('@e965/xlsx')
    const secondPage = Promise.withResolvers<{ items: AiUsageRecordEntry[]; total: number }>()
    mockDataApiService.get
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => exportRecord(i)),
        total: 201,
        nextCursor: 'page-2'
      })
      .mockReturnValueOnce(secondPage.promise)
    render(<UsageSettings />)
    await selectUsageExport('XLSX')
    expect(await screen.findByText('正在读取用量记录（200 / 201）…')).toHaveAttribute('aria-live', 'polite')
    expect(usageExportMocks.save).not.toHaveBeenCalled()
    await act(async () => secondPage.resolve({ items: [exportRecord(200)], total: 201 }))
    await waitFor(() => expect(usageExportMocks.save).toHaveBeenCalledTimes(1))
    const [filename, bytes, options] = usageExportMocks.save.mock.calls[0]
    expect(filename).toMatch(/^usage_30d_.*\.xlsx$/)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(options.filters[0].extensions).toEqual(['xlsx'])
    const workbook = XLSX.read(bytes, { type: 'array' })
    expect(workbook.SheetNames).toEqual(['Usage', 'Metadata'])
    expect(workbook.Sheets.Usage['!ref']).toBe('A1:AF202')
    expect(workbook.Sheets.Usage.J2.v).toBe('export-0')
    expect(workbook.Sheets.Usage.J202.v).toBe('export-200')
    expect(workbook.Sheets.Usage.F2).toMatchObject({ v: 0, t: 'n' })
    expect(workbook.Sheets.Metadata['!ref']).toBe('A1:B11')
    expect(workbook.Sheets.Metadata.B10.v).toBe('201 / 201')
    const query = JSON.parse(workbook.Sheets.Metadata.B9.v)
    expect(query).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc' })
    expect(query).not.toHaveProperty('costCurrency')
    expect(mockDataApiService.get.mock.calls[1][1].query).toEqual({ ...query, limit: 200, cursor: 'page-2' })
  })

  it('does not save a partial workbook when the second page fails', async () => {
    const { waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    const { mockDataApiService } = await import('@test-mocks/renderer/DataApiService')
    mockDataApiService.get
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, i) => exportRecord(i)),
        total: 201,
        nextCursor: 'page-2'
      })
      .mockRejectedValueOnce(new Error('Second page failed'))
    render(<UsageSettings />)
    await selectUsageExport('XLSX')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith({ title: '无法导出用量', description: '无法导出用量' })
    )
    expect(usageExportMocks.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导出', exact: true })).toBeEnabled()
  })

  it('disables repeated export while a capture is in flight', async () => {
    const { act, waitFor } = await import('@testing-library/react')
    const pending = Promise.withResolvers<string>()
    usageExportMocks.capture.mockReturnValue(pending.promise)
    render(<UsageSettings />)
    await selectUsageExport('PNG')
    const trigger = screen.getByRole('button', { name: '导出', exact: true })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('正在导出…')
    await userEvent.click(trigger)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    await act(async () => pending.resolve('data:image/png;base64,aW1hZ2U='))
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(usageExportMocks.capture).toHaveBeenCalledTimes(1)
    expect(usageExportMocks.saveImage).toHaveBeenCalledTimes(1)
  })

  it.each(['aggregate', 'entries'])('rejects PNG while %s data is not ready', async (part) => {
    const { toast } = await import('@renderer/services/toast')
    if (part === 'aggregate') usageDataOverride.current = { aggregateReady: false }
    else {
      const hooks = await import('../useUsageData')
      vi.mocked(hooks.useUsageEntriesData).mockReturnValue({
        entries: [],
        total: 0,
        isLoading: false,
        isRefreshing: true,
        entriesReady: false,
        entriesError: false,
        hasNext: false,
        loadNext: vi.fn()
      })
    }
    render(<UsageSettings />)
    await selectUsageExport('PNG')
    expect(toast.warning).toHaveBeenCalledWith('用量统计仍在加载，请稍后重试。')
    expect(usageExportMocks.capture).not.toHaveBeenCalled()
    expect(usageExportMocks.saveImage).not.toHaveBeenCalled()
  })

  it('ends a cancelled XLSX save without a success or error notice', async () => {
    const { waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    usageExportMocks.save.mockResolvedValue(null)
    render(<UsageSettings />)
    await selectUsageExport('XLSX')
    await waitFor(() => expect(usageExportMocks.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '导出', exact: true })).toBeEnabled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('discards a capture after a window changes and changes back', async () => {
    const { act, waitFor } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    const pending = Promise.withResolvers<string>()
    usageExportMocks.capture.mockReturnValue(pending.promise)
    render(<UsageSettings />)
    await selectUsageExport('PNG')
    await userEvent.click(screen.getByRole('radio', { name: '最近 90 天' }))
    await userEvent.click(screen.getByRole('radio', { name: '最近 30 天' }))
    await act(async () => pending.resolve('data:image/png;base64,aW1hZ2U='))
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('用量统计仍在加载，请稍后重试。'))
    expect(usageExportMocks.saveImage).not.toHaveBeenCalled()
  })

  it('does not open a save dialog or toast after unmount', async () => {
    const { act } = await import('@testing-library/react')
    const { toast } = await import('@renderer/services/toast')
    const pending = Promise.withResolvers<string>()
    usageExportMocks.capture.mockReturnValue(pending.promise)
    const view = render(<UsageSettings />)
    await selectUsageExport('PNG')
    view.unmount()
    await act(async () => pending.resolve('data:image/png;base64,aW1hZ2U='))
    expect(usageExportMocks.saveImage).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })
  it('records the effective cost currency and rendered chart fallback in the frozen workbook', async () => {
    const { waitFor } = await import('@testing-library/react')
    const XLSX = await import('@e965/xlsx')
    MockCacheUtils.setInitialState({
      persist: [
        ['settings.usage.entry_sort_by', 'cost'],
        ['settings.usage.currency', 'CNY'],
        ['settings.usage.chart_type', 'line'],
        ['settings.usage.rollup', 'total'],
        ['settings.usage.heatmap_metric', 'requests']
      ]
    })
    usageDataOverride.current = { aggregateReady: true, aggregateError: false, costCurrency: 'USD' }
    render(<UsageSettings />)
    await selectUsageExport('XLSX')
    await waitFor(() => expect(usageExportMocks.save).toHaveBeenCalledTimes(1))
    const workbook = XLSX.read(usageExportMocks.save.mock.calls[0][1], { type: 'array' })
    expect(JSON.parse(workbook.Sheets.Metadata.B7.v)).toMatchObject({
      persistedCurrency: 'CNY',
      costCurrency: 'USD',
      chartType: 'bar',
      rollup: 'total',
      heatmapMetric: 'requests'
    })
    expect(JSON.parse(workbook.Sheets.Metadata.B9.v)).toMatchObject({ sortBy: 'cost', costCurrency: 'USD' })
    expect(workbook.Sheets.Metadata.B10.v).toBe('0 / 0')
  })
})
