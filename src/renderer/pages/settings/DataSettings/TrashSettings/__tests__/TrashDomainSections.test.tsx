// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PendingPermanentDelete } from '../TrashSection'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mocks = vi.hoisted(() => ({
  pagesByPath: new Map<string, Array<{ items: unknown[]; nextCursor?: string }>>(),
  paginatedItemsByPath: new Map<string, unknown[]>(),
  mutate: vi.fn(),
  mutationOptions: new Map<string, { refresh?: (context: { args?: any }) => string[] }>(),
  refresh: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
  ipcRequest: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInfiniteQuery: (path: string) => ({
    pages: mocks.pagesByPath.get(path) ?? [],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: mocks.refresh
  }),
  useInfiniteFlatItems: (pages: Array<{ items: unknown[] }>) => pages.flatMap((page) => page.items),
  usePaginatedQuery: (path: string) => ({
    items: mocks.paginatedItemsByPath.get(path) ?? [],
    total: mocks.paginatedItemsByPath.get(path)?.length ?? 0,
    page: 1,
    isLoading: false,
    error: undefined,
    hasNext: false,
    hasPrev: false,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    refresh: mocks.refresh
  }),
  useDataChange: vi.fn(),
  useInvalidateCache: () => mocks.invalidate,
  useMutation: (method: string, path: string, options?: { refresh?: (context: { args?: any }) => string[] }) => {
    mocks.mutationOptions.set(`${method} ${path}`, options ?? {})
    return { trigger: (args?: unknown) => mocks.mutate(method, path, args) }
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

const {
  AgentTrashSection,
  AssistantTrashSection,
  FileTrashSection,
  PaintingTrashSection,
  SessionTrashSection,
  TopicTrashSection
} = await import('../TrashDomainSections')

function deletedTopic(id: string, name: string) {
  return { id, name, deletedAt: '2026-08-01T00:00:00.000Z' }
}

function deletedFile(id: string, name: string) {
  return {
    id,
    name,
    ext: 'md',
    origin: 'internal',
    deletedAt: 1_750_000_000_000
  }
}

type DomainSection = ComponentType<{
  retentionDays: number
  isBatchMode: boolean
  isPermanentDeleting: boolean
  onRequestDelete: (request: PendingPermanentDelete) => void
}>

interface DataDomainCase {
  label: string
  Component: DomainSection
  listPath: string
  deletePath: string
  paginated: boolean
  makeRecord: (id: string, name: string) => Record<string, unknown>
}

const dataDomainCases: DataDomainCase[] = [
  {
    label: 'Topic',
    Component: TopicTrashSection,
    listPath: '/topics',
    deletePath: '/topics/:id',
    paginated: false,
    makeRecord: deletedTopic
  },
  {
    label: 'Assistant',
    Component: AssistantTrashSection,
    listPath: '/assistants',
    deletePath: '/assistants/:id',
    paginated: true,
    makeRecord: deletedTopic
  },
  {
    label: 'Painting',
    Component: PaintingTrashSection,
    listPath: '/paintings',
    deletePath: '/paintings/:id',
    paginated: false,
    makeRecord: (id, name) => ({ id, prompt: name, deletedAt: '2026-08-01T00:00:00.000Z' })
  }
]

function setDomainRecords(testCase: DataDomainCase, records: Record<string, unknown>[]) {
  if (testCase.paginated) mocks.paginatedItemsByPath.set(testCase.listPath, records)
  else mocks.pagesByPath.set(testCase.listPath, [{ items: records }])
}

async function runPendingRequest(pending: PendingPermanentDelete | undefined) {
  if (!pending) throw new Error('Permanent-delete request was not created')
  let outcome
  await act(async () => {
    outcome = await pending.run(pending.items)
  })
  return outcome
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  mocks.pagesByPath.clear()
  mocks.paginatedItemsByPath.clear()
  mocks.mutate.mockReset().mockResolvedValue(undefined)
  mocks.mutationOptions.clear()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.invalidate.mockReset().mockResolvedValue(undefined)
  mocks.ipcRequest.mockReset()
  vi.mocked(dataApiService.get).mockReset()
})

