import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import enUs from '@renderer/i18n/locales/en-us.json'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import type { ExternalOpenTarget } from '@shared/types/externalApp'

import { MessageListProvider } from '../../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../../types'
import { MessageReportArtifacts } from '../ReportArtifacts'

// The global UI mock does not implement DropdownMenuTrigger's asChild contract,
// so use the real menu primitives for these interaction tests.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const { externalOpenTargets, mockOpenTarget, mockUseExternalOpenTargets } = vi.hoisted(() => {
  const targets = [
    { id: 'system_default', kind: 'system_default' },
    { id: 'file_manager', kind: 'file_manager' }
  ] satisfies ExternalOpenTarget[]
  const openTarget = vi.fn().mockResolvedValue(undefined)
  return {
    externalOpenTargets: targets,
    mockOpenTarget: openTarget,
    mockUseExternalOpenTargets: vi.fn(
      (targetPath: string, _pathKind: 'file' | 'directory', options?: { enabled?: boolean }) => ({
        data: options?.enabled
          ? { pathKind: 'file' as const, recommendedTargetId: 'system_default', targets }
          : undefined,
        error: undefined,
        targets: options?.enabled ? targets : [],
        openTarget: (target: ExternalOpenTarget) => openTarget(targetPath, target)
      })
    )
  }
})

vi.mock('@renderer/hooks/useExternalOpenTargets', () => ({
  useExternalOpenTargets: mockUseExternalOpenTargets
}))

vi.mock('@renderer/components/OpenTarget', () => ({
  getOpenTargetBadge: () => undefined,
  getOpenTargetLabel: (target: ExternalOpenTarget) => (target.kind === 'system_default' ? 'Open File' : 'Finder'),
  OpenTargetIcon: ({ target }: { target: ExternalOpenTarget }) => <span data-testid={`${target.id}-icon`} />
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, options?: { format?: string }) => {
      const messages: Record<string, string> = enUs
      if (key.startsWith('chat.input.tools.file_type.') || key.startsWith('files.')) {
        return messages[key]?.replace('{{format}}', options?.format ?? '') ?? key
      }
      if (key === 'common.preview') return 'Preview'
      if (key === 'common.copied') return 'Copied'
      if (key === 'common.copy') return 'Copy'
      if (key === 'chat.input.tools.open_file') return 'Open File'
      if (key === 'chat.input.tools.open_file_error') return 'Failed to open file'
      if (key === 'chat.input.tools.open_preview') return 'Open preview'
      if (key === 'chat.input.tools.open_with') return 'Open with'
      if (key === 'chat.input.tools.file_not_found') return 'File not found'
      if (key === 'agent.session.file_manager.finder') return 'Finder'
      return key
    }
  })
}))

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: true,
  isWin: false,
  platform: 'darwin'
}))

const renderWithProvider = (ui: ReactElement, actions: MessageListProviderValue['actions'] = {}) => {
  const value: MessageListProviderValue = {
    state: {
      topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [],
      partsByMessageId: {},
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig
    },
    actions,
    meta: { selectionLayer: false }
  }

  return render(<MessageListProvider value={value}>{ui}</MessageListProvider>)
}

