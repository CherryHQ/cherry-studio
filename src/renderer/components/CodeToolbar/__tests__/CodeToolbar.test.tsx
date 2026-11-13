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
  it('only exposes actions whose visibility predicate passes', () => {
    const { rerender } = render(
      <CodeToolbar tools={[makeTool('visible', 'core'), makeTool('hidden', 'core', () => false)]} />
    )

    expect(screen.getByRole('button', { name: 'visible' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'hidden' })).not.toBeInTheDocument()

    rerender(<CodeToolbar tools={[makeTool('hidden', 'core', () => false)]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
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
