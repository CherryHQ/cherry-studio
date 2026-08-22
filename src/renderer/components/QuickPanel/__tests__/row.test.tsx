import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QuickPanelRow } from '../list'

describe('QuickPanelRow', () => {
  it('keeps inline descriptions next to the label and lets the description yield space first', () => {
    render(
      <QuickPanelRow
        active={false}
        item={{
          id: 'skill:short-name',
          label: 'short-name',
          description: 'A description long enough to exercise the single-line overflow contract.',
          inlineDescription: true,
          icon: 'icon',
          suffix: 'Skill'
        }}
        onSelect={vi.fn()}
      />
    )

    const label = screen.getByText('short-name')
    const description = screen.getByText(/A description long enough/)
    const suffix = screen.getByText('Skill')

    expect(label.parentElement).toHaveClass('max-w-full', 'min-w-0', 'shrink-0')
    expect(label.parentElement?.parentElement).toBe(description.parentElement)
    expect(label).toHaveClass('min-w-0', 'truncate')
    expect(label).not.toHaveClass('max-w-[50%]')
    expect(description).toHaveClass('min-w-0', 'flex-1', 'truncate')
    expect(suffix.parentElement?.parentElement).not.toBe(description.parentElement)
  })

  it('keeps trailing descriptions in the metadata column by default', () => {
    render(
      <QuickPanelRow
        active={false}
        item={{
          id: 'permission:auto',
          label: 'Auto',
          description: 'Recommended',
          icon: 'icon',
          suffix: 'suffix'
        }}
        onSelect={vi.fn()}
      />
    )

    const label = screen.getByText('Auto')
    const description = screen.getByText('Recommended')

    expect(label.parentElement).not.toBe(description.parentElement)
    expect(description.parentElement).toHaveClass('min-w-[20%]', 'justify-end')
    expect(description.parentElement).not.toHaveClass('max-w-[60%]')
  })
})
