import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '../toolLauncher'
import type { ToolRenderContext } from '../tools/types'

const { mockGetToolsForScope, mockQuickPanelValue, mockTranslate, mockUseQuickPanel } = vi.hoisted(() => {
  const mockQuickPanelValue = {
    close: vi.fn(),
    isVisible: false,
    open: vi.fn(),
    symbol: '',
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
  ComposerPinnedToolsProvider,
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolLauncherController,
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

const menuLauncher: ComposerToolLauncher = {
  id: 'fake-menu',
  kind: 'command',
  label: 'Fake menu',
  icon: 'fake'
}

const runtimeLauncher: ComposerToolLauncher = {
  id: 'fake-runtime',
  kind: 'command',
  label: 'Fake runtime',
  icon: 'fake'
}

const LauncherObserver = ({
  onSnapshot,
  source
}: {
  onSnapshot: (ids: string[]) => void
  source?: 'popover' | 'root-panel'
}) => {
  const { getLaunchers } = useComposerToolLauncherController()

  useEffect(() => {
    onSnapshot(getLaunchers(source).map((launcher) => launcher.id))
  }, [getLaunchers, onSnapshot, source])

  return null
}

const LauncherActionReader = ({
  onRender,
  readRef
}: {
  onRender: () => void
  readRef: { current: () => string[] }
}) => {
  const { getLaunchers } = useComposerToolLauncherActions()
  onRender()
  readRef.current = () => getLaunchers().map((launcher) => launcher.id)
  return null
}

const LauncherReader = ({ readRef }: { readRef: { current: () => ComposerToolLauncher[] } }) => {
  const { getLaunchers } = useComposerToolLauncherActions()
  readRef.current = getLaunchers
  return null
}

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

const ToolStateControls = () => {
  const { setFiles, setSelectedKnowledgeBases } = useComposerToolDispatch()

  return (
    <>
      <button type="button" onClick={() => setFiles([{ id: 'file-1', path: '/tmp/file.txt' } as any])}>
        Add file
      </button>
      <button
        type="button"
        onClick={() => setSelectedKnowledgeBases([{ id: 'knowledge-1', name: 'Knowledge' } as any])}>
        Select knowledge
      </button>
    </>
  )
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

beforeEach(() => {
  mockGetToolsForScope.mockReset()
  mockUseQuickPanel.mockClear()
  mockQuickPanelValue.close.mockClear()
  mockQuickPanelValue.open.mockClear()
  mockQuickPanelValue.updateList.mockClear()
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
  it('blocks a pending attachment write when edit restoration disables the runtime', async () => {
    let completeSelection: (() => void) | undefined
    const Runtime = ({ context }: { context: ToolRenderContext<readonly [], readonly ['setFiles']> }) => {
      useEffect(
        () =>
          context.launcher.registerLaunchers([
            {
              ...runtimeLauncher,
              action: () => {
                completeSelection = () => context.actions.setFiles?.([{ id: 'late-file' } as any])
              }
            }
          ]),
        [context]
      )
      return null
    }
    mockGetToolsForScope.mockReturnValue([
      {
        key: 'attachment',
        label: 'Attachment',
        dependencies: { actions: ['setFiles'] },
        composer: { runtime: Runtime }
      }
    ])

    const files = vi.fn()
    const launchers = { current: () => [] as ComposerToolLauncher[] }
    const renderTree = (disabled: boolean) => (
      <ComposerToolRuntimeProvider actions={{ addNewTopic: vi.fn(), onTextChange: vi.fn() }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} disabled={disabled} />
        <LauncherReader readRef={launchers} />
        <FileStateObserver onSnapshot={files} />
      </ComposerToolRuntimeProvider>
    )
    const view = render(renderTree(false))

    await waitFor(() => expect(launchers.current()).toHaveLength(1))
    act(() => launchers.current()[0].action?.({} as any))
    expect(completeSelection).toBeDefined()

    view.rerender(renderTree(true))
    await waitFor(() => expect(launchers.current()[0].disabled).toBe(true))
    act(() => completeSelection?.())

    expect(files.mock.lastCall?.[0]).toEqual([])
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

  it('does not re-register tools when launcher registry updates its version', async () => {
    const createItems = vi.fn(() => [menuLauncher])
    let runtimeRegisterCount = 0

    const Runtime = ({ context }: { context: ToolRenderContext<readonly ['files'], readonly []> }) => {
      useEffect(() => {
        runtimeRegisterCount += 1
        return context.launcher.registerLaunchers([runtimeLauncher])
      }, [context.launcher])

      return null
    }

    mockGetToolsForScope.mockReturnValue([
      {
        key: 'fake-menu-tool',
        label: 'Fake menu tool',
        composer: {
          menuItems: { createItems }
        }
      },
      {
        key: 'fake-runtime-tool',
        label: 'Fake runtime tool',
        dependencies: {
          state: ['files']
        },
        composer: {
          runtime: Runtime
        }
      }
    ])

    const onSnapshot = vi.fn()
    const onNonReactiveRender = vi.fn()
    const readLaunchersRef = { current: () => [] as string[] }

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
        <LauncherActionReader onRender={onNonReactiveRender} readRef={readLaunchersRef} />
        <LauncherObserver onSnapshot={onSnapshot} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      const lastSnapshot = onSnapshot.mock.lastCall?.[0]
      expect(lastSnapshot).toHaveLength(2)
      expect(lastSnapshot).toEqual(expect.arrayContaining(['fake-menu', 'fake-runtime']))
    })
    expect(readLaunchersRef.current()).toEqual(expect.arrayContaining(['fake-menu', 'fake-runtime']))
    expect(onNonReactiveRender).toHaveBeenCalledTimes(1)
    expect(createItems).toHaveBeenCalledTimes(1)
    expect(runtimeRegisterCount).toBe(1)
  })

  it('re-registers only tools whose declared state dependencies change', async () => {
    const user = userEvent.setup()
    const createFileItems = vi.fn<
      (context: ToolRenderContext<readonly ['files'], readonly []>) => ComposerToolLauncher[]
    >(() => [menuLauncher])
    const createKnowledgeItems = vi.fn<
      (context: ToolRenderContext<readonly ['selectedKnowledgeBases'], readonly []>) => ComposerToolLauncher[]
    >(() => [runtimeLauncher])

    mockGetToolsForScope.mockReturnValue([
      {
        key: 'file-tool',
        label: 'File tool',
        dependencies: { state: ['files'] },
        composer: { menuItems: { createItems: createFileItems } }
      },
      {
        key: 'knowledge-tool',
        label: 'Knowledge tool',
        dependencies: { state: ['selectedKnowledgeBases'] },
        composer: { menuItems: { createItems: createKnowledgeItems } }
      }
    ])

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
        <ToolStateControls />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      expect(createFileItems).toHaveBeenCalledTimes(1)
      expect(createKnowledgeItems).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: 'Add file' }))

    await waitFor(() => expect(createFileItems).toHaveBeenCalledTimes(2))
    expect(createKnowledgeItems).toHaveBeenCalledTimes(1)
    expect(createFileItems.mock.lastCall?.[0].state.files).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Select knowledge' }))

    await waitFor(() => expect(createKnowledgeItems).toHaveBeenCalledTimes(2))
    expect(createFileItems).toHaveBeenCalledTimes(2)
    expect(createKnowledgeItems.mock.lastCall?.[0].state.selectedKnowledgeBases).toHaveLength(1)
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

  it('does not subscribe the runtime host to quick panel state', async () => {
    const runtimeRender = vi.fn()

    const Runtime = () => {
      runtimeRender()
      return null
    }

    mockGetToolsForScope.mockReturnValue([
      {
        key: 'fake-runtime-tool',
        label: 'Fake runtime tool',
        composer: {
          runtime: Runtime
        }
      }
    ])

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => expect(runtimeRender).toHaveBeenCalledTimes(1))
    expect(mockUseQuickPanel).not.toHaveBeenCalled()
  })
})

describe('ComposerToolMenu', () => {
  it('opens the unified QuickPanel from the plus trigger', async () => {
    const openUnifiedPanel = vi.fn()

    renderRuntime([], <ComposerToolMenu unifiedPanelControl={{ available: true, open: openUnifiedPanel }} />)

    fireEvent.click(screen.getByLabelText('settings.quickPanel.title'))

    expect(openUnifiedPanel).toHaveBeenCalledTimes(1)
  })

  it('does not render the plus trigger when the unified panel is unavailable', () => {
    renderRuntime([], <ComposerToolMenu unifiedPanelControl={{ available: false, open: vi.fn() }} />)

    expect(screen.queryByLabelText('settings.quickPanel.title')).not.toBeInTheDocument()
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

  it('does not pin active launchers that opt out of composer active controls', async () => {
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
                  showInActiveControls: false,
                  id: 'unpinned-active-tool',
                  kind: 'command',
                  label: 'UnpinnedActive',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerActiveToolControls />
    )

    await waitFor(() => expect(screen.queryByLabelText('UnpinnedActive')).not.toBeInTheDocument())
  })

  it('drops active launchers already rendered by the pinned toolbar (dedup)', async () => {
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
                  id: 'pinned-active-tool',
                  kind: 'command',
                  label: 'PinnedActive',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerPinnedToolsProvider value={['pinned-active-tool']}>
        <ComposerActiveToolControls />
      </ComposerPinnedToolsProvider>
    )

    await waitFor(() => expect(screen.queryByLabelText('PinnedActive')).not.toBeInTheDocument())
  })

  it('shows an active launcher as a chip when it is not pinned (backfill)', async () => {
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
                  id: 'unpinned-active-tool',
                  kind: 'command',
                  label: 'BackfilledActive',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerPinnedToolsProvider value={['some-other-tool']}>
        <ComposerActiveToolControls />
      </ComposerPinnedToolsProvider>
    )

    await waitFor(() => expect(screen.queryByLabelText('BackfilledActive')).toBeInTheDocument())
  })
})

describe('ComposerToolLauncher sources', () => {
  it('exposes submenu options to the root panel without adding their parent', async () => {
    const onSnapshot = vi.fn()

    mockGetToolsForScope.mockReturnValue([
      {
        key: 'fake-menu-tool',
        label: 'Fake menu tool',
        composer: {
          menuItems: {
            createItems: vi.fn(() => [
              {
                id: 'mode-parent',
                kind: 'group',
                label: 'ModeParent',
                icon: 'fake',
                sources: ['popover'],
                submenu: [
                  {
                    id: 'mode-child-fast',
                    kind: 'command',
                    label: 'FastMode',
                    icon: 'fake',
                    sources: ['root-panel'],
                    action: vi.fn()
                  }
                ]
              }
            ])
          }
        }
      }
    ])

    render(
      <ComposerToolRuntimeProvider
        actions={{
          addNewTopic: vi.fn(),
          onTextChange: vi.fn()
        }}>
        <ComposerToolRuntimeHost scope={TopicType.Chat} assistant={assistant} model={model} />
        <LauncherObserver source="root-panel" onSnapshot={onSnapshot} />
      </ComposerToolRuntimeProvider>
    )

    await waitFor(() => {
      const lastSnapshot = onSnapshot.mock.lastCall?.[0]
      expect(lastSnapshot).toEqual(['mode-child-fast'])
    })
  })
})
