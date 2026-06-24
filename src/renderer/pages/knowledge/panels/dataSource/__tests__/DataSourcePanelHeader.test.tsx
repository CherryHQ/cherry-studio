import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import DataSourcePanelHeader from '../DataSourcePanelHeader'

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  MenuItem: ({ label, ...props }: { label: string; [key: string]: unknown }) => <button {...props}>{label}</button>,
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'knowledge.data_source.bulk.selected_count') return `已选 ${opts?.count}`
      if (key === 'knowledge.meta.updated_at') return `更新于 ${opts?.time}`
      if (key === 'knowledge.data_source.bulk.loaded_only_hint') return `仅已加载，共 ${opts?.total} 项`
      return (
        (
          {
            'knowledge.data_source.bulk.cancel': '取消',
            'knowledge.data_source.bulk.reindex': '重新索引',
            'knowledge.data_source.bulk.delete': '删除',
            'knowledge.data_source.toolbar.add': '添加'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

const baseProps = {
  total: 5,
  loadedCount: 5,
  selectedCount: 0,
  updatedAt: '2026-06-16T00:00:00.000Z',
  onBulkReindex: vi.fn(),
  onBulkDelete: vi.fn(),
  onAdd: vi.fn()
}

describe('DataSourcePanelHeader', () => {
  it('renders the updated time and add button in the default state', () => {
    render(<DataSourcePanelHeader {...baseProps} selectedCount={0} />)

    expect(screen.getByText('更新于 刚刚')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
  })

  it('switches to the bulk toolbar when rows are selected', () => {
    render(<DataSourcePanelHeader {...baseProps} selectedCount={2} />)

    expect(screen.getByText('已选 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('warns that a selection only covers loaded rows when unloaded pages remain', () => {
    const { rerender } = render(
      <DataSourcePanelHeader {...baseProps} total={200} loadedCount={50} selectedCount={50} />
    )

    expect(screen.getByText('仅已加载，共 200 项')).toBeInTheDocument()

    // Fully loaded (total === loadedCount): no hint.
    rerender(<DataSourcePanelHeader {...baseProps} total={50} loadedCount={50} selectedCount={50} />)

    expect(screen.queryByText('仅已加载，共 50 项')).not.toBeInTheDocument()
  })

  // Regression for the QA issue "选中文件后列表轻微上移": the default toolbar
  // (32px add button) and the bulk toolbar (28px sm buttons) differed by 4px,
  // shifting the list on selection. Both states must keep the same min height.
  it('keeps the same min height across default and selected states', () => {
    const { container: defaultContainer } = render(<DataSourcePanelHeader {...baseProps} selectedCount={0} />)
    const { container: selectedContainer } = render(<DataSourcePanelHeader {...baseProps} selectedCount={2} />)

    expect(defaultContainer.firstChild).toHaveClass('min-h-8')
    expect(selectedContainer.firstChild).toHaveClass('min-h-8')
  })

  it('invokes bulk callbacks from the selected-state toolbar', () => {
    const onBulkReindex = vi.fn()
    const onBulkDelete = vi.fn()

    render(
      <DataSourcePanelHeader
        {...baseProps}
        selectedCount={1}
        onBulkReindex={onBulkReindex}
        onBulkDelete={onBulkDelete}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(onBulkReindex).toHaveBeenCalledTimes(1)
    expect(onBulkDelete).toHaveBeenCalledTimes(1)
  })
})
