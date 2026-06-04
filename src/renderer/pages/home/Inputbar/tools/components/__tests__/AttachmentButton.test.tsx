import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata } from '@renderer/types'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AttachmentButton from '../AttachmentButton'

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn()
}))

const mockUseQuickPanel = vi.fn()
const mockUseKnowledgeBases = vi.fn()
const mockUseKnowledgeItems = vi.fn()
const mockFileGet = vi.fn()
const mockGetPhysicalPath = vi.fn()
const mockToastWarning = vi.fn()
const mockUpdateItemSelection = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      error: mockLoggerError
    }))
  }
}))

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon: ReactNode }) => {
    const { icon, ...buttonProps } = props
    delete buttonProps.active

    return (
      <button type="button" {...buttonProps}>
        {icon}
      </button>
    )
  }
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    File: 'file'
  },
  useQuickPanel: () => mockUseQuickPanel()
}))

vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => mockUseKnowledgeBases()
}))

vi.mock('@renderer/hooks/useKnowledgeItems', () => ({
  useKnowledgeItems: (baseId: string) => mockUseKnowledgeItems(baseId)
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { path?: string }) => {
      if (key === 'chat.input.tools.file_not_found') {
        return `File not found: ${options?.path}`
      }

      return key
    }
  })
}))

vi.mock('@renderer/utils/file', () => ({
  filterSupportedFiles: (files: FileMetadata[]) => files
}))

const createFileMetadata = (path: string): FileMetadata => ({
  id: 'file-metadata-1',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path,
  size: 1024,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-04-21T10:00:00+08:00',
  count: 1
})

const createQuickPanelApi = (): ToolQuickPanelApi => ({
  registerRootMenu: vi.fn(() => vi.fn()),
  registerTrigger: vi.fn(() => vi.fn())
})

const renderAttachmentButton = (setFiles = vi.fn()) => {
  const quickPanel = createQuickPanelApi()
  const result = render(
    <AttachmentButton
      quickPanel={quickPanel}
      couldAddImageFile={false}
      extensions={['.pdf']}
      files={[]}
      setFiles={setFiles}
    />
  )

  return {
    ...result,
    quickPanel
  }
}

const openKnowledgeFileList = async (quickPanel: ToolQuickPanelApi) => {
  const rootEntry = vi.mocked(quickPanel.registerRootMenu).mock.calls.at(-1)?.[0][0]

  await act(async () => {
    rootEntry?.action?.({ item: rootEntry } as never)
  })

  const attachmentList = mockUseQuickPanel().open.mock.calls.at(-1)?.[0].list

  await act(async () => {
    await attachmentList[1].action({ item: attachmentList[1] } as never)
  })

  await waitFor(() => {
    expect(mockUseQuickPanel().updateList).toHaveBeenCalled()
  })

  return mockUseQuickPanel().updateList.mock.calls.at(-1)?.[0]
}

describe('AttachmentButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuickPanel.mockReturnValue({
      open: vi.fn(),
      updateList: vi.fn(),
      isVisible: true,
      symbol: 'file',
      multiple: true
    })
    mockUseKnowledgeBases.mockReturnValue({
      bases: [
        {
          id: 'base-1',
          name: 'Docs',
          status: 'completed'
        }
      ]
    })
    mockUseKnowledgeItems.mockReturnValue({
      items: [
        {
          id: 'item-1',
          baseId: 'base-1',
          groupId: null,
          type: 'file',
          data: {
            source: '/Users/me/docs/report.pdf',
            fileEntryId: '019606a0-0000-7000-8000-000000000001'
          },
          status: 'completed',
          error: null,
          createdAt: '2026-04-21T10:00:00+08:00',
          updatedAt: '2026-04-21T10:00:00+08:00'
        }
      ],
      isLoading: false
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          get: mockFileGet,
          getPhysicalPath: mockGetPhysicalPath,
          select: vi.fn()
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        warning: mockToastWarning
      }
    })
  })

  it('adds a knowledge file attachment from the item file entry id', async () => {
    const setFiles = vi.fn()
    const fileMetadata = createFileMetadata('/resolved/docs/report.pdf')
    mockGetPhysicalPath.mockResolvedValueOnce('/resolved/docs/report.pdf')
    mockFileGet.mockResolvedValueOnce(fileMetadata)

    const { quickPanel } = renderAttachmentButton(setFiles)

    const updatedList = await openKnowledgeFileList(quickPanel)
    expect(updatedList[0]).toMatchObject({
      label: 'report.pdf',
      description: '/Users/me/docs/report.pdf',
      isSelected: false
    })

    await act(async () => {
      await updatedList[0].action({ context: { updateItemSelection: mockUpdateItemSelection }, item: updatedList[0] })
    })

    expect(mockGetPhysicalPath).toHaveBeenCalledWith({ id: '019606a0-0000-7000-8000-000000000001' })
    expect(mockFileGet).toHaveBeenCalledWith('/resolved/docs/report.pdf')
    expect(setFiles).toHaveBeenCalledWith(expect.any(Function))
    expect(setFiles.mock.calls[0][0]([])).toEqual([
      {
        ...fileMetadata,
        id: '019606a0-0000-7000-8000-000000000001'
      }
    ])
  })

  it('opens the knowledge base file list from the attachment quick panel', () => {
    const open = vi.fn()
    const updateList = vi.fn()
    mockUseQuickPanel.mockReturnValue({
      open,
      updateList,
      isVisible: false,
      symbol: '',
      multiple: false
    })

    const { quickPanel } = renderAttachmentButton()

    const rootEntry = vi.mocked(quickPanel.registerRootMenu).mock.calls.at(-1)?.[0][0]
    act(() => {
      rootEntry?.action?.({ item: rootEntry } as never)
    })

    const rootList = open.mock.calls.at(-1)?.[0].list
    act(() => {
      rootList[1].action()
    })

    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Docs',
        symbol: 'file',
        multiple: true
      })
    )
  })

  it('warns when a knowledge file source cannot be resolved to file metadata', async () => {
    mockGetPhysicalPath.mockResolvedValueOnce('/resolved/docs/report.pdf')
    mockFileGet.mockResolvedValueOnce(null)

    const { quickPanel } = renderAttachmentButton()

    const updatedList = await openKnowledgeFileList(quickPanel)
    await act(async () => {
      await updatedList[0].action({ context: { updateItemSelection: mockUpdateItemSelection }, item: updatedList[0] })
    })

    await waitFor(() => {
      expect(mockUpdateItemSelection).toHaveBeenCalledWith(updatedList[0], false)
      expect(mockToastWarning).toHaveBeenCalledWith('File not found: /Users/me/docs/report.pdf')
    })
  })

  it('warns and rolls back selection when physical path resolution fails', async () => {
    mockGetPhysicalPath.mockRejectedValueOnce(new Error('missing entry'))

    const { quickPanel } = renderAttachmentButton()

    const updatedList = await openKnowledgeFileList(quickPanel)
    await act(async () => {
      await updatedList[0].action({ context: { updateItemSelection: mockUpdateItemSelection }, item: updatedList[0] })
    })

    await waitFor(() => {
      expect(mockUpdateItemSelection).toHaveBeenCalledWith(updatedList[0], false)
      expect(mockToastWarning).toHaveBeenCalledWith('File not found: /Users/me/docs/report.pdf')
    })
    expect(mockFileGet).not.toHaveBeenCalled()
  })
})
