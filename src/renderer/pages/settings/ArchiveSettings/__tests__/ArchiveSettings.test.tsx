// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import type { FileRef } from '@shared/data/types/file'

import type { ArchiveItem } from '../archive'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mocks = vi.hoisted(() => ({
  fileItems: [] as ArchiveItem[],
  allItems: [] as ArchiveItem[],
  hideItems: false,
  isLoading: false,
  ipcRequest: vi.fn(),
  deleteItem: vi.fn(),
  deleteItems: vi.fn(),
  runDelete: vi
    .fn()
    .mockResolvedValue({ succeeded: [] as string[], failed: [] as Array<{ id: string; error: string }> })
}))

vi.mock('../ArchiveDomainSections', async () => {
  const React = await import('react')
  const { default: ArchiveSection } = await import('../ArchiveSection')
  const topic = { id: 'topic-1', name: 'Deleted topic', deletedAt: 1_750_000_000_000 }
  const session = { id: 'session-1', name: 'Deleted session', deletedAt: 1_750_000_000_000 }

  const buildSelectionSection = (item: ArchiveItem | null) =>
    function SelectionSection(props: {
      retentionDays: number
      onRequestDelete: (request: unknown) => void
      batchToolbarContainer?: HTMLDivElement | null
      isBatchMode: boolean
      onBatchAvailabilityChange?: (available: boolean) => void
      isPermanentDeleting: boolean
    }) {
      return React.createElement(ArchiveSection, {
        items: item && !mocks.hideItems ? [item] : [],
        isLoading: mocks.isLoading,
        onBatchAvailabilityChange: props.onBatchAvailabilityChange,
        error: undefined,
        onRetry: vi.fn(),
        retentionDays: props.retentionDays,
        isBatchMode: props.isBatchMode,
        batchToolbarContainer: props.batchToolbarContainer,
        pendingRestoreId: null,
        isPermanentDeleting: props.isPermanentDeleting,
        onRestore: vi.fn(),
        onRestoreMany: vi.fn().mockResolvedValue({ succeeded: item ? [item.id] : [], failed: [] }),
        onPermanentDelete: mocks.deleteItem,
        onPermanentDeleteMany: mocks.deleteItems,
        onRequestDelete: props.onRequestDelete
      })
    }

  function FileSection(props: { onRequestDelete: (request: unknown) => void }) {
    return React.createElement(
      'button',
      {
        type: 'button',
        onClick: () =>
          props.onRequestDelete({
            items: mocks.fileItems,
            fileEntryIds: mocks.fileItems.map((item) => item.id),
            run: mocks.runDelete
          })
      },
      'Open file permanent delete'
    )
  }

  const TopicSection = buildSelectionSection(topic)
  const SessionSection = buildSelectionSection(session)
  const EmptySection = buildSelectionSection(null)
  return {
    TopicArchiveSection: TopicSection,
    AgentArchiveSection: EmptySection,
    SessionArchiveSection: SessionSection,
    AssistantArchiveSection: EmptySection,
    PaintingArchiveSection: EmptySection,
    FileArchiveSection: FileSection
  }
})
vi.mock('../AllArchiveSection', async () => {
  const React = await import('react')
  const { TopicArchiveSection, SessionArchiveSection } = await import('../ArchiveDomainSections')
  return {
    default: (props: React.ComponentProps<typeof TopicArchiveSection>) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(TopicArchiveSection, props),
        React.createElement(SessionArchiveSection, props),
        mocks.allItems.length > 0 &&
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () =>
                props.onRequestDelete({
                  items: mocks.allItems,
                  fileEntryIds: mocks.allItems
                    .filter((item) => item.id.startsWith('files:'))
                    .map((item) => item.id.slice(6)),
                  run: mocks.runDelete
                })
            },
            'Open all permanent delete'
          )
      )
  }
})
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))

const { default: ArchiveSettings } = await import('../ArchiveSettings')

