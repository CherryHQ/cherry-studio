// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { TreeSelect, type TreeSelectOption } from '../tree-select'

const treeData: TreeSelectOption[] = [
  {
    value: '',
    title: 'Root',
    children: [
      {
        value: 'docs',
        title: 'Docs',
        children: [
          { value: 'docs/guide.md', title: 'guide.md', icon: <span>file</span> },
          { value: 'docs/drafts', title: 'Drafts', selectable: false }
        ]
      },
      {
        value: 'archive',
        title: 'Archive',
        disabled: true
      }
    ]
  }
]

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TreeSelect', () => {
  it('renders the selected value in the trigger', () => {
    render(<TreeSelect treeData={treeData} value="docs/guide.md" />)

    expect(screen.getByRole('combobox')).toHaveTextContent('guide.md')
  })

  it('expands nested nodes and selects an item', async () => {
    const onChange = vi.fn()
    render(<TreeSelect treeData={treeData} onChange={onChange} placeholder="Pick path" />)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByLabelText('Expand'))
    fireEvent.click(screen.getByLabelText('Expand'))
    fireEvent.click(screen.getByText('guide.md'))

    expect(onChange).toHaveBeenCalledWith('docs/guide.md', expect.objectContaining({ title: 'guide.md' }))

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveTextContent('guide.md')
    })
  })

  it('filters by option title and keeps ancestors visible', () => {
    render(<TreeSelect treeData={treeData} searchPlaceholder="Search paths" />)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByPlaceholderText('Search paths'), { target: { value: 'guide' } })

    expect(screen.getByText('Root')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(screen.getByText('guide.md')).toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()
  })

  it('does not select disabled options', () => {
    const onChange = vi.fn()
    render(<TreeSelect treeData={treeData} defaultExpandAll onChange={onChange} />)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('Archive'))

    expect(onChange).not.toHaveBeenCalled()
  })
})
