import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@iconify/react', () => ({
  Icon: ({ icon, className, width, height }: { icon: string; className?: string; width?: number; height?: number }) => (
    <span data-icon={icon} className={className} data-width={width} data-height={height} />
  )
}))

import { FileTree } from '../FileTree'
import type { FileTreeNode, FileTreeProps } from '../types'

afterEach(() => {
  cleanup()
})

const nodes: FileTreeNode[] = [
  {
    id: 'root',
    name: 'Root',
    kind: 'folder',
    path: 'root',
    children: [
      { id: 'a', name: 'A.md', kind: 'file', path: 'root/a.md' },
      { id: 'config', name: 'config.json', kind: 'file', path: 'root/config.json' },
      {
        id: 'sub',
        name: 'Sub',
        kind: 'folder',
        path: 'root/sub',
        children: [{ id: 'b', name: 'B.md', kind: 'file', path: 'root/sub/b.md' }]
      }
    ]
  }
]

/**
 * Bypass virtualization in tests by rendering a plain list - DynamicVirtualList
 * needs a sized scroll container which jsdom does not provide.
 */
const passthroughRenderList: NonNullable<FileTreeProps['renderList']> = ({ flat, renderItem }) => (
  <div data-testid="passthrough-list">{flat.map((_item, index) => renderItem(index))}</div>
)

describe('FileTree - read-only form (no callbacks)', () => {
  it('renders rows without drag support', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow).toHaveAttribute('draggable', 'false')
  })

  it('does not render rename input when renameSlot is omitted', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('does not render row extras when renderRowExtras is omitted', () => {
    render(<FileTree nodes={nodes} renderList={passthroughRenderList} />)
    expect(screen.queryByTestId('row-extras')).toBeNull()
  })

  it('toggles expand on folder row click', async () => {
    const user = userEvent.setup()
    render(<FileTree nodes={nodes} renderList={passthroughRenderList} />)
    expect(screen.queryByText('A.md')).toBeNull()
    await user.click(screen.getByText('Root'))
    expect(screen.getByText('A.md')).toBeInTheDocument()
  })

  it('reports selection through onSelectedChange', async () => {
    const onSelectedChange = vi.fn()
    const user = userEvent.setup()
    render(<FileTree nodes={nodes} onSelectedChange={onSelectedChange} renderList={passthroughRenderList} />)
    await user.click(screen.getByText('Root'))
    expect(onSelectedChange).toHaveBeenCalledWith('root')
  })

  it('truncates labels by default', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)

    expect(screen.getByText('A.md')).toHaveClass('truncate')
  })
})

describe('FileTree - editable form (all callbacks)', () => {
  it('renders rows as draggable when onMove is provided', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renderList={passthroughRenderList}
      />
    )
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow).toHaveAttribute('draggable', 'true')
  })

  it('renders rename input when renameSlot returns true for a node', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renameSlot={{
          isRenaming: (n) => n.id === 'a',
          inputProps: { value: 'A.md', onChange: () => {} }
        }}
        renderList={passthroughRenderList}
      />
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('A.md')
  })

  it('disables dragging on the row being renamed', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renameSlot={{
          isRenaming: (n) => n.id === 'a',
          inputProps: { value: 'A.md', onChange: () => {} }
        }}
        renderList={passthroughRenderList}
      />
    )
    const renamedRow = screen.getByRole('textbox').closest('[data-node-id="a"]')!
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(renamedRow).toHaveAttribute('draggable', 'false')
    expect(rootRow).toHaveAttribute('draggable', 'true')
  })

  it('renders renderRowExtras for every row', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renderRowExtras={(n) => <span data-testid={`extra-${n.id}`}>x</span>}
        renderList={passthroughRenderList}
      />
    )
    expect(screen.getByTestId('extra-root')).toBeInTheDocument()
    expect(screen.getByTestId('extra-a')).toBeInTheDocument()
  })

  it('opens row context menu from the whole row when getMenuItems is provided', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        getMenuItems={(n) => [{ type: 'item', id: `menu-${n.id}`, label: `Menu for ${n.name}`, onSelect: () => {} }]}
        renderList={passthroughRenderList}
      />
    )

    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    act(() => {
      fireEvent.contextMenu(rootRow)
    })

    expect(screen.getByText('Menu for Root')).toBeInTheDocument()
  })
})