function fileItems(count: number): ArchiveItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `019a0000-0000-7000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    name: `File ${index + 1}`,
    deletedAt: 1_750_000_000_000 + index
  }))
}

const [FILE_ID, FILE_2_ID, FILE_3_ID] = fileItems(3).map((item) => item.id)
const JOB_ID = '019a0000-0000-7000-9000-000000000001'
const PAINTING_ID = '019a0000-0000-4000-9000-000000000002'
const RELEASE =
  'Image-generation job references are released automatically when the job record is cleaned up, normally about 7 days after the job finishes; older records can be removed sooner and cleanup may be delayed. This file becomes eligible for background cleanup only after every reference is released, and other references can still block deletion.'

function jobRef(role: 'input' | 'mask' = 'input', fileEntryId = FILE_ID): FileRef {
  return {
    id: `${role === 'input' ? 'a' : 'b'}0000000-0000-4000-8000-${fileEntryId.slice(-12)}`,
    fileEntryId,
    sourceType: 'job',
    sourceId: JOB_ID,
    role,
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_000_000
  }
}

function mockReferenceReads({
  counts = [{ entryId: FILE_ID, refCount: 1 }],
  refs = { [FILE_ID]: [jobRef()] },
  jobs = { [JOB_ID]: 'image-generation.generate' }
}: {
  counts?: Array<{ entryId: string; refCount: number }> | (() => Promise<Array<{ entryId: string; refCount: number }>>)
  refs?: Record<string, FileRef[] | Error | Promise<FileRef[]> | (() => FileRef[] | Promise<FileRef[]>)>
  jobs?: Record<string, string | Error | Promise<string> | (() => string | Promise<string>)>
} = {}) {
  vi.mocked(dataApiService.get).mockImplementation(async (path) => {
    if (path === '/files/entries/ref-counts') return (typeof counts === 'function' ? await counts() : counts) as never
    const entryId = Object.keys(refs).find((id) => path === `/files/entries/${id}/refs`)
    if (entryId) {
      const response = refs[entryId]
      if (response instanceof Error) throw response
      return (typeof response === 'function' ? await response() : await response) as never
    }
    const jobId = Object.keys(jobs).find((id) => path === `/jobs/${id}`)
    if (jobId) {
      const response = jobs[jobId]
      if (response instanceof Error) throw response
      return { type: typeof response === 'function' ? await response() : await response } as never
    }
    throw new Error(`Unexpected read: ${path}`)
  })
}

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, next: string) {
  await user.click(screen.getByRole('tab', { name: next }))
}

async function openFileDelete(user: ReturnType<typeof userEvent.setup>) {
  await chooseCategory(user, 'Files')
  await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  MockUsePreferenceUtils.resetMocks()
  vi.mocked(dataApiService.get).mockReset()
  mocks.ipcRequest.mockReset()
  mocks.deleteItem.mockReset().mockResolvedValue({ succeeded: ['topic-1'], failed: [] })
  mocks.deleteItems.mockReset().mockResolvedValue({ succeeded: ['topic-1'], failed: [] })
  mocks.runDelete.mockReset().mockResolvedValue({ succeeded: [], failed: [] })
  mocks.fileItems = fileItems(1)
  mocks.allItems = []
  mocks.hideItems = false
  mocks.isLoading = false
})

describe('ArchiveSettings', () => {
  it('defaults to All and returns to the combined list after filtering', async () => {
    const user = userEvent.setup()
    render(<ArchiveSettings />)
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Deleted topic')).toBeVisible()
    expect(screen.getByText('Deleted session')).toBeVisible()
    await chooseCategory(user, 'Topics')
    expect(screen.queryByText('Deleted session')).not.toBeInTheDocument()
    await chooseCategory(user, 'All')
    expect(screen.getByText('Deleted topic')).toBeVisible()
    expect(screen.getByText('Deleted session')).toBeVisible()
  })

  it('keeps the cleanup preference editable from its settings row without deleting items', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('data.trash.retention_days', 30)
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    const retention = screen.getByRole('group', { name: 'Auto-cleanup interval' })
    await user.click(within(retention).getByRole('button', { name: '30 days' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forever' }))

    expect(MockUsePreferenceUtils.getPreferenceValue('data.trash.retention_days')).toBe(0)
    expect(screen.getByText('Deleted topic')).toBeInTheDocument()
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.deleteItem).not.toHaveBeenCalled()
    expect(mocks.deleteItems).not.toHaveBeenCalled()
  })

  it('switches visible category tabs by click and keyboard with localized labels', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('zh-CN')
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    const tabs = within(screen.getByRole('tablist', { name: '归档' }))
    for (const name of ['全部', '助手', '智能体', '话题', '任务', '绘图', '文件']) {
      expect(tabs.getByRole('tab', { name })).toBeVisible()
    }
    expect(screen.getByRole('tabpanel', { name: '话题' })).toHaveTextContent('Deleted topic')

    await user.click(tabs.getByRole('tab', { name: '任务' }))
    expect(screen.getByRole('tabpanel', { name: '任务' })).toHaveTextContent('Deleted session')
    expect(screen.queryByText('Deleted topic')).not.toBeInTheDocument()

    await user.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(tabs.getByRole('tab', { name: '话题' })).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: '话题' })).toHaveTextContent('Deleted topic')
    expect(screen.queryByText('Deleted session')).not.toBeInTheDocument()
  })

  it('only enables batch management for loaded content in the current category', async () => {
    const user = userEvent.setup()
    mocks.isLoading = true
    const { rerender } = render(<ArchiveSettings />)
    await chooseCategory(user, 'Topics')
    const manage = screen.getByRole('button', { name: 'Batch manage' })
    expect(manage).toBeDisabled()

    mocks.isLoading = false
    mocks.hideItems = true
    rerender(<ArchiveSettings />)
    expect(manage).toBeDisabled()
    await user.click(manage)
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()

    mocks.hideItems = false
    rerender(<ArchiveSettings />)
    expect(manage).toBeEnabled()
    await chooseCategory(user, 'Assistants')
    expect(manage).toBeDisabled()
    await chooseCategory(user, 'Topics')
    expect(manage).toBeEnabled()

    await user.click(manage)
    mocks.hideItems = true
    rerender(<ArchiveSettings />)
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done).toBeEnabled()
    await user.click(done)
    expect(screen.getByRole('button', { name: 'Batch manage' })).toBeDisabled()
  })

  it('reports referenced files kept instead of claiming the trash is empty', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValueOnce({
      status: 'completed',
      reclaimed: true,
      deletedCount: 3,
      retainedReferencedFileCount: 2
    })
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    expect(screen.queryByRole('menuitem', { name: 'Empty Archive' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Empty Archive' }))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Empty Archive' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Referenced files will be kept.')
    await user.click(within(dialog).getByRole('button', { name: 'Empty Archive' }))

    expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('trash.purge_now')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted: 3. Referenced files kept: 2.'))
  })
})

describe('ArchiveSettings permanent-delete confirmation', () => {
  it.each(['single', 'batch'] as const)(
    'requires confirmation before %s topic deletion and leaves cancellation harmless',
    async (mode) => {
      const user = userEvent.setup()
      render(<ArchiveSettings />)
      await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')
      if (mode === 'batch') {
        await user.click(screen.getByRole('button', { name: 'Batch manage' }))
        await user.click(screen.getByRole('checkbox', { name: 'Select Deleted topic' }))
      }
      const deleteLabel = mode === 'batch' ? 'Delete Permanently 1' : 'Delete Permanently'
      await user.click(screen.getByRole('button', { name: deleteLabel }))
      expect(screen.getByRole('dialog')).toHaveTextContent('This action cannot be undone.')
      expect(mocks.deleteItem).not.toHaveBeenCalled()
      expect(mocks.deleteItems).not.toHaveBeenCalled()

      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByText('Deleted topic')).toBeInTheDocument()
      expect(mocks.deleteItem).not.toHaveBeenCalled()
      expect(mocks.deleteItems).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: deleteLabel }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Permanently' }))
      const topic = { id: 'topic-1', name: 'Deleted topic', deletedAt: 1_750_000_000_000 }
      if (mode === 'batch') {
        expect(mocks.deleteItems).toHaveBeenCalledExactlyOnceWith([topic])
        expect(mocks.deleteItem).not.toHaveBeenCalled()
      } else {
        expect(mocks.deleteItem).toHaveBeenCalledExactlyOnceWith(topic)
        expect(mocks.deleteItems).not.toHaveBeenCalled()
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  )

  it('replaces category navigation with batch controls until batch mode ends', async () => {
    const user = userEvent.setup()
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    expect(screen.queryByRole('checkbox', { name: 'Select Deleted topic' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Batch manage' }))
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('checkbox', { name: 'Select all visible items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently 0' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Deleted topic' }))
    expect(screen.getByRole('button', { name: 'Restore 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled()

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    const panel = screen.getByRole('tabpanel')
    expect(panel).not.toContainElement(screen.getByRole('button', { name: 'Restore 1' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Restore 1' })).not.toBeInTheDocument()
    await chooseCategory(user, 'Tasks')
    await user.click(screen.getByRole('button', { name: 'Batch manage' }))

    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Deleted session' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Deleted session' }))
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Select Deleted session' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Batch manage' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('checkbox', { name: 'Select Deleted session' })).not.toBeInTheDocument()
  })

  it('shows the single-item title and waits for a fresh file reference preview', async () => {
    const user = userEvent.setup()
    let resolveCounts!: (value: Array<{ entryId: string; refCount: number }>) => void
    vi.mocked(dataApiService.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCounts = resolve
      }) as never
    )
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    await openFileDelete(user)

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete permanently?')
    expect(screen.getByRole('dialog')).toHaveTextContent('This action cannot be undone.')
    const confirm = screen.getByRole('button', { name: 'Delete Permanently' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText('Checking file references…')).toBeInTheDocument()

    resolveCounts([{ entryId: FILE_ID, refCount: 0 }])
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    expect(mocks.runDelete).toHaveBeenCalledWith(mocks.fileItems)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('chunks 501 selected file ids into 500 and 1 before enabling confirmation', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(501)
    vi.mocked(dataApiService.get).mockImplementation(async (path, options) => {
      if (path !== '/files/entries/ref-counts') throw new Error(`Unexpected detail read: ${path}`)
      return (options?.query?.entryIds ?? []).map((entryId) => ({ entryId, refCount: 0 }))
    })
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    await openFileDelete(user)

    expect(screen.getByRole('dialog')).toHaveTextContent('Permanently delete 501 items?')
    await waitFor(() => expect(dataApiService.get).toHaveBeenCalledTimes(2))
    expect(vi.mocked(dataApiService.get).mock.calls[0][1]?.query?.entryIds).toHaveLength(500)
    expect(vi.mocked(dataApiService.get).mock.calls[1][1]?.query?.entryIds).toHaveLength(1)
    const confirm = screen.getByRole('button', { name: 'Delete Permanently' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    expect(mocks.runDelete).toHaveBeenCalledWith(mocks.fileItems)
  })

  it('fails closed when any file reference chunk fails', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(501)
    vi.mocked(dataApiService.get)
      .mockResolvedValueOnce(mocks.fileItems.slice(0, 500).map(({ id }) => ({ entryId: id, refCount: 0 })))
      .mockRejectedValueOnce(new Error('second chunk unavailable'))
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(mocks.runDelete).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled for referenced files and reports both impact totals', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(3)
    mockReferenceReads({
      counts: [
        { entryId: FILE_ID, refCount: 2 },
        { entryId: FILE_2_ID, refCount: 0 },
        { entryId: FILE_3_ID, refCount: 4 }
      ],
      refs: {
        [FILE_ID]: [jobRef('input'), jobRef('mask')],
        [FILE_3_ID]: [
          jobRef('input', FILE_3_ID),
          jobRef('mask', FILE_3_ID),
          {
            ...jobRef('input', FILE_3_ID),
            id: 'c0000000-0000-4000-8000-000000000003',
            sourceType: 'painting',
            sourceId: PAINTING_ID,
            role: 'input'
          },
          {
            ...jobRef('input', FILE_3_ID),
            id: 'c0000000-0000-4000-8000-000000000004',
            sourceType: 'painting',
            sourceId: PAINTING_ID,
            role: 'output'
          }
        ]
      }
    })
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    await openFileDelete(user)

    expect(await screen.findByText(/2 files are still used by 6 records/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    expect(mocks.runDelete).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled after a preview error and retries explicitly', async () => {
    const user = userEvent.setup()
    vi.mocked(dataApiService.get)
      .mockRejectedValueOnce(new Error('ref counts unavailable'))
      .mockResolvedValueOnce([{ entryId: FILE_ID, refCount: 0 }])
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')

    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry reference check' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled())
    expect(dataApiService.get).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a successful reference preview after closing and reopening', async () => {
    const user = userEvent.setup()
    let preview = 0
    mockReferenceReads({ counts: async () => [{ entryId: FILE_ID, refCount: preview++ === 0 ? 0 : 1 }] })
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')
    await openFileDelete(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))

    expect(await screen.findByText(`Image-generation job record ${JOB_ID} (input image)`)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it('ignores an old preview response after closing, switching category, and reopening', async () => {
    const user = userEvent.setup()
    let resolveOld!: (value: Array<{ entryId: string; refCount: number }>) => void
    let preview = 0
    mockReferenceReads({
      counts: async () =>
        preview++ === 0
          ? new Promise((resolve) => {
              resolveOld = resolve
            })
          : [{ entryId: FILE_ID, refCount: 3 }]
    })
    render(<ArchiveSettings />)
    await chooseCategory(user, i18n.language === 'zh-CN' ? '话题' : 'Topics')
    await openFileDelete(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await chooseCategory(user, 'Topics')
    await chooseCategory(user, 'Files')
    await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))
    expect(await screen.findByText(/1 file is still used by 3 records/)).toBeInTheDocument()

    await act(async () => resolveOld([{ entryId: FILE_ID, refCount: 0 }]))

    expect(screen.getByText(/1 file is still used by 3 records/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })
})

// A job-held archived image must explain which generation record blocks deletion and how it is released,
// without allowing deletion or concealing another holder.
describe('ArchiveSettings holder disclosure', () => {
  it.each(['input', 'mask'] as const)('names the image-generation record and its %s role', async (role) => {
    const user = userEvent.setup()
    mockReferenceReads({ refs: { [FILE_ID]: [jobRef(role)] } })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText(`Image-generation job record ${JOB_ID} (${role} image)`)).toBeVisible()
    expect(dialog).toHaveTextContent(
      '1 file is still used by 1 record and will be kept. Remove that reference before deleting permanently.'
    )
    expect(within(dialog).getByText('File 1')).toBeVisible()
    expect(within(dialog).getByText(RELEASE)).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it('keeps every association visible alongside one image-job policy paragraph', async () => {
    const user = userEvent.setup()
    const paintingRef: FileRef = {
      ...jobRef(),
      id: 'c0000000-0000-4000-8000-000000000003',
      sourceType: 'painting',
      sourceId: PAINTING_ID,
      role: 'output'
    }
    mockReferenceReads({
      counts: [{ entryId: FILE_ID, refCount: 3 }],
      refs: { [FILE_ID]: [jobRef(), jobRef('mask'), paintingRef] }
    })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText(`Image-generation job record ${JOB_ID} (input image)`)).toBeVisible()
    expect(screen.getByText(`Image-generation job record ${JOB_ID} (mask image)`)).toBeVisible()
    expect(screen.getByText(`Holding record ${PAINTING_ID} (source: painting, role: output)`)).toBeVisible()
    expect(screen.getAllByText(RELEASE)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it.each([
    [new Error('404: job not found'), `Job record ${JOB_ID} (details unavailable; role: input)`],
    ['other.generate', `Job record ${JOB_ID} (type: other.generate, role: input)`]
  ])('shows only known job details for %s', async (response, label) => {
    const user = userEvent.setup()
    mockReferenceReads({ jobs: { [JOB_ID]: response } })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.queryByText(RELEASE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it('discloses a roleless holder without inventing a role or an image-job policy', async () => {
    const user = userEvent.setup()
    mockReferenceReads({
      refs: {
        [FILE_ID]: [
          {
            id: 'd0000000-0000-4000-8000-000000000001',
            fileEntryId: FILE_ID,
            sourceType: 'provider_logo',
            sourceId: 'archived-provider',
            createdAt: 1_750_000_000_000,
            updatedAt: 1_750_000_000_000
          }
        ]
      }
    })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText('Holding record archived-provider (source: provider_logo, role: —)')).toBeVisible()
    expect(screen.queryByText(RELEASE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it('keeps refs failures blocked and retries the complete preview', async () => {
    const user = userEvent.setup()
    let available = false
    mockReferenceReads({
      refs: {
        [FILE_ID]: () => {
          if (!available) throw new Error('refs unavailable')
          return [jobRef()]
        }
      }
    })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    available = true
    await user.click(screen.getByRole('button', { name: 'Retry reference check' }))
    expect(await screen.findByText(`Image-generation job record ${JOB_ID} (input image)`)).toBeVisible()
    expect(screen.getByText(RELEASE)).toBeVisible()
    expect(screen.queryByText('Could not check file references.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })

  it('fails closed if positive counts lose their details before the refs read', async () => {
    const user = userEvent.setup()
    mockReferenceReads({ refs: { [FILE_ID]: [] } })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry reference check' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    expect(screen.queryByText(RELEASE)).not.toBeInTheDocument()
  })

  it.each([
    ['refs', 'resolve'],
    ['refs', 'reject'],
    ['jobs', 'resolve'],
    ['jobs', 'reject']
  ] as const)('discards a stale %s phase that later %ss after closing and reopening', async (phase, outcome) => {
    const user = userEvent.setup()
    const detail = Promise.withResolvers<FileRef[]>()
    const job = Promise.withResolvers<string>()
    const started = Promise.withResolvers<void>()
    let current = false
    mockReferenceReads({
      counts: async () => [{ entryId: FILE_ID, refCount: current ? 0 : 1 }],
      refs: {
        [FILE_ID]: () => {
          if (phase === 'refs') started.resolve()
          return phase === 'refs' ? detail.promise : [jobRef()]
        }
      },
      jobs: {
        [JOB_ID]: () => {
          started.resolve()
          return job.promise
        }
      }
    })
    vi.mocked(toast.error).mockClear()
    render(<ArchiveSettings />)
    await openFileDelete(user)
    await started.promise
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    current = true
    await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled())
    await act(async () => {
      if (outcome === 'resolve') {
        detail.resolve([jobRef()])
        job.resolve('image-generation.generate')
      } else if (phase === 'refs') {
        detail.reject(new Error('stale refs failed'))
      } else {
        job.reject(new Error('stale job failed'))
      }
    })

    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled()
    expect(screen.queryByText(RELEASE)).not.toBeInTheDocument()
    expect(screen.queryByText(/Image-generation job record/)).not.toBeInTheDocument()
    expect(screen.queryByText('Could not check file references.')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('loads every holder within the eight-request detail limit', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(17)
    let activeRefs = 0
    let activeJobs = 0
    const refs: Record<string, () => Promise<FileRef[]>> = {}
    const jobs: Record<string, () => Promise<string>> = {}
    for (const [index, item] of mocks.fileItems.entries()) {
      const sourceId = `019a0000-0000-7000-9000-${(index + 1).toString(16).padStart(12, '0')}`
      refs[item.id] = async () => {
        activeRefs += 1
        try {
          if (activeRefs > 8) throw new Error('Too many concurrent refs requests')
          await Promise.resolve()
          return [{ ...jobRef('input', item.id), sourceId }]
        } finally {
          activeRefs -= 1
        }
      }
      jobs[sourceId] = async () => {
        activeJobs += 1
        try {
          if (activeJobs > 8) throw new Error('Too many concurrent job requests')
          await Promise.resolve()
          return 'image-generation.generate'
        } finally {
          activeJobs -= 1
        }
      }
    }
    mockReferenceReads({ counts: mocks.fileItems.map((item) => ({ entryId: item.id, refCount: 1 })), refs, jobs })
    render(<ArchiveSettings />)
    await openFileDelete(user)

    expect(await screen.findByText(/17 files are still used by 17 records/)).toBeVisible()
    for (const [index, item] of mocks.fileItems.entries()) {
      const group = screen.getByRole('region', { name: item.name })
      expect(
        within(group).getByText(
          `Image-generation job record 019a0000-0000-7000-9000-${(index + 1).toString(16).padStart(12, '0')} (input image)`
        )
      ).toBeVisible()
    }
    expect(screen.getAllByText(RELEASE)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('groups All-category holders under the file name despite other domains and reversed count order', async () => {
    const user = userEvent.setup()
    mocks.allItems = [
      { id: `topics:${FILE_ID}`, name: 'Unrelated topic', deletedAt: 1 },
      { id: `files:${FILE_2_ID}`, name: 'Second archived image', deletedAt: 1 },
      { id: `files:${FILE_ID}`, name: 'First archived image', deletedAt: 1 }
    ]
    let jobAvailable = true
    mockReferenceReads({
      counts: [
        { entryId: FILE_ID, refCount: 1 },
        { entryId: FILE_2_ID, refCount: 1 }
      ],
      refs: { [FILE_ID]: [jobRef()], [FILE_2_ID]: [jobRef('mask', FILE_2_ID)] },
      jobs: {
        [JOB_ID]: () => {
          if (!jobAvailable) throw new Error('Job disappeared after its first read')
          jobAvailable = false
          return 'image-generation.generate'
        }
      }
    })
    render(<ArchiveSettings />)
    await user.click(screen.getByRole('button', { name: 'Open all permanent delete' }))

    const first = await screen.findByRole('region', { name: 'First archived image' })
    const second = screen.getByRole('region', { name: 'Second archived image' })
    expect(within(first).getByText(`Image-generation job record ${JOB_ID} (input image)`)).toBeVisible()
    expect(within(second).getByText(`Image-generation job record ${JOB_ID} (mask image)`)).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Unrelated topic' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'Second archived image',
      'First archived image'
    ])
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })
})
