// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'
import { render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => (
    <button type="button" data-size={size} data-variant={variant} {...props}>
      {children}
    </button>
  ),
  EmptyState: ({ description, title }: { description?: string; title: string }) => (
    <div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
  Skeleton: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  Table: (props: TableHTMLAttributes<HTMLTableElement>) => <table {...props} />,
  TableBody: (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />,
  TableCell: (props: TdHTMLAttributes<HTMLTableCellElement>) => <td {...props} />,
  TableHead: (props: HTMLAttributes<HTMLTableCellElement>) => <th {...props} />,
  TableHeader: (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />,
  TableRow: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />
}))

vi.mock('../UsageSettingsPrimitives', () => ({
  UsageModelAvatar: () => <span data-testid="model-avatar" />,
  UsagePanel: ({ children }: { children: ReactNode }) => <div data-testid="usage-panel">{children}</div>,
  UsagePanelHeader: ({ children }: { children: ReactNode }) => <div data-testid="usage-panel-header">{children}</div>,
  UsagePanelTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  UsageSourceLabel: ({ children }: { children: ReactNode }) => <span data-testid="source-label">{children}</span>
}))

import { UsageEntriesTable } from '../UsageEntriesTable'

const entry: AiUsageRecordEntry = {
  id: '019c0800-0000-7000-8000-000000000001',
  requestId: 'request-1',
  recordKind: 'invocation',
  requestCount: 1,
  messageKind: 'chat',
  messageId: 'message-1',
  providerId: 'minimax',
  providerName: 'MiniMax',
  sourceType: 'assistant',
  sourceId: 'assistant-1',
  sourceName: 'Default Assistant',
  sourceIcon: '🙂',
  modelId: 'MiniMax-M3',
  modelName: 'MiniMax M3',
  modality: 'language',
  apiKeyId: 'key-1',
  apiKeyLabel: 'Primary key',
  apiKeyMasked: 'sk-****0001',
  apiKeyAttribution: 'explicit',
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
  createdAt: '2026-07-28T08:23:00.000Z'
}

function formatter(value: string): Intl.DateTimeFormat {
  return { format: () => value } as unknown as Intl.DateTimeFormat
}

describe('UsageEntriesTable', () => {
  it('keeps entry identity compact and renders missing metrics with hyphens', () => {
    const { container } = render(
      <UsageEntriesTable
        entries={[entry]}
        entryTotal={1}
        isLoading={false}
        isRefreshing={false}
        hasNextPage={false}
        sortBy="createdAt"
        sortOrder="desc"
        onSort={vi.fn()}
        onLoadNext={vi.fn()}
        getProviderInfo={() => ({ id: 'minimax', name: 'MiniMax' })}
        dateFormatter={formatter('Jul 28, 2026')}
        timeFormatter={formatter('16:23')}
      />
    )

    const row = screen.getByText('MiniMax M3').closest('tr')
    expect(row).not.toBeNull()
    const entryRow = within(row!)

    expect(entryRow.getByTestId('model-avatar')).toBeInTheDocument()
    expect(entryRow.getByText('MiniMax')).toBeInTheDocument()
    expect(entryRow.queryByText('MiniMax-M3')).not.toBeInTheDocument()
    expect(entryRow.getByTestId('source-label')).toHaveTextContent('Default Assistant')
    expect(entryRow.queryByText(/Language|语言/)).not.toBeInTheDocument()
    expect(entryRow.queryByText('Primary key')).not.toBeInTheDocument()
    expect(entryRow.queryByText('sk-****0001')).not.toBeInTheDocument()
    expect(entryRow.getAllByText('-')).toHaveLength(4)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/Entries|请求/)

    const date = entryRow.getByText('Jul 28, 2026 16:23')
    expect(date).toHaveClass('truncate', 'whitespace-nowrap', 'tabular-nums')
    expect(date).toHaveAttribute('title', 'Jul 28, 2026 16:23')
    expect(screen.getByText(/Model|模型/).closest('th')).not.toHaveClass('text-center')
    expect(screen.getByText(/Source|来源/).closest('th')).not.toHaveClass('text-center')
    expect(screen.getByText(/Date|日期/).closest('th')).not.toHaveClass('text-center')
    expect(screen.getByRole('table')).toHaveClass('min-w-[1040px]', 'table-fixed')
    expect(Array.from(container.querySelectorAll('col'), (column) => column.className)).toEqual([
      'w-[25%]',
      'w-[22%]',
      'w-[19%]',
      'w-[9%]',
      'w-[9%]',
      'w-[7%]',
      'w-[9%]'
    ])

    const cells = entryRow.getAllByRole('cell')
    for (const cell of cells.slice(0, 3)) {
      expect(cell).not.toHaveClass('text-center')
    }
    for (const cell of cells.slice(3)) {
      expect(cell).toHaveClass('whitespace-nowrap', 'text-right', 'tabular-nums')
    }
  })
})
