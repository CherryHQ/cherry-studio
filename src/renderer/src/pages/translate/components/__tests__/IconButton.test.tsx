import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import IconButton from '../IconButton'

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

const tooltipProbe = vi.hoisted(() => ({
  lastContent: null as unknown,
  lastSide: null as string | null
}))

vi.mock('@cherrystudio/ui', () => ({
  NormalTooltip: ({
    children,
    content,
    side
  }: {
    children: React.ReactNode
    content?: React.ReactNode
    side?: string
  }) => {
    tooltipProbe.lastContent = content ?? null
    tooltipProbe.lastSide = side ?? null
    return <>{children}</>
  }
}))

describe('IconButton', () => {
  it('uses aria-label as tooltip content when tooltip prop is absent', () => {
    tooltipProbe.lastContent = null
    render(
      <IconButton aria-label="translate.history.clear">
        <span>icon</span>
      </IconButton>
    )

    expect(tooltipProbe.lastContent).toBe('translate.history.clear')
  })

  it('does not mount tooltip when button is disabled', () => {
    tooltipProbe.lastContent = null
    render(
      <IconButton aria-label="common.copy" disabled>
        <span>icon</span>
      </IconButton>
    )

    expect(tooltipProbe.lastContent).toBeNull()
  })

  it('applies destructive and active star tone classes', () => {
    const { rerender } = render(
      <IconButton tone="destructive" aria-label="common.delete">
        <span>icon</span>
      </IconButton>
    )
    const destructiveBtn = screen.getByRole('button', { name: 'common.delete' })
    expect(destructiveBtn.className).toContain('hover:text-destructive')

    rerender(
      <IconButton tone="star" active aria-label="translate.history.filter.starred">
        <span>icon</span>
      </IconButton>
    )
    const starBtn = screen.getByRole('button', { name: 'translate.history.filter.starred' })
    expect(starBtn.className).toContain('text-amber-500')
    expect(starBtn.className).toContain('bg-amber-500/10')
  })

  it('forwards click handlers', () => {
    const onClick = vi.fn()
    render(
      <IconButton aria-label="common.copy" onClick={onClick}>
        <span>icon</span>
      </IconButton>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
