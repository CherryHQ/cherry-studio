import { installDndDomStubs } from '@test-mocks/dndDomStubs'
import { cancelRowDrag, dropRow, hoverRow, startRowDrag, withManagerProbe } from '@test-mocks/dndDriver'
import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { getI18n } from 'react-i18next'
import { beforeAll, expect, it, vi } from 'vitest'

import type * as DragDropRootModule from '@cherrystudio/ui/components/composites/sortable/drag-drop-root'
import { PopupHost } from '@renderer/components/PopupHost'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { MinimalAgentList } from '../MinimalAgentList'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('@renderer/services/popup')
vi.mock('@cherrystudio/ui/components/composites/sortable/drag-drop-root', async (importOriginal) => {
  const module = await importOriginal<typeof DragDropRootModule>()
  return { ...module, DragDropRoot: withManagerProbe(module.DragDropRoot) }
})
vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: [
      { id: 'b', name: 'Researcher', type: 'pi', orderKey: 'a1' },
      { id: 'a', name: 'Writer', type: 'pi', orderKey: 'a0' },
      { id: 'c', name: 'Planner', type: 'pi', orderKey: 'a2' },
      { id: 'd', name: 'Reviewer', type: 'claude-code', orderKey: 'a3', configuration: { builtin_role: 'support' } },
      { id: 'legacy', name: 'Unavailable', type: 'local', orderKey: 'a4' }
    ],
    refetch: async () => undefined
  })
}))

beforeAll(installDndDomStubs)

const session = (id: string, agentId: string, date: string) =>
  ({ id, agentId, lastActivityAt: date }) as AgentSessionEntity
const sessions = [
  session('old', 'a', '2026-01-01'),
  session('latest', 'a', '2026-02-01'),
  session('other', 'b', '2026-01-15')
]

function Harness({
  loadLatestSession,
  createSession = async (agentId) => session(`new:${agentId}`, agentId, '2026-03-01'),
  initialSessionId = 'none',
  dataEnabled = true,
  externalDestination
}: {
  loadLatestSession: (agentId?: string | null) => Promise<AgentSessionEntity | null>
  createSession?: (agentId: string) => Promise<AgentSessionEntity>
  initialSessionId?: string
  dataEnabled?: boolean
  externalDestination?: string
}) {
  const [selection, setSelection] = useState(initialSessionId)
  return (
    <>
      <MinimalAgentList
        source={{ sessions, loadLatestSession, isFullyLoaded: true, reload: async () => {} }}
        dataEnabled={dataEnabled}
        activeSessionId={selection === 'none' ? null : selection}
        onSelect={(selected) => setSelection(selected.id)}
        onCreate={createSession}
        onActiveAgentDeleted={() => setSelection('other')}
      />
      {externalDestination && (
        <button type="button" onClick={() => setSelection(externalDestination)}>
          Navigate outside the sidebar
        </button>
      )}
      <output aria-label="Current conversation">{selection}</output>
    </>
  )
}

it('keeps a later sidebar selection after an earlier new task finishes creating', async () => {
  const user = userEvent.setup()
  const creation = Promise.withResolvers<AgentSessionEntity>()
  const started = Promise.withResolvers<void>()
  render(
    <Harness
      initialSessionId="latest"
      loadLatestSession={async (id) => (id === 'b' ? sessions[2] : null)}
      createSession={() => {
        started.resolve()
        return creation.promise
      }}
    />
  )
  await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Writer' }) })
  await user.click(screen.getByRole('menuitem', { name: getI18n().t('agent.session.new') }))
  await started.promise
  await user.click(screen.getByRole('button', { name: 'Researcher' }))
  await waitFor(() => expect(screen.getByLabelText('Current conversation')).toHaveTextContent('other'))

  await act(async () => creation.resolve(session('new:a', 'a', '2026-03-01')))
  expect(screen.getByLabelText('Current conversation')).toHaveTextContent('other')
})

it.each([null, sessions[1]])('ignores an old latest-session lookup after external navigation (%o)', async (result) => {
  const user = userEvent.setup()
  const latest = Promise.withResolvers<AgentSessionEntity | null>()
  render(<Harness initialSessionId="latest" externalDestination="other" loadLatestSession={() => latest.promise} />)
  await user.click(screen.getByRole('button', { name: 'Writer' }))
  await user.click(screen.getByRole('button', { name: 'Navigate outside the sidebar' }))

  await act(async () => latest.resolve(result))
  expect(screen.getByLabelText('Current conversation')).toHaveTextContent('other')
})

