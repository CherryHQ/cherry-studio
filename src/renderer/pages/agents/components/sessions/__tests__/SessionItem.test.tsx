import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import { SessionHoverPreviewGroup } from '@renderer/components/chat/resourceList/SessionHoverPreview'
import * as topicStreamStatus from '@renderer/hooks/useTopicStreamStatus'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import SessionItem, { type SessionItemMenuActions } from '../SessionItem'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/chat/actions/ResourceListActionContextMenu', () => ({
  ResourceListActionContextMenu: ({
    children,
    getActions,
    onAction
  }: {
    children: ReactNode
    getActions: () => Array<{
      id: string
      label: string
      shortcut?: string
      availability: { enabled: boolean; visible: boolean }
    }>
    onAction: (action: { id: string }) => void | Promise<void>
  }) => (
    <>
      {children}
      {getActions()
        .filter((action) => action.availability.visible)
        .map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            disabled={!action.availability.enabled}
            onClick={() => void onAction(action)}>
            {action.label}
            {action.shortcut ? <span>{action.shortcut}</span> : null}
          </button>
        ))}
    </>
  )
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useOptionalRightPanelActions: () => undefined,
  useOptionalRightPanelState: () => undefined
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: undefined,
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    isFulfilled: false,
    isPending: false,
    markSeen: vi.fn()
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'common.select': 'Select',
        'common.archive': 'Archive',
        'recycle_bin.move.confirm_action': 'Move to Recycle Bin',
        'recycle_bin.move.confirm_title': 'Move to Recycle Bin?'
      })[key] ?? key
  })
}))

const session: AgentSessionEntity = {
  id: 'session-a',
  agentId: 'agent-a',
  name: 'Session A',
  isNameManuallyEdited: true,
  workspaceId: 'workspace-a',
  workspace: {
    id: 'workspace-a',
    name: 'Workspace A',
    path: '/workspace-a',
    type: 'user',
    orderKey: 'a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  orderKey: 'a',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const sessionMenuActions = Object.fromEntries(
  [
    'onAutoRename',
    'onCopyImage',
    'onCopyMarkdown',
    'onCopyPlainText',
    'onExportImage',
    'onExportJoplin',
    'onExportMarkdown',
    'onExportMarkdownReason',
    'onExportNotion',
    'onExportObsidian',
    'onExportSiyuan',
    'onExportWord',
    'onExportYuque',
    'onSaveToKnowledge',
    'onSaveToNotes'
  ].map((name) => [name, vi.fn()])
) as unknown as SessionItemMenuActions
sessionMenuActions.exportMenuOptions = {
  docx: false,
  image: false,
  joplin: false,
  markdown: false,
  markdown_reason: false,
  notion: false,
  obsidian: false,
  plain_text: false,
  siyuan: false,
  yuque: false
}

describe('SessionItem', () => {
  it('selects from the checkbox without opening the session', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    const onToggleSelection = vi.fn()
    const Provider = ResourceList.Provider<AgentSessionEntity>

    render(
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode
            onDelete={vi.fn()}
            onOpenRenameDialog={vi.fn()}
            onPress={onPress}
            onToggleSelection={onToggleSelection}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    await user.click(screen.getByRole('checkbox', { name: 'Select: Session A' }))

    expect(onToggleSelection).toHaveBeenCalledWith('session-a', true)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('shows the number shortcut in place of the stream status until the hint clears', () => {
    using statusSpy = vi.spyOn(topicStreamStatus, 'useTopicStreamStatus')
    statusSpy.mockReturnValue({
      status: 'error',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      isFulfilled: false,
      isPending: false,
      lastCompletedAt: null,
      markSeen: vi.fn()
    })
    const Provider = ResourceList.Provider<AgentSessionEntity>
    const row = (shortcutHint?: string) => (
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode={false}
            onToggleSelection={vi.fn()}
            shortcutHint={shortcutHint}
            onDelete={vi.fn()}
            onOpenRenameDialog={vi.fn()}
            onPress={vi.fn()}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    const { rerender } = render(row())
    expect(screen.getByRole('img', { name: 'message.tools.status.error' })).toBeInTheDocument()

    rerender(row('⌘3'))
    expect(screen.getByText('⌘3')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'message.tools.status.error' })).not.toBeInTheDocument()

    rerender(row())
    expect(screen.getByRole('img', { name: 'message.tools.status.error' })).toBeInTheDocument()
  })

  it.each([false, true])('archives through the hover action without permanent deletion (pinned=%s)', async (pinned) => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const Provider = ResourceList.Provider<AgentSessionEntity>

    render(
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            pinned={pinned}
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode={false}
            onToggleSelection={vi.fn()}
            onDelete={onDelete}
            onOpenRenameDialog={vi.fn()}
            onPress={vi.fn()}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(onDelete).toHaveBeenCalledWith('session-a')
    expect(screen.queryByRole('menuitem', { name: /common.delete_permanently/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers permanent delete with the supplied shortcut and leaves archive untouched', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onDeletePermanently = vi.fn()
    const Provider = ResourceList.Provider<AgentSessionEntity>

    render(
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode={false}
            onToggleSelection={vi.fn()}
            onDelete={onDelete}
            onDeletePermanently={onDeletePermanently}
            permanentDeleteShortcut="Ctrl+Backspace"
            onOpenRenameDialog={vi.fn()}
            onPress={vi.fn()}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    const permanentDelete = screen.getByRole('menuitem', { name: /common.delete_permanently/ })
    expect(permanentDelete).toHaveTextContent('Ctrl+Backspace')
    expect(permanentDelete).toBeEnabled()

    await user.click(permanentDelete)

    expect(onDeletePermanently).toHaveBeenCalledOnce()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('hides permanent delete on a pinned row and refuses it while a delete is in flight', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const onDeletePermanently = vi.fn()
    const Provider = ResourceList.Provider<AgentSessionEntity>

    const { rerender } = render(
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode={false}
            onToggleSelection={vi.fn()}
            pinned
            onDelete={onDelete}
            onDeletePermanently={onDeletePermanently}
            permanentDeleteShortcut="Ctrl+Backspace"
            onOpenRenameDialog={vi.fn()}
            onPress={vi.fn()}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    expect(screen.queryByRole('menuitem', { name: /common.delete_permanently/ })).not.toBeInTheDocument()
    expect(onDeletePermanently).not.toHaveBeenCalled()

    rerender(
      <Provider items={[session]} selectedId={session.id}>
        <SessionHoverPreviewGroup>
          <SessionItem
            session={session}
            sessionMenuActions={sessionMenuActions}
            isSelected={false}
            isSelectionMode={false}
            onToggleSelection={vi.fn()}
            isDeleting
            onDelete={onDelete}
            onDeletePermanently={onDeletePermanently}
            permanentDeleteShortcut="Ctrl+Backspace"
            onOpenRenameDialog={vi.fn()}
            onPress={vi.fn()}
          />
        </SessionHoverPreviewGroup>
      </Provider>
    )

    const permanentDelete = screen.getByRole('menuitem', { name: /common.delete_permanently/ })
    expect(permanentDelete).toBeDisabled()
    await user.click(permanentDelete)
    expect(onDeletePermanently).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})
