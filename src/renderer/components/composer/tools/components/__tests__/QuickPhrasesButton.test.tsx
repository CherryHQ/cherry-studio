import { act, render, screen, waitFor } from '@testing-library/react'
import type * as LucideReact from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'

import { QuickPhrasesToolRuntime } from '../QuickPhrasesButton'

const mocks = vi.hoisted(() => ({
  createPrompt: vi.fn(),
  openResourceEditDialog: vi.fn(),
  openSettingsTab: vi.fn(),
  quickPanelClose: vi.fn(),
  quickPanelOpen: vi.fn(),
  quickPanelUpdateList: vi.fn(),
  setTimeoutTimer: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
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
    defaultVisibility,
    open,
    onCancel,
    onSave
  }: {
    defaultVisibility?: 'global' | 'restricted'
    open: boolean
    onCancel: () => void
    onSave: (data: { title: string; content: string; visibility: 'global' | 'restricted' }) => Promise<void>
  }) =>
    open ? (
      <div data-testid="prompt-edit-dialog">
        <button
          type="button"
          onClick={() =>
            void onSave({ title: 'New prompt', content: 'New content', visibility: defaultVisibility ?? 'global' })
          }>
          save prompt
        </button>
        <button type="button" onClick={onCancel}>
          close prompt edit
        </button>
      </div>
    ) : null
}))
vi.mock('@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost', () => ({
  openResourceEditDialog: (...args: unknown[]) => mocks.openResourceEditDialog(...args)
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: (...args: unknown[]) => mocks.openSettingsTab(...args)
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

const ASSISTANT_ID = '550e8400-e29b-41d4-a716-446655440001'

let restoreRequestAnimationFrame: (() => void) | undefined
describe('QuickPhrasesToolRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useQuery.mockReturnValue({
      data: [{ id: 'prompt-1', title: 'Prompt 1', content: 'Prompt content', visibility: 'global' }],
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

  it('opens the quick phrases panel with the global fallback when no binding context exists', async () => {
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
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
      enabled: false,
      swrOptions: { keepPreviousData: false },
      query: { visibility: 'global' }
    })

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

    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
        enabled: true,
        swrOptions: { keepPreviousData: false },
        query: { visibility: 'global' }
      })
    )
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
        triggerInfo: { type: 'button' },
        trackInputQuery: true
      })
    )
  })

  it('opens the current Assistant prompt tab from the management action without replacing the add action', async () => {
    const launcher = createLauncherApi()
    const assistantId = ASSISTANT_ID

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
      'settings.prompts.add'
    ])

    const manageItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.manage')
    act(() => {
      manageItem.action({} as never)
    })

    expect(mocks.openResourceEditDialog).toHaveBeenCalledWith({
      kind: 'assistant',
      id: assistantId,
      initialTab: 'prompts'
    })
    expect(mocks.openSettingsTab).not.toHaveBeenCalled()
    expect(screen.queryByTestId('prompt-edit-dialog')).not.toBeInTheDocument()
  })

  it('lists global and linked Assistant prompts and defaults new prompts to restricted', async () => {
    const launcher = createLauncherApi()
    const assistantId = ASSISTANT_ID

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} assistantId={assistantId} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
      enabled: false,
      swrOptions: { keepPreviousData: false },
      query: { targetType: 'assistant', targetId: assistantId, includeGlobal: true }
    })

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

    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
        enabled: true,
        swrOptions: { keepPreviousData: false },
        query: { targetType: 'assistant', targetId: assistantId, includeGlobal: true }
      })
    )
    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    expect(panelOptions.list.map((item: { label: string }) => item.label)).toEqual([
      'Prompt 1',
      'settings.prompts.manage',
      'settings.prompts.add'
    ])

    const addItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.add')
    act(() => {
      addItem.action({} as never)
    })
    screen.getByRole('button', { name: 'save prompt' }).click()

    await waitFor(() =>
      expect(mocks.createPrompt).toHaveBeenCalledWith({
        body: {
          title: 'New prompt',
          content: 'New content',
          visibility: 'restricted',
          bindingTarget: { type: 'assistant', id: assistantId }
        }
      })
    )
  })

  it('lists global and linked Agent prompts', async () => {
    const launcher = createLauncherApi()
    const agentId = 'agent-1'

    render(<QuickPhrasesToolRuntime launcher={launcher} setInputValue={vi.fn()} agentId={agentId} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())
    expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
      enabled: false,
      swrOptions: { keepPreviousData: false },
      query: { targetType: 'agent', targetId: agentId, includeGlobal: true }
    })

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

    await waitFor(() =>
      expect(mocks.useQuery).toHaveBeenCalledWith('/prompts', {
        enabled: true,
        swrOptions: { keepPreviousData: false },
        query: { targetType: 'agent', targetId: agentId, includeGlobal: true }
      })
    )

    const panelOptions = mocks.quickPanelOpen.mock.calls[0][0]
    const manageItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.manage')
    act(() => {
      manageItem.action({} as never)
    })

    expect(mocks.openResourceEditDialog).toHaveBeenCalledWith({
      kind: 'agent',
      id: agentId,
      initialTab: 'prompts'
    })
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
    const addItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.add')

    act(() => {
      addItem.action({ inputAdapter } as never)
    })
    act(() => {
      screen.getByText('close prompt edit').click()
    })

    expect(inputAdapter.focus).toHaveBeenCalledTimes(1)
  })

  it('creates a global prompt without a binding when no target context exists', async () => {
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
    const addItem = panelOptions.list.find((item: { label: string }) => item.label === 'settings.prompts.add')

    act(() => {
      addItem.action({} as never)
    })
    screen.getByRole('button', { name: 'save prompt' }).click()

    await waitFor(() =>
      expect(mocks.createPrompt).toHaveBeenCalledWith({
        body: { title: 'New prompt', content: 'New content', visibility: 'global' }
      })
    )
  })
})