it('saves keyboard reordering without another interactive row or a duplicate preview ID', async () => {
  render(<Harness loadLatestSession={async () => null} />)
  const descriptionId = screen.getByRole('button', { name: 'Writer' }).getAttribute('aria-describedby')
  expect(descriptionId).toBeTruthy()
  await startRowDrag('a')
  let dropped = false
  try {
    const overlay = document.querySelector<HTMLElement>('[data-dnd-overlay]')!
    expect(within(overlay).getByText('Writer')).toBeInTheDocument()
    expect(within(overlay).queryByRole('button', { hidden: true })).not.toBeInTheDocument()
    expect(document.querySelectorAll(`[id="${descriptionId}"]`)).toHaveLength(1)
    await hoverRow('b', 'after')
    await dropRow()
    dropped = true
    await waitFor(() =>
      expect(mockDataApiService.patch).toHaveBeenCalledWith(
        '/agents/a/order',
        expect.objectContaining({ body: { after: 'b' } })
      )
    )
  } finally {
    if (!dropped) await cancelRowDrag()
  }
})

it('shows available agents in their saved order and resumes their latest conversation', async () => {
  const user = userEvent.setup()
  render(<Harness loadLatestSession={async (id) => (id === 'a' ? sessions[1] : null)} />)
  expect(
    screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
      .map((button) => button.getAttribute('aria-label'))
  ).toEqual(['Writer', 'Researcher', 'Planner', 'Reviewer'])
  await user.click(screen.getByRole('button', { name: 'Writer' }))
  await waitFor(() => expect(screen.getByLabelText('Current conversation')).toHaveTextContent('latest'))
  await user.click(screen.getByRole('button', { name: 'Planner' }))
  expect(screen.getByLabelText('Current conversation')).toHaveTextContent('new:c')
})

it('refreshes completed reply previews only while the sidebar is open', async () => {
  const { Wrapper } = createSWRTestWrapper()
  const message = (role: 'assistant' | 'user', status: 'success' | 'pending', text: string) => ({
    role,
    status,
    data: { parts: [{ type: 'text', text }] }
  })
  const earlierReplies = [
    message('user', 'success', 'Do another draft'),
    message('assistant', 'pending', 'Draft in progress'),
    message('assistant', 'success', ''),
    message('assistant', 'success', '**Draft ready.**\n\nThree intros included.')
  ]
  let items = earlierReplies
  const readPreview = vi.fn((path: string) => {
    if (path === '/agent-sessions/latest/messages') return { items }
    if (path === '/agent-sessions/other/messages') return { items: [message('user', 'success', 'Start some research')] }
    return { items: [message('assistant', 'success', 'Results from another session')] }
  })
  const notifyWriterReply = () =>
    mockDataApiService._emitDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', routeParams: { sessionId: 'latest' }, kind: 'projection' }
    ])
  const list = (open: boolean) => <Harness dataEnabled={open} loadLatestSession={async () => null} />
  await mockDataApiService.get.withImplementation(
    async (path) => readPreview(path),
    async () => {
      const { rerender } = render(list(false), { wrapper: Wrapper })
      expect(readPreview).not.toHaveBeenCalled()

      rerender(list(true))
      const writer = screen.getByRole('button', { name: 'Writer' })
      const placeholder = getI18n().t('minimal.start_chat_prompt')
      await waitFor(() => expect(writer).toHaveAccessibleDescription('Draft ready. Three intros included.'))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Researcher' })).toHaveAccessibleDescription(placeholder)
      )
      expect(screen.getByRole('button', { name: 'Planner' })).toHaveAccessibleDescription(placeholder)

      items = [message('assistant', 'success', 'Second draft ready.'), ...items]
      await act(async () => notifyWriterReply())
      await waitFor(() => expect(writer).toHaveAccessibleDescription('Second draft ready.'))

      rerender(list(false))
      readPreview.mockClear()
      items = [message('assistant', 'success', 'Reply received while closed'), ...items]
      await act(async () => notifyWriterReply())
      expect(readPreview).not.toHaveBeenCalled()
      expect(writer).toHaveAccessibleDescription('Second draft ready.')

      rerender(list(true))
      await waitFor(() => expect(writer).toHaveAccessibleDescription('Reply received while closed'))
    }
  )
})

