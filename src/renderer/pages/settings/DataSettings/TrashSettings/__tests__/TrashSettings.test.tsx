// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { dataApiService } from '@renderer/data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TrashItem } from '../trashUtils'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mocks = vi.hoisted(() => ({
  fileItems: [] as TrashItem[],
  runDelete: vi
    .fn()
    .mockResolvedValue({ succeeded: [] as string[], failed: [] as Array<{ id: string; error: string }> })
}))

vi.mock('../TrashDomainSections', async () => {
  const React = await import('react')
  const { default: TrashSection } = await import('../TrashSection')
  const topic = { id: 'topic-1', name: 'Deleted topic', deletedAt: 1_750_000_000_000 }
  const session = { id: 'session-1', name: 'Deleted session', deletedAt: 1_750_000_000_000 }

  const buildSelectionSection = (item: TrashItem) =>
    function SelectionSection(props: {
      retentionDays: number
      onRequestDelete: (request: unknown) => void
      isBatchMode: boolean
      isPermanentDeleting: boolean
    }) {
      return React.createElement(TrashSection, {
        items: [item],
        isLoading: false,
        error: undefined,
        onRetry: vi.fn(),
        retentionDays: props.retentionDays,
        isBatchMode: props.isBatchMode,
        pendingRestoreId: null,
        isPermanentDeleting: props.isPermanentDeleting,
        onRestore: vi.fn(),
        onRestoreMany: vi.fn().mockResolvedValue({ succeeded: [item.id], failed: [] }),
        onPermanentDelete: vi.fn().mockResolvedValue({ succeeded: [item.id], failed: [] }),
        onPermanentDeleteMany: vi.fn().mockResolvedValue({ succeeded: [item.id], failed: [] }),
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
  const EmptySection = () => null
  return {
    TopicTrashSection: TopicSection,
    AgentTrashSection: EmptySection,
    SessionTrashSection: SessionSection,
    AssistantTrashSection: EmptySection,
    PaintingTrashSection: EmptySection,
    FileTrashSection: FileSection
  }
})

const { default: TrashSettings } = await import('../TrashSettings')

function fileItems(count: number): TrashItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index + 1}`,
    name: `File ${index + 1}`,
    deletedAt: 1_750_000_000_000 + index
  }))
}

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, current: string, next: string) {
  await user.click(screen.getByRole('button', { name: current }))
  await user.click(screen.getByRole('button', { name: next }))
}

async function openFileDelete(user: ReturnType<typeof userEvent.setup>) {
  await chooseCategory(user, 'Topics', 'Files')
  await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.mocked(dataApiService.get).mockReset()
  mocks.runDelete.mockReset().mockResolvedValue({ succeeded: [], failed: [] })
  mocks.fileItems = fileItems(1)
})

describe('TrashSettings permanent-delete confirmation', () => {
  it('reveals current-type selection on demand and preserves batch mode across categories', async () => {
    const user = userEvent.setup()
    render(<TrashSettings />)

    expect(screen.queryByRole('checkbox', { name: 'Select Deleted topic' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Batch manage' }))
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('checkbox', { name: 'Select all visible items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently 0' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Select Deleted topic' }))
    expect(screen.getByRole('button', { name: 'Restore 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Permanently 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeEnabled()

    await chooseCategory(user, 'Topics', 'Sessions')

    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Deleted session' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'Select Deleted session' }))
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore 0' })).toBeDisabled()

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
    render(<TrashSettings />)

    await openFileDelete(user)

    expect(screen.getByRole('dialog')).toHaveTextContent('Delete permanently?')
    expect(screen.getByRole('dialog')).toHaveTextContent('This action cannot be undone.')
    const confirm = screen.getByRole('button', { name: 'Delete Permanently' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText('Checking file references…')).toBeInTheDocument()

    resolveCounts([{ entryId: 'file-1', refCount: 0 }])
    await waitFor(() => expect(confirm).toBeEnabled())
    await user.click(confirm)

    expect(mocks.runDelete).toHaveBeenCalledWith(mocks.fileItems)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('chunks 501 selected file ids into 500 and 1 before enabling confirmation', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(501)
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) =>
      (options?.query?.entryIds ?? []).map((entryId) => ({ entryId, refCount: 0 }))
    )
    render(<TrashSettings />)

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
    render(<TrashSettings />)

    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    expect(dataApiService.get).toHaveBeenCalledTimes(2)
    expect(mocks.runDelete).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled for referenced files and reports both impact totals', async () => {
    const user = userEvent.setup()
    mocks.fileItems = fileItems(3)
    vi.mocked(dataApiService.get).mockResolvedValueOnce([
      { entryId: 'file-1', refCount: 2 },
      { entryId: 'file-2', refCount: 0 },
      { entryId: 'file-3', refCount: 4 }
    ])
    render(<TrashSettings />)

    await openFileDelete(user)

    expect(await screen.findByText(/2 files are still used by 6 records/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    expect(mocks.runDelete).not.toHaveBeenCalled()
  })

  it('keeps confirmation disabled after a preview error and retries explicitly', async () => {
    const user = userEvent.setup()
    vi.mocked(dataApiService.get)
      .mockRejectedValueOnce(new Error('ref counts unavailable'))
      .mockResolvedValueOnce([{ entryId: 'file-1', refCount: 0 }])
    render(<TrashSettings />)

    await openFileDelete(user)

    expect(await screen.findByText('Could not check file references.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry reference check' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled())
    expect(dataApiService.get).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a successful reference preview after closing and reopening', async () => {
    const user = userEvent.setup()
    vi.mocked(dataApiService.get).mockResolvedValue([{ entryId: 'file-1', refCount: 0 }])
    render(<TrashSettings />)
    await openFileDelete(user)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))

    await waitFor(() => expect(dataApiService.get).toHaveBeenCalledTimes(2))
  })

  it('ignores an old preview response after closing, switching category, and reopening', async () => {
    const user = userEvent.setup()
    let resolveOld!: (value: Array<{ entryId: string; refCount: number }>) => void
    vi.mocked(dataApiService.get)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }) as never
      )
      .mockResolvedValueOnce([{ entryId: 'file-1', refCount: 3 }])
    render(<TrashSettings />)
    await openFileDelete(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await chooseCategory(user, 'Files', 'Topics')
    await chooseCategory(user, 'Topics', 'Files')
    await user.click(screen.getByRole('button', { name: 'Open file permanent delete' }))
    expect(await screen.findByText(/1 file is still used by 3 records/)).toBeInTheDocument()

    await act(async () => resolveOld([{ entryId: 'file-1', refCount: 0 }]))

    expect(screen.getByText(/1 file is still used by 3 records/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled()
  })
})
