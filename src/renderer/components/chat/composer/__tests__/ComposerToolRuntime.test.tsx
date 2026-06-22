import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerToolLauncher } from '../toolLauncher'
import type { ToolRenderContext } from '../tools/types'

const { mockDropdownMenuSelectEvents, mockGetToolsForScope, mockQuickPanelValue, mockUseQuickPanel } = vi.hoisted(
  () => {
    const mockQuickPanelValue = {
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    }

    return {
      mockDropdownMenuSelectEvents: [] as Array<{
        ariaLabel: string | undefined
        preventDefault: ReturnType<typeof vi.fn>
        stopPropagation: ReturnType<typeof vi.fn>
      }>,
      mockGetToolsForScope: vi.fn(),
      mockQuickPanelValue,
      mockUseQuickPanel: vi.fn(() => mockQuickPanelValue)
    }
  }
)

vi.mock('@renderer/components/chat/composer/tools', () => ({}))

vi.mock('@renderer/components/chat/composer/tools/types', () => ({
  TopicType: {
    Chat: 'chat',
    Session: 'session'
  },
  getToolsForScope: (...args: unknown[]) => mockGetToolsForScope(...args)
}))

vi.mock('@renderer/components/chat/composer/panelEngine', () => ({
  useQuickPanel: () => mockUseQuickPanel()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider: { id: 'provider-1' } })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const getMenuItemTestId = (label: string) => `menu-item-${label.replace(/\s+/g, '-')}`
const getMenuItemSuffixTestId = (label: string) => `menu-item-suffix-${label.replace(/\s+/g, '-')}`

vi.mock('@cherrystudio/ui', () => ({
  ContextMenuItemContent: ({ badge, children, hasSubmenu, icon: _icon }: any) => (
    <>
      <span>
        {_icon ? <span>{_icon}</span> : null}
        <span>{children}</span>
      </span>
      {badge ? <span data-testid={getMenuItemSuffixTestId(String(children))}>{badge}</span> : null}
      {hasSubmenu ? <svg aria-hidden="true" /> : null}
    </>
  ),
  DropdownMenu: ({ children, onOpenChange, open }: any) => {
    useEffect(() => {
      onOpenChange?.(true)
    }, [onOpenChange])

    return (
      <div data-open={open ? 'true' : 'false'} data-testid="composer-tool-dropdown-root">
        {children}
      </div>
    )
  },
  DropdownMenuContent: ({ children, className, sideOffset }: any) => (
    <div className={className} data-side-offset={sideOffset} data-testid="composer-tool-dropdown-content">
      {children}
    </div>
  ),
  DropdownMenuItem: ({ 'aria-label': ariaLabel, className, disabled, onSelect, ...props }: any) => (
    <div
      aria-disabled={disabled ? 'true' : undefined}
      className={className}
      data-disabled={disabled ? '' : undefined}
      data-slot="dropdown-menu-item"
      data-testid={getMenuItemTestId(ariaLabel)}
      onClick={() => {
        const selectEvent = {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        mockDropdownMenuSelectEvents.push({ ariaLabel, ...selectEvent })
        onSelect?.(selectEvent)
      }}
      {...props}>
      {props.children}
    </div>
  ),
  DropdownMenuSub: ({ children }: any) => <div data-slot="dropdown-menu-sub">{children}</div>,
  DropdownMenuSubContent: ({ children, className }: any) => (
    <div className={className} data-slot="dropdown-menu-sub-content" data-testid="dropdown-menu-sub-content">
      {children}
    </div>
  ),
  DropdownMenuSubTrigger: ({ 'aria-label': ariaLabel, children, className, disabled }: any) => (
    <button
      type="button"
      className={className}
      data-slot="dropdown-menu-sub-trigger"
      data-testid={`dropdown-menu-sub-trigger-${ariaLabel}`}
      disabled={disabled}>
      {children}
      <svg aria-hidden="true" />
    </button>
  ),
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
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

beforeEach(() => {
  mockDropdownMenuSelectEvents.length = 0
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
  it('renders only popover launchers in the plus menu', async () => {
    renderRuntime(
      [
        {
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: {
              createItems: vi.fn(() => [
                {
                  id: 'popover-only',
                  kind: 'command',
                  label: 'Popover only',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                },
                {
                  id: 'root-only',
                  kind: 'command',
                  label: 'Root only',
                  icon: 'fake',
                  sources: ['root-panel'],
                  action: vi.fn()
                },
                {
                  id: 'both',
                  kind: 'command',
                  label: 'Both',
                  icon: 'fake',
                  sources: ['popover', 'root-panel'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerToolMenu />
    )

    expect(await screen.findByText('Popover only')).toBeInTheDocument()
    expect(screen.getByText('Both')).toBeInTheDocument()
    expect(screen.queryByText('Root only')).not.toBeInTheDocument()
  })

  it('does not render the plus trigger when there are no popover launchers', async () => {
    const createItems = vi.fn(() => [
      {
        id: 'root-only',
        kind: 'command',
        label: 'Root only',
        icon: 'fake',
        sources: ['root-panel'],
        action: vi.fn()
      }
    ])

    renderRuntime(
      [
        {
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: { createItems }
          }
        }
      ],
      <ComposerToolMenu />
    )

    await waitFor(() => {
      expect(createItems).toHaveBeenCalled()
    })

    expect(screen.queryByLabelText('common.add')).not.toBeInTheDocument()
    expect(screen.queryByText('Root only')).not.toBeInTheDocument()
  })

  it('keeps disabled reasons in a tooltip instead of the menu row', async () => {
    renderRuntime(
      [
        {
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: {
              createItems: vi.fn(() => [
                {
                  disabled: true,
                  disabledReason: 'Requires a compatible model',
                  id: 'disabled-tool',
                  kind: 'command',
                  label: 'Disabled tool',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerToolMenu />
    )

    expect(await screen.findByText('Disabled tool')).toBeInTheDocument()
    expect(screen.queryByText('Requires a compatible model')).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-tool-tooltip')).toHaveAttribute(
      'data-tooltip-content',
      'Requires a compatible model'
    )
    expect(screen.getByTestId('composer-tool-tooltip')).toHaveAttribute('data-tooltip-open', 'false')

    fireEvent.mouseMove(screen.getByTestId(getMenuItemTestId('Disabled tool')))

    expect(screen.getByTestId('composer-tool-tooltip')).toHaveAttribute('data-tooltip-open', 'true')
  })

  it('keeps the plus menu single-line while allowing content-sized width', async () => {
    renderRuntime(
      [
        {
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: {
              createItems: vi.fn(() => [
                {
                  id: 'compact-tool',
                  kind: 'command',
                  label: 'CompactTool',
                  icon: 'fake',
                  suffix: 'Localized suffix',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerToolMenu />
    )

    await screen.findByText('CompactTool')
    expect(screen.getByTestId('composer-tool-dropdown-content')).toHaveClass(
      'min-w-52',
      'w-max',
      'max-w-[calc(100vw-2rem)]'
    )
    expect(screen.getByTestId('composer-tool-dropdown-content')).not.toHaveClass('w-52')
    expect(screen.getByTestId('composer-tool-dropdown-content')).toHaveAttribute('data-side-offset', '4')
    expect(screen.getByTestId(getMenuItemTestId('CompactTool'))).toHaveAttribute('data-slot', 'dropdown-menu-item')
    expect(screen.getByText('CompactTool')).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('Localized suffix')).toHaveClass('shrink-0', 'whitespace-nowrap')
  })

  it('does not apply active styling to disabled launchers', async () => {
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
                  disabledReason: 'Disabled because unavailable',
                  id: 'disabled-active-tool',
                  kind: 'command',
                  label: 'DisabledActive',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerToolMenu />
    )

    expect(await screen.findByText('DisabledActive')).toBeInTheDocument()
    expect(screen.getByTestId(getMenuItemTestId('DisabledActive'))).not.toHaveClass('bg-accent')
    expect(screen.queryByText('Disabled because unavailable')).not.toBeInTheDocument()
  })

  it('uses an icon chevron instead of a text arrow for panel launchers', async () => {
    renderRuntime(
      [
        {
          key: 'fake-menu-tool',
          label: 'Fake menu tool',
          composer: {
            menuItems: {
              createItems: vi.fn(() => [
                {
                  id: 'panel-tool',
                  kind: 'panel',
                  label: 'PanelTool',
                  icon: 'fake',
                  sources: ['popover'],
                  action: vi.fn()
                }
              ])
            }
          }
        }
      ],
      <ComposerToolMenu />
    )

    expect(await screen.findByText('PanelTool')).toBeInTheDocument()
    expect(screen.queryByText('›')).not.toBeInTheDocument()
    expect(screen.getByTestId(getMenuItemTestId('PanelTool')).querySelector('svg')).toBeInTheDocument()
  })

  it('renders only popover submenu items with shadcn dropdown sub components', async () => {
    const popoverModeAction = vi.fn()

    renderRuntime(
      [
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
                      id: 'mode-child-popover',
                      kind: 'command',
                      label: 'PopoverMode',
                      description: 'Popover mode description',
                      icon: 'fake',
                      sources: ['popover'],
                      action: popoverModeAction
                    },
                    {
                      id: 'mode-child-root',
                      kind: 'command',
                      label: 'RootMode',
                      description: 'Root mode description',
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
      ],
      <ComposerToolMenu />
    )

    expect(await screen.findByTestId('dropdown-menu-sub-trigger-ModeParent')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('composer-tool-dropdown-root')).toHaveAttribute('data-open', 'true')
    })
    expect(screen.getByTestId('dropdown-menu-sub-content')).toHaveClass(
      'min-w-44',
      'w-max',
      'max-w-[calc(100vw-2rem)]',
      'data-[state=closed]:hidden'
    )
    expect(screen.getByText('PopoverMode')).toBeInTheDocument()
    expect(screen.queryByText('RootMode')).not.toBeInTheDocument()
    expect(screen.queryByText('Popover mode description')).not.toBeInTheDocument()
    expect(screen.queryByText('RootMode')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId(getMenuItemTestId('PopoverMode')))

    expect(popoverModeAction).toHaveBeenCalledTimes(1)
    const [selectEvent] = mockDropdownMenuSelectEvents
    expect(selectEvent).toMatchObject({ ariaLabel: 'PopoverMode' })
    expect(selectEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(selectEvent.stopPropagation).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByTestId('composer-tool-dropdown-root')).toHaveAttribute('data-open', 'false')
    })
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
