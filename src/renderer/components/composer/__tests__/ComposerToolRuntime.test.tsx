import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAllTools, mockGetToolsForScope, mockQuickPanelValue, mockTranslate, mockUseQuickPanel } = vi.hoisted(
  () => {
    const mockQuickPanelValue = {
      close: vi.fn(),
      initialSearchText: undefined as string | undefined,
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateFooterActions: vi.fn(),
      updateList: vi.fn()
    }

    return {
      mockGetAllTools: vi.fn(),
      mockGetToolsForScope: vi.fn(),
      mockQuickPanelValue,
      mockTranslate: (key: string) => key,
      mockUseQuickPanel: vi.fn(() => mockQuickPanelValue)
    }
  }
)

vi.mock('@renderer/components/composer/tools/builtinTools', () => ({
  getAllTools: () => mockGetAllTools(),
  getToolsForScope: (...args: unknown[]) => mockGetToolsForScope(...args)
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => mockUseQuickPanel()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate })
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children, content, isOpen }: any) => (
    <div
      data-testid="composer-tool-tooltip"
      data-tooltip-content={String(content)}
      data-tooltip-open={isOpen ? 'true' : 'false'}>
      {children}
    </div>
  )
}))

import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import {
  ComposerActiveToolControls,
  ComposerToolDerivedStateProvider,
  ComposerToolFooterActionsSync,
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolState
} from '../ComposerToolRuntime'
import type { ComposerSerializedToken } from '../tokens'
import { useComposerToolProviderLaunchers } from '../tools/ComposerToolProvider'
import attachmentTool from '../tools/definitions/attachmentTool'
import knowledgeBaseTool from '../tools/definitions/knowledgeBaseTool'
import { type ComposerToolRegistration, defineTool, TopicType } from '../tools/types'

const assistant = {
  id: 'assistant-1',
  name: 'Assistant',
  settings: {},
  mcpServerIds: [],
  knowledgeBaseIds: []
} as any

const model = {
  id: 'provider-1::model-1',
  providerId: 'provider-1',
  name: 'Model'
} as any

const footerAction = (id: string, panelSymbol: string, order: number) => ({
  id,
  panelSymbol,
  order,
  label: id,
  ariaLabel: id,
  icon: 'settings',
  action: vi.fn()
})

const registeredFooterActions = [
  footerAction('manage-global', 'quick-phrases', 30),
  footerAction('manage-current', 'quick-phrases', 20),
  footerAction('manage-notes', 'notes', 10),
  footerAction('customize-toolbar', '/', 10)
]

const FileStateObserver = ({ onSnapshot }: { onSnapshot: (files: any[]) => void }) => {
  const { files } = useComposerToolState()

  useEffect(() => {
    onSnapshot(files)
  }, [files, onSnapshot])

  return null
}

const FileStateWriter = ({ nextFiles }: { nextFiles: any[] }) => {
  const { setFiles } = useComposerToolDispatch()

  useEffect(() => {
    setFiles(nextFiles)
  }, [nextFiles, setFiles])

  return null
}

const LauncherRegistrationProbe = ({
  onReady
}: {
  onReady: (value: { disposeFirst: () => void; readIds: () => string[] }) => void
}) => {
  const { toolsRegistry, triggers } = useComposerToolDispatch()

  useEffect(() => {
    const disposeFirst = toolsRegistry.registerLaunchers('agent-skills', [
      { id: 'stale-skills', kind: 'panel', label: 'Stale skills', icon: 'stale' }
    ])
    const disposeLatest = toolsRegistry.registerLaunchers('agent-skills', [
      { id: 'agent-skills', kind: 'panel', label: 'Skills', icon: 'skills' }
    ])
    onReady({ disposeFirst, readIds: () => triggers.getLaunchers().map((launcher) => launcher.id) })
    return disposeLatest
  }, [onReady, toolsRegistry, triggers])

  return null
}

const FooterActionRegistrationProbe = ({
  onReady
}: {
  onReady: (value: { disposeFirst: () => void; readIds: (panelSymbol: string) => string[] }) => void
}) => {
  const { toolsRegistry, triggers } = useComposerToolDispatch()

  useEffect(() => {
    const disposeFirst = toolsRegistry.registerLaunchers(
      'quick-phrases',
      [],
      [footerAction('stale-manage', 'quick-phrases', 30)]
    )
    const disposeLatest = toolsRegistry.registerLaunchers('quick-phrases', [], registeredFooterActions.slice(0, 3))

    onReady({
      disposeFirst,
      readIds: (panelSymbol) => triggers.getFooterActions(panelSymbol).map((action) => action.id)
    })
    return disposeLatest
  }, [onReady, toolsRegistry, triggers])

  return null
}

