import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QuickPhrasesToolRuntime } from '../QuickPhrasesButton'

const mocks = vi.hoisted(() => ({
  createPrompt: vi.fn(),
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
  PromptEditDialog: ({
    open,
    onCancel,
    onSave
  }: {
    open: boolean
    onCancel: () => void
    onSave: (data: { title: string; content: string }) => Promise<void>
  }) =>
    open ? (
      <div data-testid="prompt-edit-dialog">
        <button type="button" onClick={() => void onSave({ title: 'New prompt', content: 'New content' })}>
          save prompt
        </button>
        <button type="button" onClick={onCancel}>
          close prompt edit
        </button>
      </div>
    ) : null
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/manage', () => ({
  PromptManagementDialog: ({
    agentId,
    assistantId,
    open,
    onOpenChange
  }: {
    agentId?: string
    assistantId?: string
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="prompt-management-dialog">
        <span data-testid="prompt-management-binding-target">{assistantId ?? agentId}</span>
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
import { installSyncRafMock } from '../../../../../../../tests/__mocks__/requestAnimationFrame'
let restoreRequestAnimationFrame: (() => void) | undefined
describe('QuickPhrasesToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useQuery.mockReturnValue({
      data: [{ id: 'prompt-1', title: 'Prompt 1', content: 'Prompt content' }],
      error: undefined,
      isLoading: false
    })
    mocks.createPrompt.mockResolvedValue(undefined)
    mocks.useMutation.mockReturnValue({ trigger: mocks.createPrompt, isLoading: false })
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

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: false })

    const [quickPhrasesLauncher] = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    act(() => {
      quickPhrasesLauncher.action?.({
        parentPanel,
        queryAnchor: 0,
        quickPanel: {} as never,
        source: 'root-panel',
        triggerInfo
      })
    })

    await waitFor(() => expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: true }))
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
    const assistantId = '550e8400-e29b-41d4-a716-446655440001'

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} assistantId={assistantId} />)

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
    expect(screen.getByTestId('prompt-management-binding-target')).toHaveTextContent(assistantId)
    expect(screen.queryByTestId('prompt-edit-dialog')).not.toBeInTheDocument()
  })

  it('keeps the global quick-phrase list and auto-binds a new prompt to the current Assistant', async () => {
    const launcher = createLauncherApi()
    const assistantId = '550e8400-e29b-41d4-a716-446655440001'

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} assistantId={assistantId} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: false })

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

    await waitFor(() => expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', { enabled: true }))
    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(panelOptions.list.map((item: { label: string }) => item.label)).toEqual([
      'Prompt 1',
      'settings.prompts.manage',
      'settings.prompts.add...'
    ])

    const addItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.add...')
    act(() => {
      addItem.action({} as never)
    })
    screen.getByRole('button', { name: 'save prompt' }).click()

    await waitFor(() =>
      expect(mocks.createPrompt).toHaveBeenCalledWith({
        body: {
          title: 'New prompt',
          content: 'New content',
          bindingTarget: { type: 'assistant', id: assistantId }
        }
      })
    )
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
})
