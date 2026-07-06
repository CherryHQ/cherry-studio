import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  PromptEditDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="prompt-edit-dialog" /> : null)
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/manage', () => ({
  PromptManagementDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="prompt-management-dialog" /> : null
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

vi.mock('lucide-react', () => ({
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

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    quickPhrasesLauncher.action?.({
      parentPanel,
      queryAnchor: 0,
      quickPanel: {} as never,
      source: 'root-panel',
      triggerInfo
    })

    expect(mocks.quickPanelClose).not.toHaveBeenCalled()
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
        triggerInfo
      })
    )
  })

  it('adds a prompt management action without replacing the add prompt action', async () => {
    const launcher = createLauncherApi()

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    quickPhrasesLauncher.action?.({
      parentPanel: { list: [], symbol: '/' },
      queryAnchor: 0,
      quickPanel: {} as never,
      source: 'root-panel',
      triggerInfo: { type: 'button' }
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
})
