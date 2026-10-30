import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { CommandContextMenuExtraItem, MaybePromise } from '@renderer/components/command'
import type { FileTreeNode } from '@renderer/components/FileTree'

import { ArtifactPaneBreadcrumb } from '../ArtifactPaneBreadcrumb'

vi.unmock('@cherrystudio/ui')
vi.mock('@iconify/react', () => ({ Icon: () => null }))

const openedMenus = vi.hoisted(() => [] as string[][])
// Records the items a right-click on the wrapped element would show.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems = [],
    getExtraItems
  }: {
    children: React.ReactNode
    extraItems?: readonly CommandContextMenuExtraItem[]
    getExtraItems?: () => MaybePromise<readonly CommandContextMenuExtraItem[]>
  }) => (
    <div
      onContextMenu={async (event) => {
        event.stopPropagation()
        const items = getExtraItems ? await getExtraItems() : extraItems
        openedMenus.push(items.map((item) => (item.type === 'separator' ? '-' : item.id)))
      }}>
      {children}
    </div>
  )
}))

const menuItem = (id: string): CommandContextMenuExtraItem => ({ type: 'item', id, label: id, onSelect: () => {} })

const file = (id: string): FileTreeNode => ({ id, name: id.split('/').pop()!, kind: 'file', path: id })
const folder = (id: string, children: FileTreeNode[] = []): FileTreeNode => ({
  id,
  name: id.split('/').pop()!,
  kind: 'folder',
  path: id,
  children
})

// Mirrors the tree model: `lib`'s entries only exist after it is loaded.
function Harness({ onOpenFile }: { onOpenFile: (id: string) => void }) {
  const [libLoaded, setLibLoaded] = useState(false)
  const lib = folder('src/lib', libLoaded ? [file('src/lib/util.ts')] : [])
  const src = folder('src', [lib, file('src/a.ts'), file('src/b.ts')])
  const all = (nodes: FileTreeNode[]): FileTreeNode[] => nodes.flatMap((n) => [n, ...all(n.children ?? [])])
  const nodeById = new Map(all([src]).map((n) => [n.id, n]))
  return (
    <ArtifactPaneBreadcrumb
      relativePath="src/a.ts"
      fallbackTitle="a.ts"
      fullPath="/ws/src/a.ts"
      rootEntries={[src]}
      nodeById={nodeById}
      onOpenFile={onOpenFile}
      onLoadFolder={(id) => id === 'src/lib' && setLibLoaded(true)}
      fileMenuItems={[menuItem('file')]}
      getFolderMenuItems={(id) => [menuItem(`folder:${id}`)]}
    />
  )
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('ArtifactPaneBreadcrumb', () => {
  it('shows a folder segment’s own menu and the file menu only on the file segment', async () => {
    openedMenus.length = 0
    render(<Harness onOpenFile={vi.fn()} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'src' }))
    await waitFor(() => expect(openedMenus).toEqual([['folder:src']]))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'a.ts' }))
    await waitFor(() => expect(openedMenus).toEqual([['folder:src'], ['file']]))
  })

  it('lists the open file’s siblings from its own segment', async () => {
    const onOpenFile = vi.fn()
    render(<Harness onOpenFile={onOpenFile} />)

    await userEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    await userEvent.click(await screen.findByRole('treeitem', { name: 'b.ts' }))

    expect(onOpenFile).toHaveBeenCalledWith('src/b.ts')
  })

  it('expands a folder in place, loading its entries', async () => {
    const onOpenFile = vi.fn()
    render(<Harness onOpenFile={onOpenFile} />)

    await userEvent.click(screen.getByRole('button', { name: 'src' }))
    await userEvent.click(await screen.findByRole('treeitem', { name: 'lib' }))
    await userEvent.click(await screen.findByRole('treeitem', { name: 'util.ts' }))

    expect(onOpenFile).toHaveBeenCalledWith('src/lib/util.ts')
    expect(screen.queryByRole('tree')).toBeNull()
  })
})
