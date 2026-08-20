import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSyncRafMock } from '../../../../../../../tests/__mocks__/requestAnimationFrame'
import { QuickPanelProvider } from '../../../../QuickPanel/QuickPanelProvider'
import { QuickPanelView } from '../../../../QuickPanel/QuickPanelView'
import type { QuickPanelInputAdapter, QuickPanelListItem } from '../../../../QuickPanel/types'
import { useQuickPanel } from '../../../../QuickPanel/useQuickPanel'
import { QuickPhrasesToolRuntime } from '../QuickPhrasesButton'

const mocks = vi.hoisted(() => ({
  quickPanelClose: vi.fn(),
  quickPanelOpen: vi.fn(),
  quickPanelUpdateList: vi.fn(),
  setTimeoutTimer: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: (...args: unknown[]) => mocks.useMutation(...args),
  useQuery: (...args: unknown[]) => mocks.useQuery(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/edit', () => ({
  PromptEditDialog: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? (
      <div data-testid="prompt-edit-dialog">
        <button type="button" onClick={onCancel}>
          close prompt edit
        </button>
      </div>
    ) : null
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/manage', () => ({
  PromptManagementDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div data-testid="prompt-management-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          close prompt management
        </button>
      </div>
    ) : null
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  useQuickPanel: () => ({
    close: mocks.quickPanelClose,
    isVisible: false,
    open: mocks.quickPanelOpen,
    symbol: '',
    updateList: mocks.quickPanelUpdateList
  })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: mocks.setTimeoutTimer
  })
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (_error: unknown, prefix: string) => prefix
}))

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof LucideReact>()),
  Pencil: () => <span data-testid="pencil-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Zap: () => <span data-testid="zap-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

function FilteredPromptPanel({
  items,
  inputAdapter
}: {
  items: QuickPanelListItem[]
  inputAdapter: QuickPanelInputAdapter
}) {
  const { open } = useQuickPanel()

  useEffect(() => {
    open({
      list: items,
      symbol: 'quick-phrases',
      title: 'settings.prompts.title',
      trackInputQuery: true,
      queryAnchor: 0,
      triggerInfo: { type: 'input', position: 0, originalText: inputAdapter.getText() }
    })
  }, [inputAdapter, items, open])

  return <QuickPanelView inputAdapter={inputAdapter} />
}

let restoreRequestAnimationFrame: (() => void) | undefined
describe('QuickPhrasesToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useQuery.mockReturnValue({
      data: [{ id: 'prompt-1', title: 'Prompt 1', content: 'Prompt content' }],
      error: undefined,
      isLoading: false
    })
    mocks.useMutation.mockReturnValue({
      trigger: vi.fn(),
      isLoading: false
    })
    mocks.setTimeoutTimer.mockImplementation((_key: string, callback: () => void) => callback())
    restoreRequestAnimationFrame = installSyncRafMock()
  })

  afterEach(() => {
    restoreRequestAnimationFrame?.()
    restoreRequestAnimationFrame = undefined
  })

  it('opens the quick phrases panel directly from the slash root without closing first', async () => {
    const launcher = createLauncherApi()
    const parentPanel = {
      list: [],
      symbol: '/'
    }
    const triggerInfo = {
      type: 'input' as const,
      position: 0,
      originalText: '/prompt'
    }
    const inputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 6,
      getText: () => 'prompt',
      insertText: vi.fn()
    }

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: false })

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        inputAdapter,
        parentPanel,
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo
      })
    })

    await waitFor(() => expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: true }))
    expect(mocks.quickPanelClose).not.toHaveBeenCalled()
    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 6 })
    expect(inputAdapter.focus).toHaveBeenCalled()
    expect(mocks.setTimeoutTimer).not.toHaveBeenCalledWith(
      'openQuickPhrasesRootMenu',
      expect.any(Function),
      expect.any(Number)
    )
    expect(mocks.quickPanelOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPanel,
        queryAnchor: 0,
        symbol: 'quick-phrases',
        trackInputQuery: true,
        triggerInfo: { type: 'button', position: 0 }
      })
    )
  })

  it('adds a prompt management action without replacing the add prompt action', async () => {
    const launcher = createLauncherApi()

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        parentPanel: { list: [], symbol: '/' },
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo: { type: 'button' }
      })
    })

    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(panelOptions.list.map((item: { label: string }) => item.label)).toEqual([
      'Prompt 1',
      'settings.prompts.manage',
      'settings.prompts.add...'
    ])

    const manageItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.manage')
    act(() => {
      manageItem.action({} as never)
    })

    expect(await screen.findByTestId('prompt-management-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('prompt-edit-dialog')).not.toBeInTheDocument()
  })

  it('restores composer focus after closing the add prompt dialog opened from quick panel', async () => {
    const launcher = createLauncherApi()
    const inputAdapter = { focus: vi.fn() }

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        parentPanel: { list: [], symbol: '/' },
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo: { type: 'button' }
      })
    })

    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    const addItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.add...')

    act(() => {
      addItem.action({ inputAdapter } as never)
    })
    act(() => {
      screen.getByText('close prompt edit').click()
    })

    expect(inputAdapter.focus).toHaveBeenCalledTimes(1)
  })

  it('restores composer focus after closing the prompt management dialog opened from quick panel', async () => {
    const launcher = createLauncherApi()
    const inputAdapter = { focus: vi.fn() }

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        parentPanel: { list: [], symbol: '/' },
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo: { type: 'button' }
      })
    })

    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    const manageItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.manage')

    act(() => {
      manageItem.action({ inputAdapter } as never)
    })
    act(() => {
      screen.getByText('close prompt management').click()
    })

    expect(inputAdapter.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps manage and add actions visible as fixed bottom rows when no prompt matches the composer query', async () => {
    const launcher = createLauncherApi()

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        parentPanel: { list: [], symbol: '/' },
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo: { type: 'button' }
      })
    })

    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 15,
      getText: () => '/does-not-exist',
      insertText: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <FilteredPromptPanel items={panelOptions.list} inputAdapter={inputAdapter} />
      </QuickPanelProvider>
    )

    const fixedBottom = await screen.findByTestId('quick-panel-fixed-bottom')
    const visibleActions = within(fixedBottom)
      .getAllByRole('button')
      .map((row) => row.textContent)

    expect(screen.queryByText('Prompt 1')).not.toBeInTheDocument()
    expect(visibleActions).toEqual(['settings.prompts.manage', 'settings.prompts.add...'])

    act(() => {
      fireEvent.click(within(fixedBottom).getByText('settings.prompts.manage'))
    })

    expect(await screen.findByTestId('prompt-management-dialog')).toBeInTheDocument()
  })
})
