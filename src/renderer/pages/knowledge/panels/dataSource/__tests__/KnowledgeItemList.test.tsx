import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeItemList from '../KnowledgeItemList'
import { createFileItem, createNoteItem } from './testUtils'

vi.mock('@cherrystudio/ui', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel
  }: {
    checked?: boolean | 'indeterminate'
    onCheckedChange?: (checked: boolean | 'indeterminate') => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked === true}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>
}))

vi.mock('../KnowledgeItemRow', () => ({
  default: ({
    item,
    onClick,
    onDelete,
    onPreviewSource,
    onReindex,
    onViewChunks
  }: {
    item: { id: string; type?: string }
    onClick?: () => void
    onDelete?: () => void
    onPreviewSource?: () => void
    onReindex?: () => void
    onViewChunks?: () => void
  }) => (
    <tr>
      <td>
        <button type="button" onClick={onClick}>
          {item.id}
        </button>
        <button type="button" onClick={onDelete}>
          delete-{item.id}
        </button>
        <button type="button" onClick={onReindex}>
          reindex-{item.id}
        </button>
        <button type="button" onClick={onPreviewSource}>
          preview-{item.id}
        </button>
        <button type="button" onClick={onViewChunks}>
          chunks-{item.id}
        </button>
      </td>
    </tr>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.loading': '加载中...',
          'knowledge.data_source.table.select_all': '全选'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const noopProps = {
  selectedIds: new Set<string>(),
  onToggleOne: () => undefined,
  onToggleAll: () => undefined,
  onItemClick: () => undefined,
  onDelete: () => undefined,
  onPreviewSource: () => undefined,
  onReindex: () => undefined,
  onViewChunks: () => undefined
}

describe('KnowledgeItemList', () => {
  it('renders the loading state before item rows', () => {
    render(<KnowledgeItemList items={[]} isLoading {...noopProps} />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('renders nothing when there are no items and it is not loading', () => {
    render(<KnowledgeItemList items={[]} isLoading={false} {...noopProps} />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders rows when items are available', () => {
    render(
      <KnowledgeItemList
        items={[createFileItem({ id: 'file-1' }), createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        {...noopProps}
      />
    )

    expect(screen.getByRole('button', { name: 'file-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'note-1' })).toBeInTheDocument()
  })

  it('passes onItemClick through to the row click handler', () => {
    const handleItemClick = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} {...noopProps} onItemClick={handleItemClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'note-1' }))

    expect(handleItemClick).toHaveBeenCalledWith('note-1')
  })

  it('passes onDelete through to the row delete handler', () => {
    const handleDelete = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} {...noopProps} onDelete={handleDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'delete-note-1' }))

    expect(handleDelete).toHaveBeenCalledWith(item)
  })

  it('passes onReindex through to the row reindex handler', () => {
    const handleReindex = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} {...noopProps} onReindex={handleReindex} />)

    fireEvent.click(screen.getByRole('button', { name: 'reindex-note-1' }))

    expect(handleReindex).toHaveBeenCalledWith(item)
  })

  it('passes onPreviewSource through to the row preview handler', () => {
    const handlePreviewSource = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} {...noopProps} onPreviewSource={handlePreviewSource} />)

    fireEvent.click(screen.getByRole('button', { name: 'preview-note-1' }))

    expect(handlePreviewSource).toHaveBeenCalledWith(item)
  })

  it('passes onViewChunks through to the row view chunks handler', () => {
    const handleViewChunks = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} {...noopProps} onViewChunks={handleViewChunks} />)

    fireEvent.click(screen.getByRole('button', { name: 'chunks-note-1' }))

    expect(handleViewChunks).toHaveBeenCalledWith('note-1')
  })
})
