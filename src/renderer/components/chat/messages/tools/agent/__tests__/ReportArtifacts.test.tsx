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
import {
  getLocalWrittenFilePaths,
  getReportArtifactsViewModel,
  isReportArtifactsToolResponse,
  MessageReportArtifacts
} from '../ReportArtifacts'

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
    t: (key: string, options?: { format?: string; count?: number }) => {
      const messages: Record<string, string> = enUs
      if (key.startsWith('chat.input.tools.file_type.') || key.startsWith('files.')) {
        return messages[key]?.replace('{{format}}', options?.format ?? '') ?? key
      }
      if (key === 'chat.artifacts.show_remaining') {
        return messages[key].replace('{{count}}', String(options?.count))
      }
      if (key === 'common.collapse') return 'Collapse'
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
  addCollection: vi.fn(),
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

  it.each([1, 3])('keeps all %i deliverables accessible without a disclosure control', (count) => {
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'small-list',
            toolCallId: 'small-list',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: { artifacts: Array.from({ length: count }, (_, index) => ({ path: `dist/file-${index}.md` })) }
          }
        ]}
      />
    )

    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(count)
    expect(screen.queryByRole('button', { name: /Show remaining files/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument()
  })

  it.each([4, 12])('makes all %i deliverables reachable by keyboard and allows collapsing again', async (count) => {
    const user = userEvent.setup()
    renderWithProvider(
      <MessageReportArtifacts
        toolResponses={[
          {
            id: 'large-list',
            toolCallId: 'large-list',
            tool: { id: 'report-artifacts', name: 'report_artifacts', type: 'builtin' },
            status: 'done',
            arguments: { artifacts: Array.from({ length: count }, (_, index) => ({ path: `dist/file-${index}.md` })) }
          }
        ]}
      />
    )

    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Preview file-3.md' })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: `Show remaining files (${count - 3})` })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.tab({ shift: true })
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(count)
    expect(screen.getByRole('button', { name: `Preview file-${count - 1}.md` })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Collapse')
    expect(toggle).toHaveFocus()

    await user.keyboard(' ')

    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(3)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName(`Show remaining files (${count - 3})`)
    expect(toggle).toHaveFocus()
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

    await user.click(screen.getByRole('button', { name: 'Open with report（终稿·含批注）.docx' }))
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

it.each(['invoking', 'error', 'cancelled'] as const)('does not declare artifacts from %s calls', (status) => {
  expect(
    getReportArtifactsViewModel([
      {
        id: 'nested',
        toolCallId: 'nested',
        tool: { id: 'artifact', name: 'report_artifacts', type: 'builtin' },
        status,
        arguments: { artifacts: [{ path: '/tmp/report.html' }] }
      }
    ])
  ).toBeNull()
})

it('does not treat a foreign MCP tool as an artifact declaration', () => {
  expect(
    getReportArtifactsViewModel([
      {
        id: 'nested',
        toolCallId: 'nested',
        tool: {
          id: 'artifact',
          name: 'report_artifacts',
          type: 'mcp',
          serverId: 'foreign',
          serverName: 'foreign',
          description: '',
          inputSchema: { type: 'object' }
        },
        status: 'done',
        arguments: { artifacts: [{ path: '/tmp/report.html' }] }
      }
    ])
  ).toBeNull()
})

it('keeps foreign artifact-named calls in the generic tool stream', () => {
  expect(
    isReportArtifactsToolResponse({
      id: 'foreign',
      arguments: {},
      toolCallId: 'foreign',
      status: 'done',
      tool: {
        id: 'foreign',
        name: 'report_artifacts',
        type: 'mcp',
        serverId: 'foreign',
        serverName: 'foreign',
        description: '',
        inputSchema: { type: 'object' }
      }
    })
  ).toBe(false)
})

describe('getLocalWrittenFilePaths', () => {
  it('collects deduplicated completed written files across localAcpTool, ACP: Write, and Codex fileChange while skipping deletes and failures', () => {
    const paths = getLocalWrittenFilePaths([
      {
        type: 'dynamic-tool',
        toolCallId: 'acp-edit',
        toolName: 'Edit',
        state: 'output-available',
        input: {
          localAcpTool: {
            title: 'Edit HTML',
            kind: 'edit',
            status: 'completed',
            locations: [{ path: 'out/pelican.html' }],
            content: [{ type: 'diff', path: 'out/extra.css', newText: 'body{}' }]
          }
        },
        output: {}
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'acp-write-dup',
        toolName: 'ACP: Write',
        state: 'output-available',
        input: { path: 'out/pelican.html', content: '<html />' },
        output: {}
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'acp-failed',
        toolName: 'Edit',
        state: 'output-available',
        input: {
          localAcpTool: {
            title: 'Failed edit',
            kind: 'edit',
            status: 'failed',
            locations: [{ path: 'out/failed.html' }]
          }
        },
        output: {}
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'codex-fc',
        toolName: 'fileChange',
        state: 'output-available',
        input: {
          changes: [
            { path: 'src/created.ts', kind: { type: 'add' } },
            { path: 'src/deleted.ts', kind: { type: 'delete' } },
            { path: 'src/removed.ts', kind: 'delete' },
            { path: 'src/updated.ts', kind: 'update' }
          ]
        },
        output: { status: 'completed' }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'codex-declined',
        toolName: 'fileChange',
        state: 'output-available',
        input: { changes: [{ path: 'src/declined.ts', kind: 'add' }] },
        output: { status: 'declined' }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'pending-write',
        toolName: 'ACP: Write',
        state: 'input-available',
        input: { path: 'out/in-progress.html' }
      }
    ] as any)

    expect(paths).toEqual(['out/extra.css', 'out/pelican.html', 'src/created.ts', 'src/updated.ts'])
  })

  it('extracts ACP rawInput fallback paths and local Claude Code writes while ignoring non-local or failed writes', () => {
    const paths = getLocalWrittenFilePaths([
      {
        type: 'dynamic-tool',
        toolCallId: 'acp-raw-only',
        toolName: 'Edit',
        state: 'output-available',
        input: {
          localAcpTool: {
            title: 'Edit HTML',
            kind: 'edit',
            status: 'completed',
            rawInput: { TargetFile: 'out/raw-only.html' }
          }
        },
        output: {}
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'claude-write',
        toolName: 'Write',
        state: 'output-available',
        input: { file_path: 'claude/index.html', content: '<h1>hi</h1>' },
        output: { ok: true },
        callProviderMetadata: { cherry: { localAgentProtocol: 'claude' } }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'claude-notebook',
        toolName: 'NotebookEdit',
        state: 'output-available',
        input: { notebook_path: 'claude/analysis.ipynb' },
        output: { ok: true },
        providerMetadata: { cherry: { localAgentProtocol: 'claude' } }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'claude-failed',
        toolName: 'Write',
        state: 'output-available',
        input: { file_path: 'claude/failed.html' },
        output: { isError: true },
        callProviderMetadata: { cherry: { localAgentProtocol: 'claude' } }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'non-local-write',
        toolName: 'Write',
        state: 'output-available',
        input: { file_path: 'ignored/non-local.html' },
        output: { ok: true }
      }
    ] as any)

    expect(paths).toEqual(['out/raw-only.html', 'claude/index.html', 'claude/analysis.ipynb'])
  })
})
