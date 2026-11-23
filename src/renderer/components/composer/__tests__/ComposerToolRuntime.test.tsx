import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetToolsForScope, mockQuickPanelValue, mockTranslate, mockUseQuickPanel } = vi.hoisted(() => {
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
    mockGetToolsForScope: vi.fn(),
    mockQuickPanelValue,
    mockTranslate: (key: string) => key,
    mockUseQuickPanel: vi.fn(() => mockQuickPanelValue)
  }
})

vi.mock('@renderer/components/composer/tools/builtinTools', () => ({
  getAllTools: () => [],
  getToolsForScope: (...args: unknown[]) => mockGetToolsForScope(...args)
}))

vi.mock('@renderer/components/composer/tools/types', () => ({
  TopicType: {
    Chat: 'chat',
    Session: 'session'
  }
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

import {
  ComposerActiveToolControls,
  ComposerToolFooterActionsSync,
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolState
} from '../ComposerToolRuntime'
import { TopicType } from '../tools/types'

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

const renderRuntime = (tools: any[], node: ReactNode) => {
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

describe('ComposerToolRuntimeHost', () => {
  it('mounts only explicitly model-independent tools when no chat model is available', () => {
    mockGetToolsForScope.mockReturnValue([
      {
        key: 'model-dependent',
        label: 'Model dependent',
        composer: { runtime: () => <div data-testid="model-dependent-runtime" /> }
      },
      {
        key: 'model-independent',
        label: 'Model independent',
        availableWithoutModel: true,
        composer: { runtime: () => <div data-testid="model-independent-runtime" /> }
      }
    ])

    render(
      <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} />
      </ComposerToolRuntimeProvider>
    )

    expect(screen.getByTestId('model-independent-runtime')).toBeInTheDocument()
    expect(screen.queryByTestId('model-dependent-runtime')).not.toBeInTheDocument()
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
        {
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
        }
      ],
      <ComposerActiveToolControls />
    )

    await waitFor(() => expect(screen.queryByLabelText('DisabledActive')).not.toBeInTheDocument())
  })
})
