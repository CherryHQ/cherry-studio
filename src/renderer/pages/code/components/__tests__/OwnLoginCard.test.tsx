import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

import { OwnLoginCard } from '../OwnLoginCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const defaultProps = {
  toolId: CodeCli.CLAUDE_CODE,
  toolName: 'Claude Code',
  selected: false
}

describe('OwnLoginCard', () => {
  it('pairs action visibility with hit testing for hover, keyboard and no-hover input', () => {
    render(<OwnLoginCard {...defaultProps} onToggle={vi.fn()} />)
    const actions = screen.getByRole('button', { name: 'code.enable' }).parentElement

    // Own-login actions share the hidden-hotspot and no-hover accessibility contract.
    expect(actions?.className).toBe(
      'pointer-events-none flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 no-hover:pointer-events-auto no-hover:opacity-100'
    )
    expect(actions).toHaveClass('pointer-events-none', 'no-hover:pointer-events-auto', 'no-hover:opacity-100')
    expect(actions).not.toHaveClass('pointer-events-auto')
  })

  it('labels the toggle Enable when unselected and Disable when selected', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<OwnLoginCard {...defaultProps} onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'code.enable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code.disable' })).not.toBeInTheDocument()

    rerender(<OwnLoginCard {...defaultProps} selected onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'code.disable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code.enable' })).not.toBeInTheDocument()
  })

  it.each([
    { configurable: false, hasConfigure: true, expected: false },
    { configurable: true, hasConfigure: false, expected: false },
    { configurable: true, hasConfigure: true, expected: true }
  ])('shows Configure only when configurable=$configurable and callback=$hasConfigure', (options) => {
    render(
      <OwnLoginCard
        {...defaultProps}
        onToggle={vi.fn()}
        configurable={options.configurable}
        onConfigure={options.hasConfigure ? vi.fn() : undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'code.configure' }) !== null).toBe(options.expected)
  })

  it('toggles own login without opening configuration', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const onConfigure = vi.fn()
    render(<OwnLoginCard {...defaultProps} configurable onToggle={onToggle} onConfigure={onConfigure} />)

    await user.click(screen.getByRole('button', { name: 'code.enable' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onConfigure).not.toHaveBeenCalled()
  })
})