describe('Trash domain batch adapters', () => {
  it('refreshes topics when restoring an assistant', () => {
    render(
      <AssistantTrashSection
        retentionDays={30}
        isBatchMode={false}
        isPermanentDeleting={false}
        onRequestDelete={vi.fn()}
      />
    )

    const refresh = mocks.mutationOptions.get('POST /assistants/:id/restore')?.refresh

    expect(refresh?.({ args: { params: { id: 'assistant-1' } } })).toEqual([
      '/assistants',
      '/assistants/assistant-1',
      '/topics'
    ])
  })

  it.each(dataDomainCases)(
    '$label batch permanent delete uses its direct route, refreshes once, and keeps a stale failure selected',
    async (testCase) => {
      const user = userEvent.setup()
      const firstId = `${testCase.label.toLowerCase()}-1`
      const staleId = `${testCase.label.toLowerCase()}-stale`
      const failedId = `${testCase.label.toLowerCase()}-failed`
      setDomainRecords(testCase, [
        testCase.makeRecord(firstId, `First ${testCase.label}`),
        testCase.makeRecord(staleId, `Stale ${testCase.label}`),
        testCase.makeRecord(failedId, `Failed ${testCase.label}`)
      ])
      mocks.mutate.mockImplementation(async (_method, _path, args) => {
        if (args.params.id === staleId) throw DataApiErrorFactory.notFound(testCase.label, staleId)
        if (args.params.id === failedId) throw new Error('permission denied')
      })
      let pending: PendingPermanentDelete | undefined
      render(
        <testCase.Component
          retentionDays={30}
          isBatchMode
          isPermanentDeleting={false}
          onRequestDelete={(request) => {
            pending = request
          }}
        />
      )
      await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
      await user.click(screen.getByRole('button', { name: 'Delete Permanently 3' }))

      const outcome = await runPendingRequest(pending)

      expect(mocks.mutate.mock.calls).toEqual([
        ['DELETE', testCase.deletePath, { params: { id: firstId }, query: { permanent: true } }],
        ['DELETE', testCase.deletePath, { params: { id: staleId }, query: { permanent: true } }],
        ['DELETE', testCase.deletePath, { params: { id: failedId }, query: { permanent: true } }]
      ])
      expect(outcome).toEqual({
        succeeded: [firstId],
        failed: [
          {
            id: staleId,
            error: 'No longer in the Recycle Bin. Refresh and try again.',
            reason: 'no-longer-in-recycle-bin'
          },
          { id: failedId, error: 'permission denied' }
        ]
      })
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
      expect(screen.getByText('2 selected')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: `Select Stale ${testCase.label}` })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: `Select Failed ${testCase.label}` })).toBeChecked()
      expect(toast.warning).toHaveBeenCalledOnce()
      expect(toast.warning).toHaveBeenCalledWith(
        'Permanently deleted: 1; no longer in the Recycle Bin: 1; other failures: 1'
      )
      expect(toast.info).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    }
  )

  it.each(dataDomainCases)(
    '$label single permanent delete refreshes and keeps a selected stale row for retry',
    async (testCase) => {
      const user = userEvent.setup()
      const staleId = `${testCase.label.toLowerCase()}-stale`
      setDomainRecords(testCase, [testCase.makeRecord(staleId, `Stale ${testCase.label}`)])
      mocks.mutate.mockRejectedValueOnce(DataApiErrorFactory.notFound(testCase.label, staleId))
      let pending: PendingPermanentDelete | undefined
      render(
        <testCase.Component
          retentionDays={30}
          isBatchMode
          isPermanentDeleting={false}
          onRequestDelete={(request) => {
            pending = request
          }}
        />
      )
      await user.click(screen.getByRole('checkbox', { name: `Select Stale ${testCase.label}` }))
      await user.click(screen.getByRole('button', { name: 'Delete Permanently' }))

      const outcome = await runPendingRequest(pending)

      expect(mocks.mutate).toHaveBeenCalledWith('DELETE', testCase.deletePath, {
        params: { id: staleId },
        query: { permanent: true }
      })
      expect(outcome).toEqual({
        succeeded: [],
        failed: [
          {
            id: staleId,
            error: 'No longer in the Recycle Bin. Refresh and try again.',
            reason: 'no-longer-in-recycle-bin'
          }
        ]
      })
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('checkbox', { name: `Select Stale ${testCase.label}` })).toBeChecked()
      expect(toast.info).toHaveBeenCalledOnce()
      expect(toast.info).toHaveBeenCalledWith('No longer in the Recycle Bin. Refresh and try again.')
      expect(toast.warning).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    }
  )

  it('reports an all-stale Topic batch in one user-visible summary', async () => {
    const user = userEvent.setup()
    mocks.pagesByPath.set('/topics', [
      { items: [deletedTopic('topic-stale-1', 'Stale one'), deletedTopic('topic-stale-2', 'Stale two')] }
    ])
    mocks.mutate.mockImplementation(async (_method, _path, args) => {
      throw DataApiErrorFactory.notFound('Topic', args.params.id)
    })
    let pending: PendingPermanentDelete | undefined
    render(
      <TopicTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 2' }))

    await runPendingRequest(pending)

    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith(
      'Permanently deleted: 0; no longer in the Recycle Bin: 2; other failures: 0'
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('sequentially sends exact Agent permanent-delete commands and keeps a false result as stale', async () => {
    const user = userEvent.setup()
    mocks.paginatedItemsByPath.set('/agents', [
      { id: 'agent-1', name: 'First agent', deletedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'agent-2', name: 'Second agent', deletedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'agent-3', name: 'Third agent', deletedAt: '2026-08-01T00:00:00.000Z' }
    ])
    mocks.ipcRequest.mockImplementation(async (_route, input) => {
      if (input.agentId === 'agent-3') throw new Error('agent failed')
      return { deleted: input.agentId === 'agent-1' }
    })
    let pending: PendingPermanentDelete | undefined
    render(
      <AgentTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 3' }))

    const outcome = await runPendingRequest(pending)

    expect(mocks.ipcRequest.mock.calls).toEqual([
      ['ai.agent.delete', { agentId: 'agent-1', deleteSessions: false, permanent: true }],
      ['ai.agent.delete', { agentId: 'agent-2', deleteSessions: false, permanent: true }],
      ['ai.agent.delete', { agentId: 'agent-3', deleteSessions: false, permanent: true }]
    ])
    expect(outcome).toEqual({
      succeeded: ['agent-1'],
      failed: [
        {
          id: 'agent-2',
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        },
        { id: 'agent-3', error: 'agent failed' }
      ]
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(['/agents', '/agent-sessions'])
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Second agent' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Third agent' })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith(
      'Permanently deleted: 1; no longer in the Recycle Bin: 1; other failures: 1'
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('sequentially sends exact Session permanent-delete commands and keeps an empty result as stale', async () => {
    const user = userEvent.setup()
    mocks.pagesByPath.set('/agent-sessions', [
      {
        items: [
          { id: 'session-1', name: 'First session', deletedAt: '2026-08-01T00:00:00.000Z' },
          { id: 'session-2', name: 'Second session', deletedAt: '2026-08-01T00:00:00.000Z' },
          { id: 'session-3', name: 'Third session', deletedAt: '2026-08-01T00:00:00.000Z' }
        ]
      }
    ])
    mocks.ipcRequest.mockImplementation(async (_route, input) => {
      if (input.sessionIds[0] === 'session-3') throw new Error('session failed')
      return { deletedIds: input.sessionIds[0] === 'session-1' ? ['session-1'] : [] }
    })
    let pending: PendingPermanentDelete | undefined
    render(
      <SessionTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 3' }))

    const outcome = await runPendingRequest(pending)

    expect(mocks.ipcRequest.mock.calls).toEqual([
      ['ai.agent.session.delete', { sessionIds: ['session-1'], permanent: true }],
      ['ai.agent.session.delete', { sessionIds: ['session-2'], permanent: true }],
      ['ai.agent.session.delete', { sessionIds: ['session-3'], permanent: true }]
    ])
    expect(outcome).toEqual({
      succeeded: ['session-1'],
      failed: [
        {
          id: 'session-2',
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        },
        { id: 'session-3', error: 'session failed' }
      ]
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(['/agent-sessions', '/agents/*'])
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Second session' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Third session' })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith(
      'Permanently deleted: 1; no longer in the Recycle Bin: 1; other failures: 1'
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'Agent',
      Component: AgentTrashSection,
      listPath: '/agents',
      record: { id: 'agent-stale', name: 'Stale agent', deletedAt: '2026-08-01T00:00:00.000Z' },
      request: ['ai.agent.delete', { agentId: 'agent-stale', deleteSessions: false, permanent: true }] as const,
      response: { deleted: false },
      invalidatePaths: ['/agents', '/agent-sessions'],
      checkboxName: 'Select Stale agent'
    },
    {
      label: 'Session',
      Component: SessionTrashSection,
      listPath: '/agent-sessions',
      record: { id: 'session-stale', name: 'Stale session', deletedAt: '2026-08-01T00:00:00.000Z' },
      request: ['ai.agent.session.delete', { sessionIds: ['session-stale'], permanent: true }] as const,
      response: { deletedIds: [] },
      invalidatePaths: ['/agent-sessions', '/agents/*'],
      checkboxName: 'Select Stale session'
    }
  ])('$label single permanent delete reports a resolved negative result as stale', async (testCase) => {
    const user = userEvent.setup()
    if (testCase.listPath === '/agents') mocks.paginatedItemsByPath.set(testCase.listPath, [testCase.record])
    else mocks.pagesByPath.set(testCase.listPath, [{ items: [testCase.record] }])
    mocks.ipcRequest.mockResolvedValueOnce(testCase.response)
    let pending: PendingPermanentDelete | undefined
    render(
      <testCase.Component
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: testCase.checkboxName }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }))

    const outcome = await runPendingRequest(pending)

    expect(mocks.ipcRequest).toHaveBeenCalledWith(...testCase.request)
    expect(outcome).toEqual({
      succeeded: [],
      failed: [
        {
          id: testCase.record.id,
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        }
      ]
    })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(mocks.invalidate).toHaveBeenCalledWith(testCase.invalidatePaths)
    expect(screen.getByRole('checkbox', { name: testCase.checkboxName })).toBeChecked()
    expect(toast.info).toHaveBeenCalledOnce()
    expect(toast.info).toHaveBeenCalledWith('No longer in the Recycle Bin. Refresh and try again.')
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('treats restore NOT_FOUND as complete after refresh confirms the Topic is active', async () => {
    const user = userEvent.setup()
    mocks.pagesByPath.set('/topics', [{ items: [deletedTopic('topic-1', 'First topic')] }])
    mocks.mutate.mockImplementation(async (method) => {
      if (method === 'POST') throw DataApiErrorFactory.notFound('Topic', 'topic-1')
    })
    vi.mocked(dataApiService.get).mockResolvedValueOnce(deletedTopic('topic-1', 'First topic') as never)
    render(<TopicTrashSection retentionDays={30} isBatchMode isPermanentDeleting={false} onRequestDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-1'))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith('Restored')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('chunks 501 File permanent deletes and classifies a missing rejected item as stale', async () => {
    const user = userEvent.setup()
    const files = Array.from({ length: 501 }, (_, index) => deletedFile(`file-${index}`, `File ${index}`))
    const ids = files.map((file) => file.id)
    mocks.pagesByPath.set('/files/entries', [{ items: files }])
    mocks.ipcRequest.mockImplementation(async (route, input) => {
      if (route !== 'file.batch_permanent_delete_from_trash') throw new Error(`Unexpected route: ${route}`)
      const chunkIds = input.ids as string[]
      if (chunkIds.length === 1) throw new Error('second chunk unavailable')
      return { succeeded: chunkIds, failed: [] }
    })
    vi.mocked(dataApiService.get).mockRejectedValue(DataApiErrorFactory.notFound('FileEntry', ids[500]))
    let pending: PendingPermanentDelete | undefined
    render(
      <FileTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 501' }))

    const outcome = await runPendingRequest(pending)

    expect(pending?.fileEntryIds).toEqual(ids)
    const permanentCalls = mocks.ipcRequest.mock.calls.filter(
      ([route]) => route === 'file.batch_permanent_delete_from_trash'
    )
    expect(permanentCalls).toEqual([
      ['file.batch_permanent_delete_from_trash', { ids: ids.slice(0, 500) }],
      ['file.batch_permanent_delete_from_trash', { ids: ids.slice(500) }]
    ])
    expect(outcome).toEqual({
      succeeded: ids.slice(0, 500),
      failed: [
        {
          id: ids[500],
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        }
      ]
    })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(mocks.invalidate).toHaveBeenCalledWith(['/files/entries'])
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select File 500.md' })).toBeChecked()
    expect(toast.warning).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith(
      'Permanently deleted: 500; no longer in the Recycle Bin: 1; other failures: 0'
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reports a single missing File permanent-delete failure as no longer in the Recycle Bin', async () => {
    const user = userEvent.setup()
    const file = deletedFile('file-missing', 'Missing')
    mocks.pagesByPath.set('/files/entries', [{ items: [file] }])
    mocks.ipcRequest.mockResolvedValueOnce({
      succeeded: [],
      failed: [{ id: file.id, error: 'not found' }]
    })
    vi.mocked(dataApiService.get).mockRejectedValueOnce(DataApiErrorFactory.notFound('FileEntry', file.id))
    let pending: PendingPermanentDelete | undefined
    render(
      <FileTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select Missing.md' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }))

    const outcome = await runPendingRequest(pending)

    expect(outcome).toEqual({
      succeeded: [],
      failed: [
        {
          id: file.id,
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        }
      ]
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(['/files/entries'])
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dataApiService.get).mock.invocationCallOrder[0]
    )
    expect(toast.info).toHaveBeenCalledOnce()
    expect(toast.info).toHaveBeenCalledWith('No longer in the Recycle Bin. Refresh and try again.')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('chunks 501 File restores and counts a failed final item as complete only when it is active', async () => {
    const user = userEvent.setup()
    const files = Array.from({ length: 501 }, (_, index) => deletedFile(`file-${index}`, `File ${index}`))
    const ids = files.map((file) => file.id)
    mocks.pagesByPath.set('/files/entries', [{ items: files }])
    mocks.ipcRequest.mockImplementation(async (route, input) => {
      if (route !== 'file.batch_restore') throw new Error(`Unexpected route: ${route}`)
      const chunkIds = input.ids as string[]
      return chunkIds.length === 1
        ? { succeeded: [], failed: [{ id: chunkIds[0], error: 'not found' }] }
        : { succeeded: chunkIds, failed: [] }
    })
    vi.mocked(dataApiService.get).mockResolvedValue({ ...files[500], deletedAt: undefined } as never)
    render(<FileTrashSection retentionDays={30} isBatchMode isPermanentDeleting={false} onRequestDelete={vi.fn()} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))

    await user.click(screen.getByRole('button', { name: 'Restore 501' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored 501 items'))
    const restoreCalls = mocks.ipcRequest.mock.calls.filter(([route]) => route === 'file.batch_restore')
    expect(restoreCalls).toEqual([
      ['file.batch_restore', { ids: ids.slice(0, 500) }],
      ['file.batch_restore', { ids: ids.slice(500) }]
    ])
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(dataApiService.get).toHaveBeenCalledWith(`/files/entries/${ids[500]}`)
    expect(toast.success).toHaveBeenCalledOnce()
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps a missing File restore as a real failure after refreshing the trash list', async () => {
    const user = userEvent.setup()
    const file = deletedFile('file-missing', 'Missing')
    mocks.pagesByPath.set('/files/entries', [{ items: [file] }])
    mocks.ipcRequest.mockResolvedValueOnce({
      succeeded: [],
      failed: [{ id: file.id, error: 'not found' }]
    })
    vi.mocked(dataApiService.get).mockRejectedValueOnce(DataApiErrorFactory.notFound('FileEntry', file.id))
    render(<FileTrashSection retentionDays={30} isBatchMode isPermanentDeleting={false} onRequestDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to restore'))
    expect(mocks.invalidate).toHaveBeenCalledWith(['/files/entries', '/files/entries/*'])
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dataApiService.get).mock.invocationCallOrder[0]
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('classifies only an active File permanent-delete failure as stale after invalidation', async () => {
    const user = userEvent.setup()
    const active = deletedFile('file-active', 'Active')
    const referenced = deletedFile('file-referenced', 'Referenced')
    mocks.pagesByPath.set('/files/entries', [{ items: [active, referenced] }])
    mocks.ipcRequest.mockResolvedValueOnce({
      succeeded: [],
      failed: [
        { id: active.id, error: 'not in trash' },
        { id: referenced.id, error: 'still referenced' }
      ]
    })
    vi.mocked(dataApiService.get).mockImplementation((path) =>
      path === `/files/entries/${active.id}`
        ? Promise.resolve({ ...active, deletedAt: undefined } as never)
        : Promise.resolve(referenced as never)
    )
    let pending: PendingPermanentDelete | undefined
    render(
      <FileTrashSection
        retentionDays={30}
        isBatchMode
        isPermanentDeleting={false}
        onRequestDelete={(request) => {
          pending = request
        }}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible items' }))
    await user.click(screen.getByRole('button', { name: 'Delete Permanently 2' }))

    const outcome = await runPendingRequest(pending)

    expect(outcome).toEqual({
      succeeded: [],
      failed: [
        {
          id: active.id,
          error: 'No longer in the Recycle Bin. Refresh and try again.',
          reason: 'no-longer-in-recycle-bin'
        },
        { id: referenced.id, error: 'still referenced' }
      ]
    })
    expect(mocks.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dataApiService.get).mock.invocationCallOrder[0]
    )
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith(
      'Permanently deleted: 0; no longer in the Recycle Bin: 1; other failures: 1'
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
