import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BranchTab from '../BranchTab'
import { BRANCH_HL_COLOR_VALUES } from '../constants'
import type { Branch } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const branch: Branch = {
  id: 'branch-A',
  source: {
    messageId: 'msg-1',
    blockId: 'blk-1',
    selectedText: 'student model is a smaller distilled model',
    offsets: { start: 0, end: 42 }
  },
  topic: null,
  createdAt: 1_700_000_000_000,
  color: 'c2',
  disposition: 'pending'
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('BranchTab (P1-S2c master row)', () => {
  it('renders the number badge (index+1), snippet, and carries data-branch-id + data-hl', () => {
    render(<BranchTab branch={branch} index={2} collapsed={false} onToggleCollapse={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByTestId('branch-tab-badge')).toHaveTextContent('3')
    expect(screen.getByTestId('branch-tab-snippet')).toHaveTextContent(branch.source.selectedText)
    const tab = screen.getByTestId(`branch-tab-${branch.id}`)
    expect(tab.getAttribute('data-branch-id')).toBe(branch.id)
    expect(tab.getAttribute('data-hl')).toBe('c2')
  })

  it('badge background is the branch palette color (tab maps to its highlight)', () => {
    render(<BranchTab branch={branch} index={0} collapsed={false} onToggleCollapse={vi.fn()} onClose={vi.fn()} />)
    const parseRgba = (s: string): [number, number, number, number] | null => {
      const m = s.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,/]+([\d.]+)\s*\)/)
      return m ? [+m[1], +m[2], +m[3], +m[4]] : null
    }
    const badge = screen.getByTestId('branch-tab-badge') as HTMLElement
    expect(parseRgba(badge.style.backgroundColor)).toEqual(parseRgba(BRANCH_HL_COLOR_VALUES.c2))
  })

  it('chevron and snippet both toggle collapse; X closes', () => {
    const onToggleCollapse = vi.fn()
    const onClose = vi.fn()
    render(
      <BranchTab branch={branch} index={0} collapsed={false} onToggleCollapse={onToggleCollapse} onClose={onClose} />
    )

    fireEvent.click(screen.getByTestId('branch-tab-chevron'))
    fireEvent.click(screen.getByTestId('branch-tab-snippet'))
    expect(onToggleCollapse).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByTestId('branch-tab-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('aria-expanded reflects collapsed state', () => {
    const { rerender } = render(
      <BranchTab branch={branch} index={0} collapsed={false} onToggleCollapse={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByTestId('branch-tab-chevron')).toHaveAttribute('aria-expanded', 'true')

    rerender(<BranchTab branch={branch} index={0} collapsed={true} onToggleCollapse={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('branch-tab-chevron')).toHaveAttribute('aria-expanded', 'false')
  })

  it('does NOT use position:sticky or display:contents (master visibility is structural, not CSS-pinned)', () => {
    render(<BranchTab branch={branch} index={0} collapsed={false} onToggleCollapse={vi.fn()} onClose={vi.fn()} />)
    const tab = screen.getByTestId(`branch-tab-${branch.id}`)
    expect(tab.className).not.toContain('sticky')
    expect(tab.style.display).not.toBe('contents')
  })
})
