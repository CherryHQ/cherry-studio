import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'

import CodeToolbar from '../CodeToolbar'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

function makeTool(id: string, type: ActionTool['type'], visible?: () => boolean): ActionTool {
  return {
    id,
    type,
    order: 1,
    icon: null,
    tooltip: id,
    visible,
    onClick: vi.fn()
  }
}

describe('CodeToolbar', () => {
  it('preserves sticky scroll-follow without blocking code interaction', () => {
    const { container } = render(<CodeToolbar tools={[makeTool('core', 'core')]} />)
    const stickyWrapper = container.firstElementChild

    // This class structure is the layout contract from the sticky-toolbar regression:
    // the zero-height shell follows scrolling while pointer events pass through to code.
    expect(stickyWrapper).toHaveClass('pointer-events-none', 'sticky', 'top-7', 'z-10', 'h-0')
    expect(stickyWrapper?.firstElementChild).toHaveClass(
      'code-toolbar',
      'pointer-events-auto',
      'absolute',
      'right-2',
      'bottom-1'
    )
  })

  it('only exposes actions whose visibility predicate passes', () => {
    const { rerender } = render(
      <CodeToolbar tools={[makeTool('visible', 'core'), makeTool('hidden', 'core', () => false)]} />
    )

    expect(screen.getByRole('button', { name: 'visible' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'hidden' })).not.toBeInTheDocument()

    rerender(<CodeToolbar tools={[makeTool('hidden', 'core', () => false)]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a single quick action without an overflow control', () => {
    render(<CodeToolbar tools={[makeTool('quick', 'quick'), makeTool('core', 'core')]} />)

    expect(screen.getByRole('button', { name: 'quick' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'core' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.more' })).not.toBeInTheDocument()
  })

  it('toggles multiple quick actions while keeping core actions available', async () => {
    const user = userEvent.setup()
    render(
      <CodeToolbar tools={[makeTool('quick-1', 'quick'), makeTool('quick-2', 'quick'), makeTool('core', 'core')]} />
    )
    const more = screen.getByRole('button', { name: 'code_block.more' })

    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'quick-1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'core' })).toBeInTheDocument()

    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'quick-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'quick-2' })).toBeInTheDocument()

    more.focus()
    await user.keyboard('{Enter}')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'quick-1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'core' })).toBeInTheDocument()
  })
})
