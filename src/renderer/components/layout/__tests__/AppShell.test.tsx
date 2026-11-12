// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { DragEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUI from '@cherrystudio/ui'
import type * as CommandHooks from '@renderer/hooks/command'
import { useDrag } from '@renderer/hooks/useDrag'
import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'

vi.mock('@cherrystudio/ui', async () => vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui'))

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(() => 'preview'),
  updateTab: vi.fn(),
  closeTab: vi.fn(),
  closeTabs: vi.fn(),
  detachTab: vi.fn(),
  setActiveTab: vi.fn(),
  commandHandlers: new Map<string, { handler: () => void; options?: CommandHooks.CommandHandlerOptions }>(),
  ipcHandlers: new Map<string, (value: unknown) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve(false)),
  activeTabId: 'home',
  platformState: { isMac: false },
  tabs: [
    {
      id: 'home',
      isDormant: false,
      title: 'Chat',
      type: 'route' as const,
      url: '/app/chat'
    }
  ],
  tabBarProps: undefined as Record<string, unknown> | undefined,
  showSearchPopup: vi.fn(),
  hideSearchPopup: vi.fn()
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/platform', () => ({
  get platform() {
    return mocks.platformState.isMac ? 'darwin' : 'win32'
  },
  get isMac() {
    return mocks.platformState.isMac
  },
  isLinux: false
}))

vi.mock('@renderer/hooks/command', async (importOriginal) => {
  const actual = await importOriginal<typeof CommandHooks>()
  return {
    ...actual,
    useCommandHandler: (
      command: Parameters<typeof actual.useCommandHandler>[0],
      handler: () => void,
      options?: Parameters<typeof actual.useCommandHandler>[2]
    ) => {
      mocks.commandHandlers.set(command, { handler, options })
      actual.useCommandHandler(command, handler, options)
    }
  }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest
  },
  useIpcOn: (event: string, handler: (value: unknown) => void) => {
    mocks.ipcHandlers.set(event, handler)
  }
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup,
    hide: mocks.hideSearchPopup
  }
}))

vi.mock('../../../hooks/tab', async () => {
  const actual = (await vi.importActual('../../../hooks/tab')) as Record<string, unknown>
  return {
    ...(actual as object),
    useMainWindowNavigation: vi.fn(),
    useTabs: () => ({
      activeTabId: mocks.activeTabId,
      closeTab: mocks.closeTab,
      closeTabs: mocks.closeTabs,
      detachTab: mocks.detachTab,
      openTab: mocks.openTab,
      pinTab: vi.fn(),
      reorderTabs: vi.fn(),
      setActiveTab: mocks.setActiveTab,
      tabs: mocks.tabs,
      unpinTab: vi.fn(),
      updateTab: mocks.updateTab
    })
  }
})

vi.mock('../../app/Sidebar', () => ({
  default: () => <aside data-testid="sidebar" />
}))

vi.mock('../../GlobalSearch/globalSearchGroups', () => ({
  createRecentRouteEntryFromTab: () => null,
  upsertGlobalSearchRecentEntry: (items: unknown[]) => items
}))

vi.mock('../../MiniApp/MiniAppTabsPool', () => ({
  default: () => <div data-testid="mini-app-pool" />
}))

vi.mock('../../ResourceViewSourceProvider', () => ({
  ResourceViewSourceProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="resource-view-source-provider">{children}</div>
  )
}))

vi.mock('../AppShellTabBar', () => ({
  AppShellTabBar: (props: Record<string, unknown>) => {
    mocks.tabBarProps = props
    return <header data-testid="tab-bar" />
  }
}))

vi.mock('../TabRouter', () => ({
  TabRouter: ({ tab }: { tab: { id: string } }) => <section data-testid="tab-router" data-tab-id={tab.id} />
}))

import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'

import { AppShell } from '../AppShell'

function ShellWithCommands() {
  return (
    <CommandContextKeyProvider>
      <CommandProvider>
        <AppShell />
        <button type="button">Command target</button>
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

function pressShellCommand(key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true })
  act(() => {
    screen.getByRole('button', { name: 'Command target' }).dispatchEvent(event)
  })
  return event.defaultPrevented
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  MockUseCacheUtils.resetMocks()
  mocks.commandHandlers.clear()
  mocks.ipcHandlers.clear()
  mocks.ipcRequest.mockResolvedValue(false)
  mocks.activeTabId = 'home'
  mocks.platformState.isMac = false
  mocks.tabs = [
    {
      id: 'home',
      isDormant: false,
      title: 'Chat',
      type: 'route',
      url: '/app/chat'
    }
  ]
  mocks.tabBarProps = undefined
})

