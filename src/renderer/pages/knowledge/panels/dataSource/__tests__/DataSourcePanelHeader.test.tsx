import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import DataSourcePanelHeader from '../DataSourcePanelHeader'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'knowledge.data_source.bulk.selected_count') return `已选 ${opts?.count}`
      if (key === 'knowledge.data_source.bulk.loaded_only_hint') return `仅已加载，共 ${opts?.total} 项`
      return (
        (
          {
            'knowledge.data_source.bulk.reindex': '重新索引',
            'knowledge.data_source.bulk.delete': '删除'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

const baseProps = {
  total: 5,
  loadedCount: 5,
  selectedCount: 2,
  onBulkReindex: vi.fn(),
  onBulkDelete: vi.fn()
}

describe('DataSourcePanelHeader', () => {
  it('renders the bulk toolbar with the selected count', () => {
    render(<DataSourcePanelHeader {...baseProps} />)

    expect(screen.getByText('已选 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('warns that a selection only covers loaded rows when unloaded pages remain', () => {
    const { rerender } = render(<DataSourcePanelHeader {...baseProps} total={200} loadedCount={50} />)

    expect(screen.getByText('仅已加载，共 200 项')).toBeInTheDocument()

    // Fully loaded (total === loadedCount): no hint.
    rerender(<DataSourcePanelHeader {...baseProps} total={50} loadedCount={50} />)

    expect(screen.queryByText('仅已加载，共 50 项')).not.toBeInTheDocument()
  })

  it('invokes bulk callbacks from the toolbar', () => {
    const onBulkReindex = vi.fn()
    const onBulkDelete = vi.fn()

    render(<DataSourcePanelHeader {...baseProps} onBulkReindex={onBulkReindex} onBulkDelete={onBulkDelete} />)

    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(onBulkReindex).toHaveBeenCalledTimes(1)
    expect(onBulkDelete).toHaveBeenCalledTimes(1)
  })
})
