import type * as DndKitReact from '@dnd-kit/react'
import { installDndDomStubs } from '@test-mocks/dndDomStubs'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as DragDropRootModule from '@cherrystudio/ui/components/composites/sortable/drag-drop-root'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'

import { BaseNavigator } from '../navigator'

vi.unmock('@cherrystudio/ui')

const dnd = vi.hoisted(() => ({ manager: null as ReturnType<typeof DndKitReact.useDragDropManager> }))

vi.mock('@cherrystudio/ui/components/composites/sortable/drag-drop-root', async (importOriginal) => {
  const actual = await importOriginal<typeof DragDropRootModule>()
  const { useDragDropManager } = await vi.importActual<typeof DndKitReact>('@dnd-kit/react')
  const ManagerProbe = () => {
    dnd.manager = useDragDropManager()
    return null
  }
  return {
    ...actual,
    DragDropRoot: ({ children, ...props }: ComponentProps<typeof actual.DragDropRoot>) => (
      <actual.DragDropRoot {...props}>
        <ManagerProbe />
        {children}
      </actual.DragDropRoot>
    )
  }
})

const createBase = (name: string, index: number, groupId: string | null = null): KnowledgeBaseListItem => ({
  id: name,
  name,
  orderKey: `a${index}`,
  groupId,
  itemCount: 0,
  embeddingModelId: null,
  dimensions: null,
  chunkSize: 1024,
  chunkOverlap: 200,
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
  status: 'completed',
  error: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z'
})

const createGroup = (id: string, name: string, orderKey: string): Group => ({
  id,
  entityType: 'knowledge',
  name,
  orderKey,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z'
})

const ROW_TOP = 100
const ROW_PITCH = 36
const ROW_HEIGHT = 32
const rects = new WeakMap<Element, DOMRect>()

// jsdom has no layout: rows stack in DOM order at the production row height and gap, a group spans its
// header and bases, and the overlay opens over the row it carries and follows the drag.
function layOutRows() {
  let top = ROW_TOP
  const sections: Array<{ element: Element; top: number }> = []
  for (const element of document.querySelectorAll('[data-knowledge-group-id], [data-knowledge-base-id]')) {
    rects.set(element, new DOMRect(0, top, 240, ROW_HEIGHT))
    if (element.hasAttribute('data-knowledge-group-id')) sections.push({ element, top })
    top += ROW_PITCH
  }
  for (const [index, section] of sections.entries()) {
    const bottom = (sections[index + 1]?.top ?? top) - (ROW_PITCH - ROW_HEIGHT)
    rects.set(section.element, new DOMRect(0, section.top, 240, bottom - section.top))
  }
}

beforeAll(installDndDomStubs)

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const operation = dnd.manager?.dragOperation
    const sourceRect = operation?.source?.element && rects.get(operation.source.element)
    if (this.hasAttribute('data-dnd-overlay') && sourceRect && operation) {
      const { x, y } = operation.transform
      return new DOMRect(sourceRect.x + x, sourceRect.y + y, sourceRect.width, sourceRect.height)
    }
    return rects.get(this) ?? new DOMRect(0, 0, 800, 600)
  })
})

afterEach(() => vi.restoreAllMocks())

// jsdom never fires the observers that measure drop targets, so measure them the way the browser would.
function measureDropTargets() {
  act(() => {
    for (const droppable of dnd.manager?.registry.droppables ?? []) {
      ;(droppable as typeof droppable & { refreshShape: () => void }).refreshShape()
    }
  })
}

function renderNavigator({ bases, groups = [] }: { bases: KnowledgeBaseListItem[]; groups?: Group[] }) {
  const onReorderBase = vi.fn(async () => {})
  const onReorderGroup = vi.fn(async () => {})
  const onSelectBase = vi.fn()
  render(
    <BaseNavigator
      bases={bases}
      groups={groups}
      selectedBaseId="A"
      isLoading={false}
      width={250}
      onReorderBase={onReorderBase}
      onReorderGroup={onReorderGroup}
      onSelectBase={onSelectBase}
      onCreateGroup={vi.fn()}
      onCreateBase={vi.fn()}
      onMoveBase={vi.fn()}
      onRenameBase={vi.fn()}
      onRenameGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
      onDeleteBase={vi.fn()}
      onResizeStart={vi.fn()}
    />
  )
  layOutRows()
  return { onReorderBase, onReorderGroup, onSelectBase }
}

const flatBases = ['A', 'B', 'C'].map((name, index) => createBase(name, index))
const row = (id: string) => document.querySelector(`[data-knowledge-base-id="${id}"]`)

async function pickUp(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  screen.getByRole('button', { name }).focus()
  await user.keyboard('[Space]')
  await waitFor(() => expect(dnd.manager?.dragOperation.status.dragging).toBe(true))
  measureDropTargets()
}

