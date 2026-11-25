import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { resolveAssistantGroupActions } from '../assistantGroupActions'

const t = ((key: string) => key) as TFunction

describe('assistant group permanent delete hint', () => {
  it('shows the configured shortcut on the permanent delete action', () => {
    const actions = resolveAssistantGroupActions({
      assistantId: 'ada',
      assistantIconType: 'emoji',
      isGroupGrouping: false,
      onDeleteAssistant: vi.fn(),
      onDeleteAllTopics: vi.fn(),
      onPermanentDeleteAssistant: vi.fn(),
      permanentDeleteShortcut: '⌘⌫',
      onEdit: vi.fn(),
      onSetAssistantIconType: vi.fn(),
      onToggleGrouping: vi.fn(),
      onTogglePin: vi.fn(),
      onToggleSidebar: vi.fn(),
      pinned: true,
      sidebarPinned: false,
      t
    })

    expect(actions.find((action) => action.id === 'assistant-group.delete-assistant-permanently')).toMatchObject({
      danger: true,
      shortcut: '⌘⌫'
    })
    expect(actions.find((action) => action.id === 'assistant-group.archive-assistant')?.shortcut).toBeUndefined()
  })
})
