import type * as ArtifactPanePath from '@renderer/components/chat/panes/artifactPanePath'
import { ResourcePaneCountButton } from '@renderer/components/chat/panes/Shell'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AbsoluteFilePath } from '@shared/types/file'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicRightPane, useOptionalTopicRightPaneActions } from '../TopicRightPane'

const developerModeEnabled = vi.fn(() => true)
const useCommandHandlerMock = vi.hoisted(() => vi.fn())
const topicBranchPanelModuleState = vi.hoisted(() => ({ importCount: 0 }))
const ipcRequestMock = vi.hoisted(() => vi.fn())
const resolveArtifactPaneFileSelectionMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: ipcRequestMock
  }
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ArtifactPaneView: ({
    editMode,
    model,
    onPreviewClose,
    paneTitle,
    previewFileSelection,
    selectedFile
  }: {
    editMode?: string
    model?: unknown
    onPreviewClose?: () => void
    paneTitle?: string
    previewFileSelection?: ArtifactPanePath.ArtifactPaneFileSelection | null
    selectedFile?: string | null
  }) => (
    <div
      data-testid="artifact-pane"
      data-display-path={previewFileSelection?.displayPath ?? ''}
      data-edit-mode={editMode ?? ''}
      data-has-tree={String(Boolean(model))}
      data-preview-path={
        previewFileSelection ? `${previewFileSelection.workspacePath}/${previewFileSelection.filePath}` : ''
      }
      data-preview-type={previewFileSelection?.previewType ?? ''}
      data-read-only={String(Boolean(previewFileSelection?.readOnly))}
      data-selected-file={selectedFile ?? ''}
      data-title={previewFileSelection?.displayName ?? paneTitle ?? ''}>
      {previewFileSelection ? (
        <button type="button" aria-label="common.back" onClick={onPreviewClose}>
          back
        </button>
      ) : null}
    </div>
  ),
  getArtifactPaneSelectionPath: (selection: ArtifactPanePath.ArtifactPaneFileSelection) =>
    `${selection.workspacePath}/${selection.filePath}`,
  resolveArtifactPaneFileSelection: resolveArtifactPaneFileSelectionMock
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: useCommandHandlerMock
}))

vi.mock('@renderer/hooks/tab', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsActiveTab: () => true
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'app.developer_mode.enabled' ? [developerModeEnabled(), vi.fn()] : [undefined, vi.fn()]
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const { createContext, use } = await import('react')
  const TabsValueContext = createContext('')

  return {
    ...original,
    Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tabs: ({ children, value }: PropsWithChildren<{ value?: string }>) => (
      <TabsValueContext value={value ?? ''}>{children}</TabsValueContext>
    ),
    TabsContent: ({
      children,
      className,
      forceMount,
      value
    }: PropsWithChildren<{ className?: string; forceMount?: boolean; value: string }>) => {
      const activeValue = use(TabsValueContext)
      const active = activeValue === value
      if (!active && !forceMount) return null

      return (
        <div className={className} data-state={active ? 'active' : 'inactive'} hidden={!active}>
          {children}
        </div>
      )
    },
    TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsTrigger: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: PropsWithChildren) => children
  }
})

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => {
  return {
    ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
    ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 280,
    ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
    ARTIFACT_RIGHT_PANE_MIN_WIDTH: 255,
    PersistentRightPaneHost: ({
      children,
      maximized,
      open
    }: PropsWithChildren<{ maximized?: boolean; open?: boolean }>) => (
      <section
        data-testid="right-pane"
        data-open={String(Boolean(open))}
        data-maximized={String(Boolean(maximized))}
        hidden={!open}>
        {children}
      </section>
    )
  }
})

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: ({ payload }: { payload: { topicId: string; traceId: string } | null }) =>
    payload ? <div data-testid="trace-pane" data-topic-id={payload.topicId} data-trace-id={payload.traceId} /> : null
}))

