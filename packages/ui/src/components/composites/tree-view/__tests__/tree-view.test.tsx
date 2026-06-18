// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TreeView } from '../tree-view'
import type { RenderRowFn, TreeNodeAdapter } from '../types'

interface Node {
  id: string
  name: string
  children?: Node[]
}

const adapter: TreeNodeAdapter<Node> = {
  getId: (n) => n.id,
  getChildren: (n) => n.children,
  canHaveChildren: (n) => Array.isArray(n.children)
}

const data: Node[] = [
  {
    id: 'root',
    name: 'Root',
    children: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', children: [{ id: 'b1', name: 'B1' }] }
    ]
  }
]

const renderRow: RenderRowFn<Node> = ({
  node,
  depth,
  isExpanded,
  isSelected,
  toggleExpanded,
  selectNode,
  dragHandleProps
}) => (
  <div
    key={node.id}
    {...dragHandleProps}
    data-testid={`row-${node.id}`}
    data-depth={depth}
    data-expanded={isExpanded}
    data-selected={isSelected}
    onClick={selectNode}
    onDoubleClick={toggleExpanded}>
    {node.name}
  </div>
)

afterEach(() => {
  cleanup()
})

describe('TreeView', () => {
  it('renders the empty state slot when data is empty', () => {
    render(<TreeView data={[]} adapter={adapter} renderRow={renderRow} emptyState={<span>No items</span>} />)
    expect(screen.getByText('No items')).toBeInTheDocument()
  })

  it('renders only roots when nothing is expanded', () => {
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} />)
    expect(screen.getByTestId('row-root')).toBeInTheDocument()
    expect(screen.queryByTestId('row-a')).toBeNull()
  })

  it('toggles expansion via uncontrolled state', async () => {
    const user = userEvent.setup()
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} />)
    await user.dblClick(screen.getByTestId('row-root'))
    expect(screen.getByTestId('row-a')).toBeInTheDocument()
    expect(screen.getByTestId('row-b')).toBeInTheDocument()
  })

  it('calls onExpandedChange when controlled', async () => {
    const onExpandedChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TreeView
        data={data}
        adapter={adapter}
        renderRow={renderRow}
        expandedIds={new Set()}
        onExpandedChange={onExpandedChange}
      />
    )
    await user.dblClick(screen.getByTestId('row-root'))
    expect(onExpandedChange).toHaveBeenCalled()
    const lastCall = onExpandedChange.mock.calls.at(-1)?.[0] as Set<string>
    expect(lastCall.has('root')).toBe(true)
  })

  it('selects on click and reports through onSelectedChange', async () => {
    const onSelectedChange = vi.fn()
    const user = userEvent.setup()
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} onSelectedChange={onSelectedChange} />)
    await user.click(screen.getByTestId('row-root'))
    expect(onSelectedChange).toHaveBeenCalledWith('root')
    expect(screen.getByTestId('row-root')).toHaveAttribute('data-selected', 'true')
  })

  it('passes correct depth to renderRow', async () => {
    const user = userEvent.setup()
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} defaultExpandedIds={new Set(['root', 'b'])} />)
    expect(screen.getByTestId('row-root')).toHaveAttribute('data-depth', '0')
    expect(screen.getByTestId('row-a')).toHaveAttribute('data-depth', '1')
    expect(screen.getByTestId('row-b1')).toHaveAttribute('data-depth', '2')
    await user.click(screen.getByTestId('row-a'))
  })

  it('disables drag handle when onMove is omitted', () => {
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} />)
    expect(screen.getByTestId('row-root')).toHaveAttribute('draggable', 'false')
  })

  it('enables drag handle when onMove is provided', () => {
    render(<TreeView data={data} adapter={adapter} renderRow={renderRow} onMove={() => {}} />)
    expect(screen.getByTestId('row-root')).toHaveAttribute('draggable', 'true')
  })

  it('invokes renderList slot with flat metadata', () => {
    const renderList = vi.fn(({ flat }) => (
      <div data-count={flat.length} data-testid="virt">
        virt
      </div>
    ))
    render(
      <TreeView
        data={data}
        adapter={adapter}
        renderRow={renderRow}
        renderList={renderList}
        defaultExpandedIds={new Set(['root'])}
      />
    )
    expect(renderList).toHaveBeenCalled()
    expect(screen.getByTestId('virt')).toHaveAttribute('data-count', '3')
  })
})
