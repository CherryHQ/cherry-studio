import { describe, expect, it, vi } from 'vitest'

import { executeSessionMenuAction, resolveSessionMenuActions, type SessionActionContext } from '../sessionItemActions'

const t = ((key: string) => key) as SessionActionContext['t']

const exportMenuOptions: SessionActionContext['exportMenuOptions'] = {
  docx: true,
  image: true,
  joplin: true,
  markdown: true,
  markdown_reason: true,
  notes: true,
  notion: true,
  obsidian: true,
  plain_text: true,
  siyuan: true,
  yuque: true
}

function createSessionActionFixture(overrides: Partial<SessionActionContext> = {}): SessionActionContext {
  return {
    exportMenuOptions,
    isActiveInCurrentTab: false,
    onAutoRename: vi.fn(),
    onCopyImage: vi.fn(),
    onCopyMarkdown: vi.fn(),
    onCopyPlainText: vi.fn(),
    onDelete: vi.fn(),
    onExportImage: vi.fn(),
    onExportJoplin: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportMarkdownReason: vi.fn(),
    onExportNotion: vi.fn(),
    onExportObsidian: vi.fn(),
    onExportSiyuan: vi.fn(),
    onExportWord: vi.fn(),
    onExportYuque: vi.fn(),
    onSaveToKnowledge: vi.fn(),
    onSaveToNotes: vi.fn(),
    onSetPanePosition: vi.fn(),
    panePosition: 'left',
    pinned: false,
    sessionName: 'Session title',
    startEdit: vi.fn(),
    t,
    ...overrides
  }
}

describe('session item actions', () => {
  it('resolves rename and delete actions without pin when pin callback is absent', () => {
    const actions = resolveSessionMenuActions(createSessionActionFixture())

    expect(actions.map((action) => action.id)).toEqual([
      'session.auto-rename',
      'session.rename',
      'session.position',
      'session.save-notes',
      'session.save-knowledge',
      'session.export',
      'session.copy',
      'session.delete'
    ])
  })

  it('resolves pin label from pinned state and executes callbacks without agent editing', async () => {
    const onTogglePin = vi.fn()
    const startEdit = vi.fn()
    const actionContext = createSessionActionFixture({
      onTogglePin,
      pinned: true,
      startEdit
    })
    const actions = resolveSessionMenuActions(actionContext)

    expect(actions.map((action) => action.id)).toEqual([
      'session.auto-rename',
      'session.rename',
      'session.toggle-pin',
      'session.position',
      'session.save-notes',
      'session.save-knowledge',
      'session.export',
      'session.copy'
    ])
    expect(actions.find((action) => action.id === 'session.auto-rename')?.label).toBe('agent.session.auto_rename')
    expect(actions.find((action) => action.id === 'session.rename')?.label).toBe('common.rename')
    expect(actions.find((action) => action.id === 'session.toggle-pin')?.label).toBe('agent.session.unpin.title')

    const renameAction = actions.find((action) => action.id === 'session.rename')
    const pinAction = actions.find((action) => action.id === 'session.toggle-pin')
    await executeSessionMenuAction(renameAction as (typeof actions)[number], actionContext)
    await executeSessionMenuAction(pinAction as (typeof actions)[number], actionContext)

    expect(startEdit).toHaveBeenCalledWith('Session title')
    expect(onTogglePin).toHaveBeenCalled()
  })

  it('hides open-in-new-tab when the session is already active in the current tab', () => {
    const actions = resolveSessionMenuActions(
      createSessionActionFixture({
        isActiveInCurrentTab: true,
        onOpenInNewTab: vi.fn()
      })
    )

    expect(actions.map((action) => action.id)).toEqual([
      'session.auto-rename',
      'session.rename',
      'session.position',
      'session.save-notes',
      'session.save-knowledge',
      'session.export',
      'session.copy',
      'session.delete'
    ])
  })

  it('keeps open-in-new-window available even when the session is active in the current tab', async () => {
    const onOpenInNewWindow = vi.fn()
    const actionContext = createSessionActionFixture({
      isActiveInCurrentTab: true,
      onOpenInNewWindow
    })
    const actions = resolveSessionMenuActions(actionContext)

    expect(actions.map((action) => action.id)).toEqual([
      'session.auto-rename',
      'session.rename',
      'session.position',
      'session.open-in-new-window',
      'session.save-notes',
      'session.save-knowledge',
      'session.export',
      'session.copy',
      'session.delete'
    ])

    const action = actions.find((candidate) => candidate.id === 'session.open-in-new-window')
    await executeSessionMenuAction(action as (typeof actions)[number], actionContext)
    expect(onOpenInNewWindow).toHaveBeenCalled()
  })

  it('sets the pane position from the position submenu', async () => {
    const onSetPanePosition = vi.fn()
    const actionContext = createSessionActionFixture({ onSetPanePosition })
    const actions = resolveSessionMenuActions(actionContext)
    const positionAction = actions.find((action) => action.id === 'session.position')
    const rightAction = positionAction?.children.find((action) => action.id === 'session.position-right')

    expect(positionAction?.label).toBe('settings.agent.position.label')
    expect(rightAction?.availability.enabled).toBe(true)

    await executeSessionMenuAction(rightAction as (typeof actions)[number], actionContext)

    expect(onSetPanePosition).toHaveBeenCalledWith('right')
  })

  it('sets the pane position back to left from the right pane state', async () => {
    const onSetPanePosition = vi.fn()
    const actionContext = createSessionActionFixture({ onSetPanePosition, panePosition: 'right' })
    const actions = resolveSessionMenuActions(actionContext)
    const positionAction = actions.find((action) => action.id === 'session.position')
    const leftAction = positionAction?.children.find((action) => action.id === 'session.position-left')

    expect(leftAction?.availability.enabled).toBe(true)

    await executeSessionMenuAction(leftAction as (typeof actions)[number], actionContext)

    expect(onSetPanePosition).toHaveBeenCalledWith('left')
  })

  it('uses localized cancel text for the delete confirmation', () => {
    const actions = resolveSessionMenuActions(createSessionActionFixture())
    const deleteAction = actions.find((action) => action.id === 'session.delete')

    expect(deleteAction?.confirm?.cancelText).toBe('common.cancel')
  })

  it('respects export menu preferences for notes and copy actions', () => {
    const actions = resolveSessionMenuActions(
      createSessionActionFixture({
        exportMenuOptions: {
          ...exportMenuOptions,
          image: false,
          notes: false,
          plain_text: false
        }
      })
    )

    expect(actions.map((action) => action.id)).not.toContain('session.save-notes')

    const copyAction = actions.find((action) => action.id === 'session.copy')
    expect(copyAction?.children.map((action) => action.id)).toEqual(['session.copy.markdown'])

    const exportAction = actions.find((action) => action.id === 'session.export')
    expect(exportAction?.children.map((action) => action.id)).not.toContain('session.export.image')
  })
})
