import type * as CherryStudioUi from '@cherrystudio/ui'
import { ResourceList } from '@renderer/components/chat/resourceList/base'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import SessionItem, { type SessionItemMenuActions } from '../SessionItem'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/chat/actions/ResourceListActionContextMenu', () => ({
  ResourceListActionContextMenu: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useOptionalRightPanelActions: () => undefined,
  useOptionalRightPanelState: () => undefined
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [[]]
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: undefined,
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
        'common.delete': 'Delete',
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
  it('requires the shared Recycle Bin confirmation before deleting', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const Provider = ResourceList.Provider<AgentSessionEntity>

    render(
      <Provider items={[session]} selectedId={session.id}>
        <SessionItem
          session={session}
          sessionMenuActions={sessionMenuActions}
          onDelete={onDelete}
          onOpenRenameDialog={vi.fn()}
          onPress={vi.fn()}
        />
      </Provider>
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Move to Recycle Bin?')

    await user.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))

    expect(onDelete).toHaveBeenCalledWith('session-a')
  })
})
