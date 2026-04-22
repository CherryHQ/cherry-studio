import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeItemList from '../KnowledgeItemList'
import { createFileItem, createNoteItem } from './testUtils'

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../KnowledgeItemRow', () => ({
  default: ({ item, onClick }: { item: { id: string }; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {item.id}
    </button>
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
    render(<KnowledgeItemList items={[]} isLoading onItemClick={() => undefined} />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('renders the empty state when there are no visible items', () => {
    render(<KnowledgeItemList items={[]} isLoading={false} onItemClick={() => undefined} />)

    expect(screen.getByText('暂无结果')).toBeInTheDocument()
  })

  it('renders rows when items are available', () => {
    render(
      <KnowledgeItemList
        items={[createFileItem({ id: 'file-1' }), createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        onItemClick={() => undefined}
      />
    )

    expect(screen.getByRole('button', { name: 'file-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'note-1' })).toBeInTheDocument()
  })

  it('passes onItemClick through to the row click handler', () => {
    const handleItemClick = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(<KnowledgeItemList items={[item]} isLoading={false} onItemClick={handleItemClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'note-1' }))

    expect(handleItemClick).toHaveBeenCalledWith(item)
  })
})
