import type { QuickPanelContextType, QuickPanelListItem } from '@renderer/components/QuickPanel'
import { describe, expect, it, vi } from 'vitest'

import { createUnifiedQuickPanelOpenOptions } from '../unifiedPanel'

const quickPanel = {
  open: vi.fn(),
  close: vi.fn(),
  updateItemSelection: vi.fn(),
  updateList: vi.fn(),
  isVisible: false,
  symbol: '',
  list: [],
  defaultIndex: 0,
  pageSize: 7,
  multiple: false,
  fillToAvailableHeight: false,
  setFillToAvailableHeight: vi.fn(),
  dispatchKeyDown: vi.fn(() => false),
  getPanelGeneration: vi.fn(() => 0),
  registerKeyDownHandler: vi.fn(() => () => undefined)
} satisfies QuickPanelContextType

const labels = (items: QuickPanelListItem[]) => items.map((item) => item.label)

describe('createUnifiedQuickPanelOpenOptions', () => {
  it('keeps system actions above resource results while preserving business order during search', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'attachment',
          kind: 'command',
          label: 'Attachment',
          description: 'notes',
          icon: 'paperclip',
          sources: ['popover']
        },
        {
          id: 'slash-command',
          kind: 'command',
          label: 'Slash command',
          description: 'notes',
          icon: 'slash',
          sources: ['root-panel']
        }
      ],
      {
        quickPanel,
        leadingItems: [{ id: 'new-topic', label: 'New topic', filterText: 'notes', icon: 'plus' }],
        additionalItems: [{ id: 'agent-skill', label: 'Agent skill', filterText: 'notes', icon: 'skill' }],
        resourceItems: [{ id: 'file:notes', label: 'notes.md', description: '/workspace/notes.md', icon: 'file' }]
      }
    )

    expect(options.sortFn).toEqual(expect.any(Function))

    const reversedItems = [...options.list].reverse()
    expect(labels(options.sortFn!(reversedItems, 'notes'))).toEqual([
      'New topic',
      'Attachment',
      'Slash command',
      'Agent skill',
      'notes.md'
    ])
  })

  it('does not reorder items when there is no search text', () => {
    const options = createUnifiedQuickPanelOpenOptions(
      [
        {
          id: 'attachment',
          kind: 'command',
          label: 'Attachment',
          icon: 'paperclip',
          sources: ['popover']
        }
      ],
      {
        quickPanel,
        resourceItems: [{ id: 'file:notes', label: 'notes.md', description: '/workspace/notes.md', icon: 'file' }]
      }
    )

    const reversedItems = [...options.list].reverse()
    expect(options.sortFn!(reversedItems, '')).toEqual(reversedItems)
  })
})