it('opens actions for the right-clicked agent without changing the current conversation', async () => {
  const user = userEvent.setup()
  const editing = Promise.withResolvers<unknown>()
  const unsubscribe = EventEmitter.on(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, editing.resolve)
  try {
    render(<Harness initialSessionId="latest" loadLatestSession={async () => null} />)
    const researcher = screen.getByRole('button', { name: 'Researcher' })
    const { t } = getI18n()

    await user.pointer({ keys: '[MouseRight]', target: researcher })
    await user.click(screen.getByRole('menuitem', { name: t('agent.edit.title') }))
    await expect(editing.promise).resolves.toEqual({ kind: 'agent', id: 'b' })
    expect(screen.getByRole('button', { name: 'Writer', pressed: true })).toBeVisible()

    await user.pointer({ keys: '[MouseRight]', target: researcher })
    expect(screen.getByLabelText('Current conversation')).toHaveTextContent('latest')
    await user.click(screen.getByRole('menuitem', { name: t('agent.session.new') }))
    await waitFor(() => expect(screen.getByLabelText('Current conversation')).toHaveTextContent('new:b'))
  } finally {
    unsubscribe()
  }
})

it.each([false, true])(
  'archives the right-clicked Agent with the chosen conversation scope (archive conversations: %s)',
  async (deleteSessions) => {
    const user = userEvent.setup()
    const { t } = getI18n()
    const request = vi
      .spyOn(ipcApi, 'request')
      .mockResolvedValue({ deleted: true, deletedSessionIds: deleteSessions ? ['latest'] : [] })
    try {
      render(
        <>
          <Harness initialSessionId="latest" loadLatestSession={async () => null} />
          <PopupHost />
        </>
      )
      await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Writer' }) })
      expect(screen.queryByRole('menuitem', { name: t('agent.session.archive.trigger') })).not.toBeInTheDocument()
      await user.click(screen.getByRole('menuitem', { name: t('common.archive') }))
      const dialog = await screen.findByRole('dialog')
      expect(request).not.toHaveBeenCalled()
      if (deleteSessions) {
        await user.click(
          within(dialog).getByRole('checkbox', { name: t('conversation_owner.archive.related_sessions') })
        )
      }
      await user.click(within(dialog).getByRole('button', { name: t('common.archive') }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(request).toHaveBeenCalledExactlyOnceWith('ai.agent.delete', { agentId: 'a', deleteSessions })
      expect(screen.getByLabelText('Current conversation')).toHaveTextContent(deleteSessions ? 'other' : 'latest')
    } finally {
      request.mockRestore()
    }
  }
)

it('protects a built-in Agent from being archived', async () => {
  const user = userEvent.setup()
  const { t } = getI18n()
  render(<Harness loadLatestSession={async () => null} />)
  await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Reviewer' }) })
  expect(screen.queryByRole('menuitem', { name: t('common.archive') })).not.toBeInTheDocument()
})

it('does not create another conversation while a switch is waiting for the target history', async () => {
  const user = userEvent.setup()
  const { Wrapper } = createSWRTestWrapper()
  const history = Promise.withResolvers<{ items: [] }>()
  const historyRequested = Promise.withResolvers<void>()
  await mockDataApiService.get.withImplementation(
    async (path, options) => {
      if (path === '/agent-sessions/latest/messages' && options?.query?.limit === 50) {
        historyRequested.resolve()
        return history.promise
      }
      return { items: [] }
    },
    async () => {
      render(<Harness initialSessionId="other" loadLatestSession={async (id) => (id === 'a' ? sessions[1] : null)} />, {
        wrapper: Wrapper
      })
      await user.click(screen.getByRole('button', { name: 'Writer' }))
      expect(screen.getByRole('button', { name: 'Researcher', pressed: true })).toBeVisible()
      await historyRequested.promise
      await user.click(screen.getByRole('button', { name: 'Planner' }))
      expect(screen.getByLabelText('Current conversation')).toHaveTextContent('other')

      await act(async () => history.resolve({ items: [] }))
      expect(screen.getByRole('button', { name: 'Writer', pressed: true })).toBeVisible()
    }
  )
})