describe('AppShell', () => {
  it('applies the compact minimum window size for the active chat tab and resets it on leaving', async () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'agents',
        isDormant: false,
        title: 'Agents',
        type: 'route',
        url: '/app/agents'
      },
      {
        id: 'files',
        isDormant: false,
        title: 'Files',
        type: 'route',
        url: '/app/files'
      }
    ]

    const { rerender } = render(<AppShell />)

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('window.main.set_minimum_size', {
        width: SECOND_MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT
      })
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.main.reset_minimum_size')

    // Switching between two compact tabs must not re-issue the IPC pair.
    mocks.ipcRequest.mockClear()
    mocks.activeTabId = 'agents'
    rerender(<AppShell />)
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.main.set_minimum_size', expect.anything())

    mocks.activeTabId = 'files'
    rerender(<AppShell />)
    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('window.main.reset_minimum_size')
    })
  })

  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.handler()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('restores the tab that was active before Settings when the focused tab closes or detaches', () => {
    const workspaceTabs = [
      { id: 'first', isDormant: false, title: 'First', type: 'route' as const, url: '/app/chat' },
      { id: 'second', isDormant: false, title: 'Second', type: 'route' as const, url: '/app/files' },
      { id: 'third', isDormant: false, title: 'Third', type: 'route' as const, url: '/app/notes' }
    ]
    const settingsTab = {
      id: 'settings',
      isDormant: false,
      title: 'Settings',
      type: 'route' as const,
      url: '/settings/provider'
    }
    mocks.tabs = workspaceTabs
    mocks.activeTabId = 'first'
    const view = render(<AppShell />)

    mocks.tabs = [...workspaceTabs, settingsTab]
    mocks.activeTabId = settingsTab.id
    view.rerender(<AppShell />)

    const closeFocusedTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeFocusedTab?.(settingsTab.id)

    expect(mocks.closeTabs).toHaveBeenCalledWith([settingsTab.id], 'first')
    expect(mocks.closeTab).not.toHaveBeenCalled()

    const detachFocusedTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachFocusedTab?.(settingsTab.id)

    expect(mocks.detachTab).toHaveBeenCalledWith(settingsTab.id, 'first')
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('restores the most recently accessed workspace tab when Settings is restored active', () => {
    const settingsTab = {
      id: 'settings',
      isDormant: false,
      lastAccessTime: 400,
      title: 'Settings',
      type: 'route' as const,
      url: '/settings/provider'
    }
    mocks.tabs = [
      { id: 'home', isDormant: true, lastAccessTime: 300, title: 'Home', type: 'route', url: '/app/chat' },
      { id: 'files', isDormant: true, lastAccessTime: 100, title: 'Files', type: 'route', url: '/app/files' },
      settingsTab,
      {
        id: 'translate',
        isDormant: true,
        lastAccessTime: 200,
        title: 'Translate',
        type: 'route',
        url: '/app/translate'
      }
    ]
    mocks.activeTabId = settingsTab.id

    render(<AppShell />)

    const closeFocusedTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeFocusedTab?.(settingsTab.id)
    expect(mocks.closeTabs).toHaveBeenCalledWith([settingsTab.id], 'home')

    const detachFocusedTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachFocusedTab?.(settingsTab.id)
    expect(mocks.detachTab).toHaveBeenCalledWith(settingsTab.id, 'home')
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('blocks and dismisses global search while the Settings tab is focused', () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'settings',
        isDormant: false,
        title: 'Settings',
        type: 'route',
        url: '/settings/provider'
      }
    ]
    mocks.activeTabId = 'settings'

    render(<AppShell />)
    mocks.commandHandlers.get('app.search')?.handler()

    expect(mocks.showSearchPopup).not.toHaveBeenCalled()
    expect(mocks.hideSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('exposes the maintained app content selector', () => {
    const { container } = render(<AppShell />)
    expect(container.firstElementChild?.matches('[data-ui~="app.shell"]')).toBe(true)
    expect(container.querySelectorAll('[data-ui~="app.shell"]')).toHaveLength(1)

    expect(screen.getByRole('main')).toHaveAttribute('data-ui', 'app.content')
  })

  it('uses the native titlebar area for the macOS traffic-light drag region', () => {
    mocks.platformState.isMac = true
    const { container } = render(<AppShell />)
    expect(container.firstElementChild?.matches('[data-ui~="app.shell"]')).toBe(true)
    expect(container.querySelectorAll('[data-ui~="app.shell"]')).toHaveLength(1)

    expect(screen.getByTestId('macos-traffic-light-drag-region')).toHaveClass('w-[env(titlebar-area-x)]')
  })

  it('removes macOS traffic light placeholders when the window is fullscreen', async () => {
    mocks.platformState.isMac = true
    mocks.ipcRequest.mockResolvedValue(true)

    const { container } = render(<AppShell />)

    await waitFor(() => {
      expect(screen.queryByTestId('macos-traffic-light-spacer')).toBeNull()
    })

    const root = container.firstElementChild
    const sidebar = screen.getByTestId('sidebar')
    const tabBar = screen.getByTestId('tab-bar')
    const contentColumn = tabBar.parentElement

    if (!(root instanceof HTMLElement) || !(contentColumn instanceof HTMLElement)) {
      throw new Error('Expected AppShell to render a root and content column')
    }

    expect(mocks.ipcRequest).toHaveBeenCalledWith('window.is_full_screen')
    expect(screen.queryByTestId('macos-traffic-light-drag-region')).toBeNull()
    expect(sidebar.parentElement?.children).toHaveLength(1)
    expect(contentColumn.parentElement).toBe(root)
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', true)
  })

  it('updates macOS traffic light placeholders from fullscreen events', async () => {
    mocks.platformState.isMac = true

    render(<AppShell />)

    expect(await screen.findByTestId('macos-traffic-light-spacer')).toBeInTheDocument()

    act(() => {
      mocks.ipcHandlers.get('window.fullscreen_changed')?.(true)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('macos-traffic-light-spacer')).toBeNull()
    })

    expect(screen.queryByTestId('macos-traffic-light-drag-region')).toBeNull()
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', true)

    act(() => {
      mocks.ipcHandlers.get('window.fullscreen_changed')?.(false)
    })

    expect(await screen.findByTestId('macos-traffic-light-spacer')).toBeInTheDocument()
    expect(screen.getByTestId('macos-traffic-light-drag-region')).toBeInTheDocument()
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', false)
  })

  it('cycles tabs via command handlers', () => {
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/app/files' },
      { id: 'tab3', isDormant: false, title: 'Tab 3', type: 'route', url: '/app/agents' }
    ]

    // home -> next -> tab2
    const { rerender } = render(<AppShell />)
    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab2')

    // tab3 -> next -> home
    mocks.activeTabId = 'tab3'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('home')

    // tab2 -> prev -> home
    mocks.activeTabId = 'tab2'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('home')

    // home -> prev -> tab3
    mocks.activeTabId = 'home'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab3')
  })

  it('leaves tab cycling keys unconsumed until another tab is reachable', () => {
    const { rerender } = render(<ShellWithCommands />)
    expect(pressShellCommand('Tab')).toBe(false)
    expect(pressShellCommand('Tab', true)).toBe(false)

    mocks.tabs = [...mocks.tabs, { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/app/files' }]
    mocks.activeTabId = 'missing'
    rerender(<ShellWithCommands />)
    expect(pressShellCommand('Tab')).toBe(false)
    expect(pressShellCommand('Tab', true)).toBe(false)

    mocks.activeTabId = 'home'
    rerender(<ShellWithCommands />)
    expect(pressShellCommand('Tab')).toBe(true)
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab2')
  })

  it('closes the active tab from the tab-close shortcut', () => {
    mocks.platformState.isMac = true
    mocks.tabs = [...mocks.tabs, { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/app/files' }]
    mocks.activeTabId = 'tab2'

    render(<AppShell />)
    mocks.commandHandlers.get('tab.close')?.handler()

    expect(mocks.closeTab).toHaveBeenCalledWith('tab2')
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.close')
  })

  it('closes the main window from the shortcut when the last tab is open on macOS', () => {
    mocks.platformState.isMac = true

    render(<AppShell />)
    mocks.commandHandlers.get('tab.close')?.handler()

    expect(mocks.ipcRequest).toHaveBeenCalledWith('window.close')
    expect(mocks.closeTab).not.toHaveBeenCalled()
  })

  it('keeps the Launchpad fallback when the last tab is closed by the shortcut off macOS', () => {
    render(<AppShell />)
    mocks.commandHandlers.get('tab.close')?.handler()

    expect(mocks.closeTab).toHaveBeenCalledWith('home')
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.close')
  })

  it('keeps the last-tab close via the tab bar on the empty-state fallback on macOS', () => {
    mocks.platformState.isMac = true

    render(<AppShell />)
    const closeTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeTab?.('home')

    expect(mocks.closeTab).toHaveBeenCalledWith('home')
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.close')
  })

  it('leaves the tab-close key unconsumed when no tab is active', () => {
    mocks.activeTabId = 'missing'
    render(<ShellWithCommands />)
    expect(pressShellCommand('w')).toBe(false)
    expect(mocks.closeTab).not.toHaveBeenCalled()
  })
})

describe('window file drops', () => {
  const originalGetPathForFile = window.api.file.getPathForFile
  const getPathForFile = vi.fn<(file: File) => string>()

  function transfer(files: File[], items: unknown[] = [], types = ['Files']) {
    return { files, items, types, dropEffect: 'copy' }
  }

  function dispatch(target: EventTarget, type: string, dataTransfer: object) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  function setup(path = '/docs/notes.md') {
    window.api.file.getPathForFile = getPathForFile
    getPathForFile.mockReturnValue(path)
    const view = render(<AppShell />)
    return { ...view, target: screen.getByTestId('tab-router'), file: new File([''], 'notes.md') }
  }

  afterEach(() => {
    window.api.file.getPathForFile = originalGetPathForFile
    getPathForFile.mockReset()
  })

  it.each(['/docs/README.md', '/docs/notes.markdown', '/docs/component.mdx', '/docs/大 写 #?.MD'])(
    'opens an unclaimed Markdown drop for %s',
    (path) => {
      const { target, file } = setup(path)
      const event = dispatch(target, 'drop', transfer([file]))
      expect(event.defaultPrevented).toBe(true)
      expect(mocks.openTab).toHaveBeenCalledExactlyOnceWith(`/app/file-preview?${new URLSearchParams({ path })}`, {
        title: path.split('/').at(-1),
        metadata: { filePreviewRefreshKey: 0 }
      })
    }
  )

  it.each(['preventDefault', 'stopPropagation'] as const)('respects descendant %s', (method) => {
    const { target, file } = setup()
    target.addEventListener('drop', (event) => event[method](), { once: true })
    const event = dispatch(target, 'drop', transfer([file]))
    expect(event.defaultPrevented).toBe(method === 'preventDefault')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('respects a same-document portal drop owner outside the React root container', () => {
    const { container, file, rerender } = setup()
    const onDrop = vi.fn((event: DragEvent<HTMLDivElement>) => event.preventDefault())
    rerender(
      <>
        <AppShell />
        {createPortal(<div data-testid="portal-drop-owner" onDrop={onDrop} />, document.body)}
      </>
    )

    const target = screen.getByTestId('portal-drop-owner')
    expect(document.body).toContainElement(target)
    expect(container).not.toContainElement(target)
    dispatch(target, 'drop', transfer([file]))

    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('respects a real useDrag consumer as the drop owner', () => {
    const { file, rerender } = setup()
    const onDrop = vi.fn()
    function DragConsumer() {
      const { handleDragOver, handleDrop } = useDrag<HTMLDivElement>((event) => onDrop(event.dataTransfer))
      return <div data-testid="drag-consumer" onDragOver={handleDragOver} onDrop={handleDrop} />
    }
    rerender(
      <>
        <AppShell />
        <DragConsumer />
      </>
    )

    const dataTransfer = transfer([file])
    dispatch(screen.getByTestId('drag-consumer'), 'drop', dataTransfer)

    expect(onDrop).toHaveBeenCalledExactlyOnceWith(dataTransfer)
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('rejects multiple files, unsupported and invalid paths, and non-file payloads', () => {
    const { target, file } = setup()
    const other = new File([''], 'other.txt')
    dispatch(target, 'drop', transfer([file, file]))
    dispatch(target, 'drop', transfer([file, other]))
    for (const path of ['/docs/notes.txt', '', 'relative.md']) {
      getPathForFile.mockReturnValue(path)
      expect(dispatch(target, 'drop', transfer([file])).defaultPrevented).toBe(false)
    }
    dispatch(target, 'drop', transfer([], [], ['text/plain', 'text/uri-list']))
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('rejects directory entries and accepts FileList-only transfers', () => {
    const { target, file } = setup()
    const directory = { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }
    expect(dispatch(target, 'drop', transfer([file], [directory])).defaultPrevented).toBe(false)
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(dispatch(target, 'drop', transfer([file])).defaultPrevented).toBe(true)
    expect(mocks.openTab).toHaveBeenCalledTimes(1)
  })

  it('cancels file dragover but preserves text dragover and its drop effect', () => {
    const { target } = setup()
    expect(dispatch(target, 'dragover', transfer([])).defaultPrevented).toBe(true)
    const text = transfer([], [], ['text/plain'])
    expect(dispatch(target, 'dragover', text).defaultPrevented).toBe(false)
    expect(text.dropEffect).toBe('copy')
  })

  it('removes listeners on unmount and registers exactly once on remount', () => {
    const { file, unmount } = setup()
    unmount()
    dispatch(window, 'drop', transfer([file]))
    expect(mocks.openTab).not.toHaveBeenCalled()
    render(<AppShell />)
    dispatch(screen.getByTestId('tab-router'), 'drop', transfer([file]))
    expect(mocks.openTab).toHaveBeenCalledTimes(1)
  })
})
