import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return importOriginal<typeof CherryStudioUi>()
})

import { KnowledgeBaseSelector } from '../KnowledgeBaseSelector'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

const options = [
  { value: 'base-alpha', label: 'Alpha Knowledge' },
  { value: 'base-beta', label: 'Beta Knowledge', disabled: true },
  { value: 'base-gamma', label: 'Gamma Knowledge' }
]

const renderSelector = (onChange = vi.fn()) => {
  render(
    <KnowledgeBaseSelector
      aria-label="Select knowledge base"
      value="base-alpha"
      options={options}
      placeholder="Choose a knowledge base"
      searchPlaceholder="Search knowledge bases"
      emptyText="No results"
      onChange={onChange}
    />
  )
  return onChange
}

describe('KnowledgeBaseSelector', () => {
  it('opens a trigger-width SelectorShell and filters by name', () => {
    renderSelector()

    const trigger = screen.getByRole('button', { name: 'Select knowledge base' })
    fireEvent.click(trigger)

    expect(screen.getByTestId('knowledge-base-selector-content')).toHaveStyle({
      width: 'var(--radix-popover-trigger-width)',
      height: '156px'
    })
    // Select triggers must not add border or outer-ring feedback when expanded.
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).not.toHaveClass(
      'aria-expanded:border-primary',
      'aria-expanded:ring-3',
      'aria-expanded:ring-primary/20'
    )
    expect(screen.getByRole('option', { name: 'Alpha Knowledge' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search knowledge bases'), { target: { value: 'beta' } })

    expect(screen.getByTestId('knowledge-base-selector-content')).toHaveStyle({ height: '84px' })
    expect(screen.queryByRole('option', { name: 'Alpha Knowledge' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta Knowledge' })).toBeInTheDocument()
  })

  it('selects available knowledge bases and ignores unavailable ones', () => {
    const onChange = renderSelector()

    fireEvent.click(screen.getByRole('button', { name: 'Select knowledge base' }))
    fireEvent.click(screen.getByRole('option', { name: 'Beta Knowledge' }))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('option', { name: 'Alpha Knowledge' }))
    expect(onChange).toHaveBeenCalledWith('base-alpha')
  })

  it('navigates from the search input and skips disabled knowledge bases', async () => {
    const user = userEvent.setup()
    const onChange = renderSelector()

    await user.click(screen.getByRole('button', { name: 'Select knowledge base' }))

    const searchInput = screen.getByPlaceholderText('Search knowledge bases')
    const alphaOption = screen.getByRole('option', { name: 'Alpha Knowledge' })
    const gammaOption = screen.getByRole('option', { name: 'Gamma Knowledge' })
    await waitFor(() => expect(searchInput).toHaveAttribute('aria-activedescendant', alphaOption.id))

    await user.keyboard('{ArrowDown}')
    expect(searchInput).toHaveAttribute('aria-activedescendant', gammaOption.id)

    await user.keyboard('{ArrowUp}')
    expect(searchInput).toHaveAttribute('aria-activedescendant', alphaOption.id)

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('base-gamma')
  })
})
