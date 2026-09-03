import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageTranslate from '../MessageTranslate'

vi.mock('@cherrystudio/ui', () => ({
  Divider: ({ children }: any) => <div>{children}</div>,
  NormalTooltip: ({ children, content }: any) => (
    <div data-testid="tooltip" data-content={content}>
      {children}
    </div>
  )
}))

vi.mock('lucide-react', () => ({
  Languages: () => <span data-testid="languages-icon" />,
  Trash: () => <span data-testid="trash-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: ({ block }: any) => <div data-testid="mock-markdown">{block.content}</div>
}))

const block = { id: 't1', status: 'done' as const, content: 'translated text' }

describe('MessageTranslate', () => {
  it('renders the delete button when onDelete is provided', () => {
    render(<MessageTranslate block={block} onDelete={vi.fn()} />)
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument()
  })

  it('omits the delete button when onDelete is absent', () => {
    render(<MessageTranslate block={block} />)
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument()
  })

  it('calls onDelete when the delete button is clicked', () => {
    const onDelete = vi.fn()
    render(<MessageTranslate block={block} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('uses translate.close as the tooltip content', () => {
    render(<MessageTranslate block={block} onDelete={vi.fn()} />)
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'translate.close')
  })
})
