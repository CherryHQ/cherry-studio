import type { Citation } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CitationsList from '../CitationsList'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  __esModule: true,
  default: () => <span data-testid="favicon" />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContent: vi.fn(),
  fetchXOEmbed: vi.fn(),
  isXPostUrl: vi.fn(() => false)
}))

vi.mock('antd', () => ({
  Popover: ({ children, content, title }: any) => (
    <div>
      {children}
      <div data-testid="popover">
        {title}
        {content}
      </div>
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (values?.count ? `${key}:${values.count}` : key)
  })
}))

describe('CitationsList', () => {
  it('renders web citations without urls as non-links', () => {
    const citations: Citation[] = [
      {
        number: 2,
        url: '',
        title: 'Data Structures for Statistical Computing in Python',
        content: 'Reference text',
        showFavicon: true,
        type: 'websearch'
      }
    ]

    render(<CitationsList citations={citations} />)

    const title = screen.getByText('Data Structures for Statistical Computing in Python')
    expect(title).toBeInTheDocument()
    expect(title.closest('a')).toBeNull()
  })
})
