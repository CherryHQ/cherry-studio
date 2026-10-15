import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'

import { BaseNavigator } from '../navigator'

vi.unmock('@cherrystudio/ui')

const bases: KnowledgeBaseListItem[] = ['A', 'B', 'C'].map((name, index) => ({
  id: name,
  name,
  orderKey: `a${index}`,
  groupId: null,
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
}))

beforeEach(() => {
  // jsdom has no layout; give the real sortable sensor the production row height and gap.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.closest('[data-knowledge-base-id]')?.getAttribute('data-knowledge-base-id')
    const index = bases.findIndex((base) => base.id === (id ?? this.textContent))
    return index >= 0 ? new DOMRect(0, 100 + index * 36, 240, 32) : new DOMRect(0, 0, 800, 600)
  })
})

afterEach(() => vi.restoreAllMocks())

function renderNavigator() {
  const onReorderBase = vi.fn(async () => {})
  render(
    <BaseNavigator
      bases={bases}
      groups={[]}
      selectedBaseId="A"
      isLoading={false}
      width={250}
      onReorderBase={onReorderBase}
      onReorderGroup={vi.fn(async () => {})}
      onSelectBase={vi.fn()}
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
  return onReorderBase
}

describe('knowledge base keyboard ordering', () => {
  it.each([
    ['C', 'ArrowUp', 'B', { before: 'B' }],
    ['B', 'ArrowUp', 'A', { before: 'A' }],
    ['A', 'ArrowDown', 'B', { after: 'B' }],
    ['B', 'ArrowDown', 'C', { after: 'C' }]
  ] as const)('moves %s with %s across %s', async (name, key, target, anchor) => {
    const onReorderBase = renderNavigator()
    const user = userEvent.setup()
    screen.getByRole('button', { name }).focus()

    await user.keyboard('[Space]')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`over droppable area base:${name}`))
    await user.keyboard(`{${key}}`)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`over droppable area base:${target}`))
    await user.keyboard('[Space]')

    await waitFor(() => expect(onReorderBase).toHaveBeenCalledWith(name, { groupId: null, anchor }))
  })
})

describe('knowledge base pointer ordering', () => {
  it.each([
    ['A', 116, 144, { before: 'B' }],
    ['C', 188, 160, { after: 'B' }]
  ] as const)('uses the drop position when moving %s over B', async (name, startY, dropY, anchor) => {
    const onReorderBase = renderNavigator()
    const user = userEvent.setup()
    await user.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('button', { name }),
      coords: { clientX: 100, clientY: startY }
    })
    await user.pointer({ target: document.body, coords: { clientX: 110, clientY: startY } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`over droppable area base:${name}`))
    await user.pointer({ target: document.body, coords: { clientX: 110, clientY: dropY } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('over droppable area base:B'))
    await user.pointer({ keys: '[/MouseLeft]' })

    await waitFor(() => expect(onReorderBase).toHaveBeenCalledWith(name, { groupId: null, anchor }))
  })
})