describe('knowledge base keyboard ordering', () => {
  it.each([
    ['C', 'ArrowUp', 'B', { before: 'B' }],
    ['B', 'ArrowUp', 'A', { before: 'A' }],
    ['A', 'ArrowDown', 'B', { after: 'B' }],
    ['B', 'ArrowDown', 'C', { after: 'C' }]
  ] as const)('moves %s with %s across %s', async (name, key, target, anchor) => {
    const { onReorderBase } = renderNavigator({ bases: flatBases })
    const user = userEvent.setup()

    await pickUp(user, name)
    await user.keyboard(`{${key}}`)
    const side = 'before' in anchor ? 'before:bg-primary' : 'after:bg-primary'
    await waitFor(() => expect(row(target)).toHaveClass(side))
    await user.keyboard('[Space]')

    await waitFor(() => expect(onReorderBase).toHaveBeenCalledWith(name, { groupId: null, anchor }))
  })

  it('selects a base with Enter instead of picking it up', async () => {
    const { onSelectBase } = renderNavigator({ bases: flatBases })
    const user = userEvent.setup()

    screen.getByRole('button', { name: 'B' }).focus()
    await user.keyboard('{Enter}')

    expect(onSelectBase).toHaveBeenCalledExactlyOnceWith('B')
    expect(dnd.manager?.dragOperation.status.idle).toBe(true)
  })

  it('saves nothing when Escape cancels the drag', async () => {
    const { onReorderBase } = renderNavigator({ bases: flatBases })
    const user = userEvent.setup()

    await pickUp(user, 'A')
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(row('B')).toHaveClass('after:bg-primary'))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(row('B')).not.toHaveClass('after:bg-primary'))
    expect(onReorderBase).not.toHaveBeenCalled()
  })

  it('saves nothing when the window loses focus mid-drag', async () => {
    const { onReorderBase } = renderNavigator({ bases: flatBases })
    const user = userEvent.setup()

    await pickUp(user, 'A')
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(row('B')).toHaveClass('after:bg-primary'))
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    await waitFor(() => expect(dnd.manager?.dragOperation.status.idle).toBe(true))
    expect(onReorderBase).not.toHaveBeenCalled()
  })
})

describe('knowledge base pointer ordering', () => {
  it.each([
    ['A', 116, 144, { before: 'B' }],
    ['C', 188, 160, { after: 'B' }]
  ] as const)('uses the drop position when moving %s over B', async (name, startY, dropY, anchor) => {
    const { onReorderBase } = renderNavigator({ bases: flatBases })
    const user = userEvent.setup()
    await user.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('button', { name }),
      coords: { clientX: 100, clientY: startY }
    })
    await user.pointer({ target: document.body, coords: { clientX: 110, clientY: startY } })
    await waitFor(() => expect(dnd.manager?.dragOperation.status.dragging).toBe(true))
    measureDropTargets()
    await user.pointer({ target: document.body, coords: { clientX: 110, clientY: dropY } })
    await waitFor(() => expect(row('B')).toHaveClass('before' in anchor ? 'before:bg-primary' : 'after:bg-primary'))
    await user.pointer({ keys: '[/MouseLeft]' })

    await waitFor(() => expect(onReorderBase).toHaveBeenCalledWith(name, { groupId: null, anchor }))
  })
})

describe('knowledge base ordering across groups', () => {
  const groups = [createGroup('research', 'Research', 'a0'), createGroup('archive', 'Archive', 'a1')]
  // Rows top to bottom: ungrouped section, Research, A, B, Archive, C.
  const groupedBases = [createBase('A', 0, 'research'), createBase('B', 1, 'research'), createBase('C', 2, 'archive')]

  it('moves a base into a group by dropping it on the group header', async () => {
    const { onReorderBase } = renderNavigator({ bases: groupedBases, groups })
    const user = userEvent.setup()

    await pickUp(user, 'A')
    act(() => void dnd.manager?.actions.setDropTarget('group:archive'))
    await waitFor(() =>
      expect(document.querySelector('[data-knowledge-group-id="archive"]')).toHaveClass('ring-primary')
    )
    await user.keyboard('[Space]')

    await waitFor(() =>
      expect(onReorderBase).toHaveBeenCalledExactlyOnceWith('A', {
        groupId: 'archive',
        anchor: { position: 'last' }
      })
    )
  })

  it('moves a base before a row of another group', async () => {
    const { onReorderBase } = renderNavigator({ bases: groupedBases, groups })
    const user = userEvent.setup()

    await pickUp(user, 'C')
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(row('B')).toHaveClass('before:bg-primary'))
    await user.keyboard('[Space]')

    await waitFor(() =>
      expect(onReorderBase).toHaveBeenCalledExactlyOnceWith('C', { groupId: 'research', anchor: { before: 'B' } })
    )
  })

  it('reorders groups', async () => {
    const { onReorderGroup } = renderNavigator({ bases: groupedBases, groups })
    const user = userEvent.setup()

    await pickUp(user, /Research/)
    act(() => void dnd.manager?.actions.setDropTarget('group:archive'))
    await user.keyboard('[Space]')

    await waitFor(() => expect(onReorderGroup).toHaveBeenCalledExactlyOnceWith('research', { after: 'archive' }))
  })
})