describe('MessageReportArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setInlineFilePathHomePath(undefined)
  })

  it('renders declared deliverables from tool arguments', () => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'Created final outputs',
              artifacts: [{ path: 'dist/report.md', description: 'Report' }]
            },
            response: 'Recorded 1 artifact(s).'
          }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Preview report.md' })).toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.queryByText('Open preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Created final outputs')).toBeNull()
    expect(screen.queryByText('- Report')).toBeNull()
  })

  it.each([
    ['slides.PPTX', 'PowerPoint presentation'],
    ['legacy.ppt', 'PowerPoint presentation'],
    ['report.docx', 'Word document'],
    ['report.pdf', 'PDF document'],
    ['report.md', 'Markdown document'],
    ['page.html', 'HTML webpage'],
    ['sheet.xlsx', 'Excel spreadsheet'],
    ['data.csv', 'CSV spreadsheet'],
    ['slides.odp', 'OpenDocument presentation'],
    ['document.odt', 'OpenDocument document'],
    ['sheet.ods', 'OpenDocument spreadsheet'],
    ['photo.PNG', 'Image'],
    ['music.mp3', 'Audio'],
    ['movie.mp4', 'Video'],
    ['backup.tar.gz', 'Archive'],
    ['data.json', 'JSON file'],
    ['script.py', 'PY file'],
    ['unknown.xyz', 'XYZ file'],
    ['unknown.constructor', 'CONSTRUCTOR file'],
    ['README', 'File'],
    ['.gitignore', 'File'],
    ['report.', 'File']
  ])('labels %s as %s without requiring a preview action', (fileName, label) => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'file-type-test',
            toolCallId: 'file-type-test',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: { artifacts: [{ path: `/folder.with.dots/${fileName}` }] }
          }
        ]}
      />
    )

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText('Open preview')).not.toBeInTheDocument()
  })

  it('uses the latest declaration for duplicate artifact paths', () => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'First summary',
              artifacts: [{ path: 'dist/report.md', description: 'Draft' }]
            }
          },
          {
            id: 'tool-call-2',
            toolCallId: 'tool-call-2',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              summary: 'Final summary',
              artifacts: [{ path: 'dist/report.md', description: 'Final report' }]
            }
          }
        ]}
      />
    )

    expect(screen.getAllByRole('button', { name: 'Preview report.md' })).toHaveLength(1)
    expect(screen.queryByText('Final summary')).toBeNull()
    expect(screen.queryByText('- Final report')).toBeNull()
    expect(screen.queryByText('- Draft')).toBeNull()
  })

  it('previews on card click and opens externally from the open-with menu', async () => {
    const user = userEvent.setup()
    const openArtifactFile = vi.fn().mockResolvedValue(undefined)

    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              artifacts: [{ path: 'dist/report（终稿·含批注）.docx' }]
            }
          }
        ]}
      />,
      { openArtifactFile, resolvePath: (path) => `/workspace/${path}` }
    )

    const artifactPath = '/workspace/dist/report（终稿·含批注）.docx'
    expect(screen.getByText('Open preview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview report（终稿·含批注）.docx' }))
    await waitFor(() => {
      expect(openArtifactFile).toHaveBeenCalledWith(artifactPath)
    })

    expect(mockUseExternalOpenTargets).toHaveBeenLastCalledWith(artifactPath, 'file', { enabled: false })
    await user.click(screen.getByRole('button', { name: 'Open with report（终稿·含批注）.docx' }))
    expect(mockUseExternalOpenTargets).toHaveBeenCalledWith(artifactPath, 'file', { enabled: true })
    await user.click(await screen.findByRole('menuitem', { name: 'Open File' }))
    await waitFor(() => {
      expect(mockOpenTarget).toHaveBeenCalledWith(artifactPath, externalOpenTargets[0])
    })
  })

  it('resolves home-relative artifact paths before previewing or opening externally', async () => {
    const user = userEvent.setup()
    const openArtifactFile = vi.fn().mockResolvedValue(undefined)
    setInlineFilePathHomePath('/Users/alice')

    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              artifacts: [{ path: '~/Desktop/report.html' }]
            }
          }
        ]}
      />,
      { openArtifactFile }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview report.html' }))
    await waitFor(() => {
      expect(openArtifactFile).toHaveBeenCalledWith('/Users/alice/Desktop/report.html')
    })

    await user.click(screen.getByRole('button', { name: 'Open with report.html' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open File' }))
    await waitFor(() => {
      expect(mockOpenTarget).toHaveBeenCalledWith('/Users/alice/Desktop/report.html', externalOpenTargets[0])
    })
  })

  it('runs artifact actions from the right-click context menu', async () => {
    const user = userEvent.setup()
    const copyText = vi.fn().mockResolvedValue(undefined)

    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: {
              artifacts: [{ path: '/workspace/dist/report.md' }]
            }
          }
        ]}
      />,
      { copyText }
    )

    const previewButton = screen.getByRole('button', { name: 'Preview report.md' })
    expect(previewButton).toHaveAttribute('aria-disabled', 'true')
    expect(previewButton).not.toBeDisabled()

    const openContextMenu = () => fireEvent.contextMenu(screen.getByText('report.md'))

    openContextMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Open File' }))
    openContextMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Finder' }))
    openContextMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Copy' }))

    await waitFor(() => {
      expect(mockOpenTarget).toHaveBeenCalledWith('/workspace/dist/report.md', externalOpenTargets[0])
      expect(mockOpenTarget).toHaveBeenCalledWith('/workspace/dist/report.md', externalOpenTargets[1])
      expect(copyText).toHaveBeenCalledWith('/workspace/dist/report.md', { successMessage: 'Copied' })
    })
  })
})