const RegisteredFooterActions = () => {
  const { toolsRegistry } = useComposerToolDispatch()

  useEffect(() => toolsRegistry.registerLaunchers('quick-phrases', [], registeredFooterActions), [toolsRegistry])

  return null
}

beforeEach(() => {
  mockGetAllTools.mockReset().mockReturnValue([])
  mockGetToolsForScope.mockReset()
  mockUseQuickPanel.mockClear()
  mockQuickPanelValue.close.mockClear()
  mockQuickPanelValue.open.mockClear()
  mockQuickPanelValue.updateFooterActions.mockClear()
  mockQuickPanelValue.updateList.mockClear()
  mockQuickPanelValue.isVisible = false
  mockQuickPanelValue.initialSearchText = undefined
  mockQuickPanelValue.symbol = ''
})

const renderRuntime = (tools: ComposerToolRegistration[], node: ReactNode) => {
  mockGetToolsForScope.mockReturnValue(tools)

  return render(
    <ComposerToolRuntimeProvider
      actions={{
        addNewTopic: vi.fn(),
        onTextChange: vi.fn()
      }}>
      <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
      {node}
    </ComposerToolRuntimeProvider>
  )
}

const fileAttachment = (name: string): ComposerAttachment => ({
  fileTokenSourceId: name,
  name,
  origin_name: name,
  ext: '.txt',
  size: 1,
  type: 'text'
})

const LauncherLabels = () => {
  const { getLaunchers } = useComposerToolProviderLaunchers()

  return (
    <output aria-label="Registered launchers">
      {getLaunchers()
        .map((entry) => entry.label)
        .join(',')}
    </output>
  )
}

const ExpansionToggle = () => {
  const { setIsExpanded } = useComposerToolDispatch()

  return <button onClick={() => setIsExpanded((expanded) => !expanded)}>Toggle expansion</button>
}

describe('typed tool registration', () => {
  it('updates declared dependencies and launchers without losing runtime hook state, and cleans up on unmount', async () => {
    const user = userEvent.setup()
    const filesTool = defineTool({
      key: 'files',
      label: 'Files',
      dependencies: { state: ['files'], actions: ['setFiles'] },
      composer: {
        menuItems: {
          createItems: ({ state }) => [
            { id: 'files', kind: 'command', label: `Files: ${state.files.length}`, icon: 'files' }
          ]
        },
        runtime: function FilesRuntime({ context }) {
          const [draft, setDraft] = useState('')

          return (
            <>
              <input aria-label="Tool draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <output aria-label="Attached files">{context.state.files.length}</output>
              <button onClick={() => context.actions.setFiles([])}>Remove attachments</button>
            </>
          )
        }
      }
    })
    mockGetToolsForScope.mockReturnValue([filesTool])
    const Harness = ({ mounted }: { mounted: boolean }) => (
      <ComposerToolRuntimeProvider
        initialState={{ files: [fileAttachment('report.txt')] }}
        actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        {mounted && <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />}
        <LauncherLabels />
        <ExpansionToggle />
      </ComposerToolRuntimeProvider>
    )
    const view = render(<Harness mounted />)

    expect(screen.getByLabelText('Registered launchers')).toHaveTextContent('Files: 1')
    await user.type(screen.getByRole('textbox', { name: 'Tool draft' }), 'Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Toggle expansion' }))
    expect(screen.getByRole('textbox', { name: 'Tool draft' })).toHaveValue('Keep this draft')
    await user.click(screen.getByRole('button', { name: 'Remove attachments' }))
    expect(screen.getByLabelText('Attached files')).toHaveTextContent('0')
    expect(screen.getByLabelText('Registered launchers')).toHaveTextContent('Files: 0')
    expect(screen.getByRole('textbox', { name: 'Tool draft' })).toHaveValue('Keep this draft')
    view.rerender(<Harness mounted={false} />)
    expect(screen.getByLabelText('Registered launchers')).toBeEmptyDOMElement()
  })

  it('reconciles real attachment and knowledge tools using the latest model-free provider state and scope', async () => {
    const user = userEvent.setup()
    const base: KnowledgeBase = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Manual',
      orderKey: 'a',
      groupId: null,
      dimensions: null,
      embeddingModelId: null,
      status: 'completed',
      error: null,
      chunkSize: 1024,
      chunkOverlap: 200,
      chunkStrategy: 'structured',
      chunkSeparator: '\\n\\n',
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z'
    }
    const tokens: ComposerSerializedToken[] = [
      { id: 'file:latest.txt', kind: 'file', label: 'latest.txt', index: 0, textOffset: 0 },
      { id: `knowledge:${base.id}`, kind: 'knowledge', label: base.name, index: 1, textOffset: 0 }
    ]
    const invisibleTool = defineTool({
      key: 'invisible',
      label: 'Invisible',
      visibleInScopes: [TopicType.Chat],
      dependencies: { actions: ['setFiles'] },
      composer: { tokens: { reconcile: (_draft, { actions }) => actions.setFiles([]) } }
    })
    mockGetAllTools.mockReturnValue([
      { ...attachmentTool, condition: () => false },
      { ...knowledgeBaseTool, condition: () => false },
      invisibleTool
    ])
    const ReconcileControls = ({ scope }: { scope: TopicType }) => {
      const { files, selectedKnowledgeBases } = useComposerToolState()
      const { setFiles } = useComposerToolDispatch()
      const reconcile = useComposerTokenReconcile({ scope })
      const [firstReconcile] = useState(() => reconcile)

      return (
        <>
          <button onClick={() => setFiles([fileAttachment('latest.txt'), fileAttachment('removed.txt')])}>
            Replace attachments
          </button>
          <button onClick={() => firstReconcile(tokens)}>Reconcile draft</button>
          <output aria-label="Remaining attachments">{files.map((file) => file.name).join(',')}</output>
          <output aria-label="Selected knowledge">{selectedKnowledgeBases.map((item) => item.name).join(',')}</output>
        </>
      )
    }
    const Harness = ({ selectableBases, scope }: { selectableBases: KnowledgeBase[]; scope: TopicType }) => (
      <ComposerToolRuntimeProvider
        initialState={{ files: [fileAttachment('old.txt')] }}
        actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        <ComposerToolDerivedStateProvider
          couldAddImageFile={false}
          extensions={[]}
          selectableKnowledgeBases={selectableBases}>
          <ReconcileControls scope={scope} />
        </ComposerToolDerivedStateProvider>
      </ComposerToolRuntimeProvider>
    )
    const view = render(<Harness selectableBases={[]} scope={TopicType.Chat} />)

    await user.click(screen.getByRole('button', { name: 'Replace attachments' }))
    view.rerender(<Harness selectableBases={[base]} scope={TopicType.Session} />)
    await user.click(screen.getByRole('button', { name: 'Reconcile draft' }))
    expect(screen.getByLabelText('Remaining attachments')).toHaveTextContent(/^latest.txt$/)
    expect(screen.getByLabelText('Selected knowledge')).toHaveTextContent(/^Manual$/)
  })
})

