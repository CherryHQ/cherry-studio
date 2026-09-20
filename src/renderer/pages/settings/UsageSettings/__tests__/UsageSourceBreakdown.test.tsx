// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiUsageRecordStatsMetrics, AiUsageRecordStatsResponse } from '@shared/data/api/schemas/aiUsageRecords'

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  Table: (props: TableHTMLAttributes<HTMLTableElement>) => <table {...props} />,
  TableBody: (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />,
  TableCell: (props: TdHTMLAttributes<HTMLTableCellElement>) => <td {...props} />,
  TableHead: (props: HTMLAttributes<HTMLTableCellElement>) => <th {...props} />,
  TableHeader: (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />,
  TableRow: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />
}))

vi.mock('../UsageSettingsPrimitives', () => ({
  UsagePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  UsageSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  UsageSectionTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  UsageSourceLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

import { UsageSourceBreakdown } from '../UsageSourceBreakdown'

const STATS_PATH = '/ai-usage-records/stats'
const originalLanguage = i18n.language

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

function metrics(overrides: Partial<AiUsageRecordStatsMetrics> = {}): AiUsageRecordStatsMetrics {
  return {
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
    unpricedRequestCount: 0,
    ...overrides
  }
}

function mockStats(response: AiUsageRecordStatsResponse) {
  MockUseDataApiUtils.mockQueryResult(STATS_PATH, { data: response })
}

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 2, 15, 10, 30, 0))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('UsageSourceBreakdown', () => {
  it('shows an empty state when nothing was recorded yet today', () => {
    mockStats({ buckets: [], totals: metrics(), other: metrics() })

    render(<UsageSourceBreakdown />)

    expect(screen.getByTestId('empty-state')).toHaveTextContent('No requests recorded yet today')
  })

  it("breaks today's requests down by source, and labels a sourceless bucket as unattributed", () => {
    mockStats({
      buckets: [
        {
          groupBy: 'source',
          sourceType: 'agent',
          sourceId: 'agent-1',
          sourceName: 'Refactor bot',
          sourceIcon: null,
          ...metrics({ requestCount: 60, totalTokens: 900 })
        },
        {
          groupBy: 'source',
          sourceType: null,
          sourceId: null,
          sourceName: null,
          sourceIcon: null,
          ...metrics({ requestCount: 15, totalTokens: 400 })
        }
      ],
      totals: metrics({ requestCount: 75, totalTokens: 1300 }),
      other: metrics()
    })

    render(<UsageSourceBreakdown />)

    const agentRow = screen.getByText('Refactor bot').closest('tr')
    expect(agentRow).not.toBeNull()
    expect(agentRow).toHaveTextContent('60')
    expect(agentRow).toHaveTextContent('900')

    const unattributedRow = screen.getByText('Unattributed source').closest('tr')
    expect(unattributedRow).not.toBeNull()
    expect(unattributedRow).toHaveTextContent('15')
  })

  it('rolls whatever the server could not fit into the top sources into an Other row', () => {
    mockStats({
      buckets: [
        {
          groupBy: 'source',
          sourceType: 'assistant',
          sourceId: 'assistant-1',
          sourceName: 'Default Assistant',
          sourceIcon: null,
          ...metrics({ requestCount: 5, totalTokens: 500 })
        }
      ],
      totals: metrics({ requestCount: 8, totalTokens: 620 }),
      other: metrics({ requestCount: 3, totalTokens: 120 })
    })

    render(<UsageSourceBreakdown />)

    const otherRow = screen.getByText('Other').closest('tr')
    expect(otherRow).not.toBeNull()
    expect(otherRow).toHaveTextContent('3')
    expect(otherRow).toHaveTextContent('120')
  })

  it('bounds the query to today (local calendar day), never an unbounded range', () => {
    mockStats({ buckets: [], totals: metrics(), other: metrics() })

    render(<UsageSourceBreakdown />)

    const call = mockUseQuery.mock.calls.find(([path]) => path === STATS_PATH)
    expect(call).toBeDefined()
    const query = call?.[1]?.query as { groupBy: string; metric: string; from: number; to: number }
    const expectedTodayStart = new Date(2026, 2, 15, 0, 0, 0, 0).getTime()

    expect(query.groupBy).toBe('source')
    expect(query.metric).toBe('requests')
    expect(query.from).toBe(expectedTodayStart)
    expect(query.to).toBeGreaterThanOrEqual(query.from)
    // Bounded to (at most) one calendar day — the endpoint blanks the whole
    // response, not just this panel, if a caller ever hands it an unbounded range.
    expect(query.to - query.from).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  })
})
