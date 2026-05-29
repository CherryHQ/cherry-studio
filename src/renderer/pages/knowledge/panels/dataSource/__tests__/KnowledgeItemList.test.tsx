import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeItemList from '../KnowledgeItemList'
import { createFileItem, createNoteItem } from './testUtils'

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
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
    <div>
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
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.loading': '加载中...',
          'common.no_results': '暂无结果'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('KnowledgeItemList', () => {
  it('renders the loading state before item rows', () => {
    render(
      <KnowledgeItemList
        items={[]}
        isLoading
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('renders the empty state when there are no visible items', () => {
    render(
      <KnowledgeItemList
        items={[]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    expect(screen.getByText('暂无结果')).toBeInTheDocument()
  })

  it('renders rows when items are available', () => {
    render(
      <KnowledgeItemList
        items={[createFileItem({ id: 'file-1' }), createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'file-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'note-1' })).toBeInTheDocument()
  })

  it('passes onItemClick through to the row click handler', () => {
    const handleItemClick = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList
        items={[item]}
        isLoading={false}
        onItemClick={handleItemClick}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'note-1' }))

    expect(handleItemClick).toHaveBeenCalledWith('note-1')
  })

  it('passes onDelete through to the row delete handler', () => {
    const handleDelete = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList
        items={[item]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={handleDelete}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'delete-note-1' }))

    expect(handleDelete).toHaveBeenCalledWith(item)
  })

  it('passes onReindex through to the row reindex handler', () => {
    const handleReindex = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList
        items={[item]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={handleReindex}
        onViewChunks={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'reindex-note-1' }))

    expect(handleReindex).toHaveBeenCalledWith(item)
  })

  it('passes onPreviewSource through to the row preview handler', () => {
    const handlePreviewSource = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList
        items={[item]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={handlePreviewSource}
        onReindex={() => undefined}
        onViewChunks={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'preview-note-1' }))

    expect(handlePreviewSource).toHaveBeenCalledWith(item)
  })

  it('passes onViewChunks through to the row view chunks handler', () => {
    const handleViewChunks = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList
        items={[item]}
        isLoading={false}
        onItemClick={() => undefined}
        onDelete={() => undefined}
        onPreviewSource={() => undefined}
        onReindex={() => undefined}
        onViewChunks={handleViewChunks}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'chunks-note-1' }))

    expect(handleViewChunks).toHaveBeenCalledWith('note-1')
  })
})