describe('ComposerToolRuntimeHost', () => {
  it('mounts only explicitly model-independent tools and forwards an absent assistant/model and the current session', () => {
    mockGetToolsForScope.mockReturnValue([
      defineTool({
        key: 'model-dependent',
        label: 'Model dependent',
        composer: { runtime: () => <button>Requires model</button> }
      }),
      defineTool({
        key: 'model-independent',
        label: 'Model independent',
        availableWithoutModel: true,
        composer: {
          runtime: ({ context }) => (
            <output aria-label="Model-free context">{`${context.assistant === undefined}:${context.model === undefined}:${context.session?.sessionId}`}</output>
          )
        }
      })
    ])

    render(
      <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        <ComposerToolRuntimeHost scope={TopicType.Session} session={{ sessionId: 'session-1' }} />
      </ComposerToolRuntimeProvider>
    )

    expect(screen.getByLabelText('Model-free context')).toHaveTextContent('true:true:session-1')
    expect(screen.queryByRole('button', { name: 'Requires model' })).not.toBeInTheDocument()
  })

  it('normalizes initial composer files with file token source ids', async () => {
    const onSnapshot = vi.fn()

    render(
      <ComposerToolRuntimeProvider
        initialState={{
          files: [
            {
              id: 'file-entry-1',
              path: '/tmp/report.pdf',
              fileTokenSourceId: '/tmp/report.pdf'
            } as any
          ]
        }}
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <FileStateObserver onSnapshot={onSnapshot} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'file-entry-1',
          path: '/tmp/report.pdf',
          fileTokenSourceId: expect.any(String)
        })
      ])
    })
    const file = onSnapshot.mock.lastCall?.[0]?.[0]
    expect(file.fileTokenSourceId).not.toBe('file-entry-1')
    expect(file.fileTokenSourceId).not.toBe('/tmp/report.pdf')
  })

  it('normalizes files written through setFiles', async () => {
    const onSnapshot = vi.fn()
    const nextFiles = [{ id: 'file-entry-2', path: '/tmp/notes.md' }]

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <FileStateWriter nextFiles={nextFiles} />
        <FileStateObserver onSnapshot={onSnapshot} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenLastCalledWith([
        expect.objectContaining({
          id: 'file-entry-2',
          path: '/tmp/notes.md',
          fileTokenSourceId: expect.any(String)
        })
      ])
    })
    const file = onSnapshot.mock.lastCall?.[0]?.[0]
    expect(file.fileTokenSourceId).not.toBe('file-entry-2')
    expect(file.fileTokenSourceId).not.toBe('/tmp/notes.md')
  })

  it('keeps the latest launcher registration when a stale disposer runs', async () => {
    let registration: { disposeFirst: () => void; readIds: () => string[] } | undefined
    const onReady = vi.fn((value) => {
      registration = value
    })

    renderRuntime([], <LauncherRegistrationProbe onReady={onReady} />)

    await waitFor(() => expect(registration?.readIds()).toEqual(['agent-skills']))

    act(() => registration?.disposeFirst())

    expect(registration?.readIds()).toEqual(['agent-skills'])
  })

  it('composes ordered footer actions for one panel and cleans up the owning registration', async () => {
    let registration:
      | {
          disposeFirst: () => void
          readIds: (panelSymbol: string) => string[]
        }
      | undefined
    const onReady = vi.fn((value) => {
      registration = value
    })

    const renderContent = (showProbe: boolean) => (
      <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        {showProbe ? <FooterActionRegistrationProbe onReady={onReady} /> : null}
      </ComposerToolRuntimeProvider>
    )
    const view = render(renderContent(true))

    await waitFor(() => {
      expect(registration?.readIds('quick-phrases')).toEqual(['manage-current', 'manage-global'])
    })
    expect(registration?.readIds('notes')).toEqual(['manage-notes'])
    expect(registration?.readIds('mcp-status')).toEqual([])

    act(() => registration?.disposeFirst())
    expect(registration?.readIds('quick-phrases')).toEqual(['manage-current', 'manage-global'])

    view.rerender(renderContent(false))
    expect(registration?.readIds('quick-phrases')).toEqual([])
    expect(registration?.readIds('notes')).toEqual([])
  })

  it('publishes registered actions for the active quick panel outside its result list', async () => {
    mockQuickPanelValue.isVisible = true
    mockQuickPanelValue.symbol = 'quick-phrases'

    const renderContent = () => (
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <RegisteredFooterActions />
        <ComposerToolFooterActionsSync />
      </ComposerToolRuntimeProvider>
    )
    mockGetToolsForScope.mockReturnValue([])
    const view = render(renderContent())

    await waitFor(() => {
      expect(mockQuickPanelValue.updateFooterActions).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'manage-current' }),
        expect.objectContaining({ id: 'manage-global' })
      ])
    })
    expect(mockQuickPanelValue.updateList).not.toHaveBeenCalled()

    mockQuickPanelValue.symbol = 'notes'
    view.rerender(renderContent())
    await waitFor(() => {
      expect(mockQuickPanelValue.updateFooterActions).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'manage-notes' })
      ])
    })

    mockQuickPanelValue.symbol = '/'
    mockQuickPanelValue.initialSearchText = 'skills'
    view.rerender(renderContent())
    await waitFor(() => {
      expect(mockQuickPanelValue.updateFooterActions).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 'customize-toolbar' })
      ])
    })

    mockQuickPanelValue.isVisible = false
    view.rerender(renderContent())
    expect(mockQuickPanelValue.updateFooterActions).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'customize-toolbar' })
    ])

    mockQuickPanelValue.symbol = ''
    view.rerender(renderContent())
    expect(mockQuickPanelValue.updateFooterActions).toHaveBeenLastCalledWith([])
  })
})

describe('ComposerToolMenu', () => {
  it('opens the unified QuickPanel from the plus trigger', async () => {
    const openUnifiedPanel = vi.fn()

    renderRuntime([], <ComposerToolMenu unifiedPanelControl={{ available: true, open: openUnifiedPanel }} />)

    fireEvent.click(screen.getByLabelText('settings.quickPanel.title'))

    expect(openUnifiedPanel).toHaveBeenCalledTimes(1)
  })
})

describe('ComposerActiveToolControls', () => {
  it('does not pin disabled active launchers in the composer input', async () => {
    renderRuntime(
      [
        defineTool({
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: {
              createItems: vi.fn(() => [
                {
                  active: true,
                  disabled: true,
                  id: 'disabled-active-tool',
                  kind: 'command',
                  label: 'DisabledActive',
                  icon: 'fake',
                  sources: ['popover'],
                  suffix: 'Off',
                  action: vi.fn()
                }
              ])
            }
          }
        })
      ],
      <ComposerActiveToolControls />
    )

    await waitFor(() => expect(screen.queryByLabelText('DisabledActive')).not.toBeInTheDocument())
  })
})