describe('FileTree - icon behaviour', () => {
  it('shows material folder icons for expanded and collapsed folders', () => {
    const { rerender } = render(<FileTree nodes={nodes} expandedIds={new Set()} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    const collapsedIcon = rootRow.querySelector('[data-icon="material-icon-theme:folder"]')
    expect(collapsedIcon).toBeTruthy()
    expect(collapsedIcon).toHaveAttribute('data-width', '16')
    expect(collapsedIcon).toHaveAttribute('data-height', '16')
    rerender(<FileTree nodes={nodes} expandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const rootRow2 = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow2.querySelector('[data-icon="material-icon-theme:folder-open"]')).toBeTruthy()
  })

  it('shows material file icons by extension', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const markdownRow = screen.getByText('A.md').closest('[data-node-id="a"]')!
    const jsonRow = screen.getByText('config.json').closest('[data-node-id="config"]')!

    expect(markdownRow.querySelector('[data-icon="material-icon-theme:markdown"]')).toBeTruthy()
    expect(jsonRow.querySelector('[data-icon="material-icon-theme:json"]')).toBeTruthy()
    expect(markdownRow.querySelector('[data-icon="material-icon-theme:markdown"]')).toHaveAttribute('data-width', '16')
  })

  it('renders rows with sm text', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    const markdownRow = screen.getByText('A.md').closest('[data-node-id="a"]')!

    expect(rootRow).toHaveClass('text-sm')
    expect(markdownRow).toHaveClass('text-sm')
  })

  it('renders skillFileTree-style placeholder for file rows', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const markdownRow = screen.getByText('A.md').closest('[data-node-id="a"]')!

    expect(markdownRow.querySelector('.inline-block.size-3')).toBeTruthy()
    expect(markdownRow.querySelector('button')).toBeNull()
  })

  it('uses skillFileTree-style row padding for indentation', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root', 'sub'])} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]') as HTMLElement
    const markdownRow = screen.getByText('A.md').closest('[data-node-id="a"]') as HTMLElement
    const nestedRow = screen.getByText('B.md').closest('[data-node-id="b"]') as HTMLElement

    expect(rootRow.style.paddingInlineStart).toBe('8px')
    expect(markdownRow.style.paddingInlineStart).toBe('20px')
    expect(nestedRow.style.paddingInlineStart).toBe('32px')
    expect(rootRow.querySelector('span[style*="width"]')).toBeNull()
  })

  it('keeps custom file and folder icon overrides', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        fileIcon={(node) => <span data-testid={`custom-file-${node.id}`} />}
        folderIcon={(node, expanded) => <span data-testid={`custom-folder-${node.id}-${expanded}`} />}
        renderList={passthroughRenderList}
      />
    )

    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    const markdownRow = screen.getByText('A.md').closest('[data-node-id="a"]')!

    expect(screen.getByTestId('custom-folder-root-true')).toBeInTheDocument()
    expect(screen.getByTestId('custom-file-a')).toBeInTheDocument()
    expect(rootRow.querySelector('[data-icon^="material-icon-theme:"]')).toBeNull()
    expect(markdownRow.querySelector('[data-icon^="material-icon-theme:"]')).toBeNull()
  })
})

describe('FileTree - search box', () => {
  it('does not render the search input when showSearch is omitted', () => {
    render(<FileTree nodes={nodes} renderList={passthroughRenderList} />)
    expect(screen.queryByTestId('file-tree-search-input')).toBeNull()
  })

  it('renders the search input when showSearch is true', () => {
    render(
      <FileTree
        nodes={nodes}
        showSearch
        searchKeyword=""
        onSearchKeywordChange={() => {}}
        renderList={passthroughRenderList}
      />
    )
    expect(screen.getByTestId('file-tree-search-input')).toBeInTheDocument()
  })

  it('reflects the controlled searchKeyword value', () => {
    render(
      <FileTree
        nodes={nodes}
        showSearch
        searchKeyword="hello"
        onSearchKeywordChange={() => {}}
        renderList={passthroughRenderList}
      />
    )
    const input = screen.getByTestId('file-tree-search-input') as HTMLInputElement
    expect(input.value).toBe('hello')
  })

  it('fires onSearchKeywordChange on input', async () => {
    const onSearchKeywordChange = vi.fn()
    const user = userEvent.setup()
    render(
      <FileTree
        nodes={nodes}
        showSearch
        searchKeyword=""
        onSearchKeywordChange={onSearchKeywordChange}
        renderList={passthroughRenderList}
      />
    )
    await user.type(screen.getByTestId('file-tree-search-input'), 'a')
    expect(onSearchKeywordChange).toHaveBeenCalledWith('a')
  })

  it('clears the keyword via the clear button', async () => {
    const onSearchKeywordChange = vi.fn()
    const user = userEvent.setup()
    render(
      <FileTree
        nodes={nodes}
        showSearch
        searchKeyword="abc"
        onSearchKeywordChange={onSearchKeywordChange}
        renderList={passthroughRenderList}
      />
    )
    await user.click(screen.getByLabelText('Clear search'))
    expect(onSearchKeywordChange).toHaveBeenCalledWith('')
  })
})
