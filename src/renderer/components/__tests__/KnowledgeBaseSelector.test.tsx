import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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
  { value: 'base-beta', label: 'Beta Knowledge', disabled: true }
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

    fireEvent.click(screen.getByRole('button', { name: 'Select knowledge base' }))

    expect(screen.getByTestId('knowledge-base-selector-content')).toHaveStyle({
      width: 'var(--radix-popover-trigger-width)',
      height: '120px'
    })
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
})