vi.mock('../TopicBranchPanel', () => {
  topicBranchPanelModuleState.importCount += 1
  return {
    default: ({ open, onLocateMessage }: { open: boolean; onLocateMessage?: (messageId: string) => void }) => (
      <button
        type="button"
        data-open={String(open)}
        data-testid="branch-pane"
        onClick={() => onLocateMessage?.('message-1')}>
        locate current branch message
      </button>
    )
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('TopicRightPane', () => {
  beforeEach(() => {
    useCommandHandlerMock.mockClear()
    ipcRequestMock.mockReset()
    resolveArtifactPaneFileSelectionMock.mockReset()
    developerModeEnabled.mockReturnValue(true)
  })

  const triggerRightSidebarShortcut = () => {
    const handler = useCommandHandlerMock.mock.calls
      .filter(([command]) => command === 'topic.sidebar.toggle')
      .at(-1)?.[1] as (() => void) | undefined

    expect(handler).toBeDefined()
    handler?.()
  }

  function OpenInputFilePreviewButton({
    displayName = 'report.docx',
    label = 'open input preview',
    mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    originalPath = '/Users/alice/report.docx' as AbsoluteFilePath,
    previewPath = '/internal/message-files/report.docx' as AbsoluteFilePath
  }: {
    displayName?: string
    label?: string
    mediaType?: string
    originalPath?: AbsoluteFilePath
    previewPath?: AbsoluteFilePath
  }) {
    const actions = useOptionalTopicRightPaneActions()
    return (
      <button
        type="button"
        onClick={() =>
          actions?.previewInputFile({
            displayName,
            previewPath,
            originalPath,
            mediaType
          })
        }>
        {label}
      </button>
    )
  }

  it('does not load the branch flow implementation before the pane opens', () => {
    render(
      <TopicRightPane.Scope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(topicBranchPanelModuleState.importCount).toBe(0)
  })

  it('registers the right sidebar keyboard shortcut for the branch pane', async () => {
    render(
      <TopicRightPane.Scope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: true })
    )
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('opens the resource pane from the right sidebar keyboard shortcut when resources are available', () => {
    render(
      <TopicRightPane.Scope
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('opens input file previews in the right files pane', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockRejectedValueOnce(new Error('missing original')).mockResolvedValueOnce({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-preview-type', 'file')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-display-path', '/Users/alice/report.docx')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-title', 'report.docx')
    expect(ipcRequestMock).toHaveBeenNthCalledWith(1, 'file.get_metadata', {
      kind: 'path',
      path: '/Users/alice/report.docx'
    })
    expect(ipcRequestMock).toHaveBeenNthCalledWith(2, 'file.get_metadata', {
      kind: 'path',
      path: '/internal/message-files/report.docx'
    })
  })

  it('uses the managed copy when the displayed original is a Windows UNC path', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockResolvedValue({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton originalPath={'\\\\server\\share\\report.docx' as AbsoluteFilePath} />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-display-path', '\\\\server\\share\\report.docx')
    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    expect(ipcRequestMock).toHaveBeenCalledWith('file.get_metadata', {
      kind: 'path',
      path: '/internal/message-files/report.docx'
    })
  })

  it('closes the right pane when returning from an input preview opened from closed state', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockRejectedValueOnce(new Error('missing original')).mockResolvedValueOnce({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('does not create a browsable file tree for standalone input previews', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockRejectedValueOnce(new Error('missing original')).mockResolvedValueOnce({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-has-tree', 'false')
  })

  it('keeps the original closed return target when switching between input previews', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock
      .mockRejectedValueOnce(new Error('missing original'))
      .mockResolvedValueOnce({ kind: 'file' })
      .mockRejectedValueOnce(new Error('missing original'))
      .mockResolvedValueOnce({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton label="open first preview" />
        <OpenInputFilePreviewButton
          displayName="second.docx"
          label="open second preview"
          previewPath={'/internal/message-files/second.docx' as AbsoluteFilePath}
          originalPath={'/Users/alice/second.docx' as AbsoluteFilePath}
        />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'open first preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'open second preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/second.docx'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('returns to the previously active pane when closing an input preview', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockRejectedValueOnce(new Error('missing original')).mockResolvedValueOnce({ kind: 'file' })

    render(
      <TopicRightPane.Scope topicId="topic-a">
        <OpenInputFilePreviewButton />
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    expect(await screen.findByTestId('branch-pane')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.docx'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('branch-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.message.flow.title')
  })

  it('disables the right sidebar keyboard shortcut without a ready capability', () => {
    render(
      <TopicRightPane.Scope>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: false })
    )
  })

  it('hides environmental presentation without discarding topic pane intent or its visited instance', async () => {
    const { rerender } = render(
      <TopicRightPane.Scope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    act(triggerRightSidebarShortcut)
    const branchPane = await screen.findByTestId('branch-pane')

    rerender(
      <TopicRightPane.Scope topicId="topic-a" present={false}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'false')
    expect(useCommandHandlerMock).toHaveBeenLastCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: false })
    )

    rerender(
      <TopicRightPane.Scope topicId="topic-a">
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
  })

  it('loads the trace pane with the container traceId only when the trace tab is selected', async () => {
    render(
      <TopicRightPane.Scope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toBeInTheDocument()
    expect(screen.queryByTestId('trace-pane')).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(await screen.findByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('unmounts the trace pane after switching away so its trace tree can be collected', async () => {
    render(
      <TopicRightPane.Scope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)
    const tracePane = await screen.findByTestId('trace-pane')

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    expect(screen.queryByTestId('trace-pane')).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)
    expect(await screen.findByTestId('trace-pane')).not.toBe(tracePane)
  })

  it('hides the trace tab when developer mode is off', async () => {
    developerModeEnabled.mockReturnValue(false)

    render(
      <TopicRightPane.Scope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(screen.queryByRole('button', { name: /trace\.label/ })).toBeNull()
    expect(screen.queryByTestId('trace-pane')).toBeNull()
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()
  })

  it('forwards branch-node locate requests without closing the shell', async () => {
    const onLocateMessage = vi.fn()

    render(
      <TopicRightPane.Scope topicId="topic-1" topicName="Topic">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport onLocateMessage={onLocateMessage} />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'locate current branch message' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    await waitFor(() => {
      expect(onLocateMessage).toHaveBeenCalledWith('message-1')
    })
  })

  it('mounts the resource list pane open when requested', () => {
    render(
      <TopicRightPane.Scope
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.topics.title')
    expect(document.querySelector('[data-shell-tab-shortcut="resources"]')).not.toBeInTheDocument()
  })

  it('shows top shortcuts for the stable right-pane tabs while closed', () => {
    render(
      <TopicRightPane.Scope
        topicId="topic-a"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.queryByRole('button', { name: 'chat.topics.title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'chat.message.flow.title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trace.label' })).toBeInTheDocument()

    const branchShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(branchShortcut).toBeInTheDocument()

    fireEvent.click(branchShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toBeInTheDocument()
  })

  it('collapses the active pane from the same tab shortcut while preserving the view label', () => {
    render(
      <TopicRightPane.Scope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.message.flow.title')

    const openStateShortcut = document.querySelector('[data-shell-tab-shortcut="branch"]')
    expect(openStateShortcut).toBeInTheDocument()
    expect(openStateShortcut).toHaveAttribute('aria-label', 'chat.message.flow.title')
    expect(screen.queryByRole('button', { name: 'common.close_sidebar' })).toBeInTheDocument()

    fireEvent.click(openStateShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('switches to another pane entry without closing the docked pane', () => {
    render(
      <TopicRightPane.Scope topicId="topic-a" traceId="trace-a">
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('trace.label')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'topic-a')
    expect(document.querySelector('[data-shell-tab-shortcut="branch"]')).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('[data-shell-tab-shortcut="trace"]')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps visited capabilities mounted across switches and offers maximize only for the branch pane', async () => {
    render(
      <TopicRightPane.Scope
        topicId="topic-a"
        traceId="trace-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Shortcuts />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    const branchPane = await screen.findByTestId('branch-pane')
    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-maximized', 'false')

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="trace"]') as HTMLElement)

    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'false')
    expect(branchPane).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="branch"]') as HTMLElement)
    expect(screen.getByTestId('branch-pane')).toBe(branchPane)
    expect(branchPane).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.message.flow.title')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'chat.topics.title 3' }))
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
  })

  it('keeps the resource count entry visible while docked open and lets it close the active resource view', () => {
    render(
      <TopicRightPane.Scope
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
        <ResourcePaneCountButton label="chat.topics.title" count={3} />
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    const resourceEntry = screen.getByRole('button', { name: 'chat.topics.title 3' })

    fireEvent.click(resourceEntry)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('chat.topics.title')
    expect(resourceEntry).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(resourceEntry)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('reconciles an open resource capability to the next ready capability', async () => {
    const { rerender } = render(
      <TopicRightPane.Scope
        topicId="topic-a"
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}
        defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()

    rerender(
      <TopicRightPane.Scope topicId="topic-a" defaultOpen>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.queryByTestId('resource-list')).toBeNull()
    expect(await screen.findByTestId('branch-pane')).toBeInTheDocument()
  })

  it('opens the resource pane on a locate reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane.Scope resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    rerender(
      <TopicRightPane.Scope
        resourcePane={resourcePane}
        revealRequest={{ itemId: 'topic-a', requestId: 1, clearFilters: true, clearQuery: true }}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()
  })

  it('does not open the resource pane for a passive (non-locate) reveal request', () => {
    const resourcePane = { node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }
    const { rerender } = render(
      <TopicRightPane.Scope resourcePane={resourcePane}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    rerender(
      <TopicRightPane.Scope resourcePane={resourcePane} revealRequest={{ itemId: 'topic-a', requestId: 2 }}>
        <TopicRightPane.Viewport />
      </TopicRightPane.Scope>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('does not open the resource list pane when the owning tab is revealed', async () => {
    render(
      <TabIdProvider tabId="chat-tab">
        <TopicRightPane.Scope
          resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'chat.topics.title' }}>
          <TopicRightPane.Viewport />
        </TopicRightPane.Scope>
      </TabIdProvider>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')

    await act(async () => {
      await EventEmitter.emit(EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST, {
        source: 'assistants',
        tabId: 'chat-tab'
      })
    })

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('resource-list')).toBeNull()
  })
})
