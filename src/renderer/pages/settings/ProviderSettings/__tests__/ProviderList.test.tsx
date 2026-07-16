import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderList } from '../ProviderList'

const reorderSpy = vi.fn()
const useProvidersMock = vi.fn()
const useProviderActionsMock = vi.fn()
const useModelsMock = vi.fn()
const useReorderMock = vi.fn()
const useOvmsSupportMock = vi.fn()
const deleteProviderMock = vi.fn()
const scrollIntoViewMock = vi.fn()
let providerItemRects: Record<string, { bottom: number; top: number }> = {}
let scrollerRect = { bottom: 100, top: 0 }
let providerListScrollerClientHeight = 100
let providerListMainContentScrollHeight = 120

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    ReorderableList: ({ visibleItems, renderItem, onReorder, onReorderError }: any) => (
      <div data-provider-list-scroller>
        {visibleItems.map((item: any, index: number) => (
          <div key={item.id}>{renderItem(item, index, { dragging: false })}</div>
        ))}
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(onReorder([...visibleItems].reverse())).catch(onReorderError)
          }}>
          trigger-reorder
        </button>
      </div>
    )
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: (...args: any[]) => useProvidersMock(...args),
  useProviderActions: (...args: any[]) => useProviderActionsMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, className, ref: passedRef }: any) => (
    <div
      className={className}
      data-testid="provider-list-scrollbar"
      ref={(element) => {
        if (element) {
          element.getBoundingClientRect = () =>
            ({
              bottom: scrollerRect.bottom,
              top: scrollerRect.top
            }) as DOMRect
        }

        if (typeof passedRef === 'function') {
          passedRef(element)
        }
      }}>
      {children}
    </div>
  )
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: (...args: any[]) => useReorderMock(...args)
}))

vi.mock('../hooks/useOvmsSupport', () => ({
  useOvmsSupport: (...args: any[]) => useOvmsSupportMock(...args)
}))

vi.mock('../ProviderList/useProviderDelete', () => ({
  useProviderDelete: () => ({
    deleteProvider: deleteProviderMock
  })
}))

vi.mock('../ProviderList/ProviderListItemWithContextMenu', () => ({
  default: ({ provider, selected, onSelect, onDelete, showManagementActions, onSetListItemRef }: any) => (
    <div
      data-testid={`provider-list-item-${provider.id}`}
      data-selected={selected ? 'true' : 'false'}
      ref={(element) => {
        if (element) {
          element.scrollIntoView = scrollIntoViewMock
          element.getBoundingClientRect = () => {
            const rect = providerItemRects[provider.id] ?? { bottom: 40, top: 20 }
            return {
              bottom: rect.bottom,
              top: rect.top
            } as DOMRect
          }
        }

        onSetListItemRef(provider.id, element)
      }}>
      <button type="button" onClick={onSelect}>
        {provider.name}
      </button>
      <button type="button" data-testid={`provider-list-delete-${provider.id}`} onClick={onDelete}>
        delete
      </button>
      <span data-testid={`provider-list-manage-${provider.id}`}>{showManagementActions ? 'true' : 'false'}</span>
    </div>
  )
}))

vi.mock('../ProviderList/ProviderEditorDrawer', () => ({
  default: ({ open }: any) => <div data-testid="provider-editor-drawer" data-open={open ? 'true' : 'false'} />
}))

// The confirm-and-run dialog itself is covered by its own unit test; here we just let it run
// the gated action (as if the user confirmed) and assert the delete flow.
const { confirmActionShow } = vi.hoisted(() => ({
  confirmActionShow: vi.fn(async (options?: { action?: () => unknown }) => {
    await options?.action?.()
    return true
  })
}))
vi.mock('@renderer/components/popups/ConfirmActionPopup', () => ({ default: { show: confirmActionShow } }))

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest }, useIpcOn: vi.fn() }))

describe('ProviderList', () => {
  const providers = [
    {
      id: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
      },
      isEnabled: true
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
      },
      // The sidebar now defaults to the `all` filter.
      isEnabled: true
    }
  ] as any

  beforeEach(() => {
    vi.clearAllMocks()
    reorderSpy.mockClear()
    useProvidersMock.mockReturnValue({
      providers,
      createProvider: vi.fn()
    })
    useProviderActionsMock.mockReturnValue({
      updateProviderById: vi.fn(),
      deleteProviderById: vi.fn()
    })
    useReorderMock.mockReturnValue({
      applyReorderedList: reorderSpy
    })
    useOvmsSupportMock.mockReturnValue({ isSupported: true })
    useModelsMock.mockReturnValue({ models: [] })
    deleteProviderMock.mockResolvedValue(undefined)
    providerItemRects = {}
    scrollerRect = { bottom: 100, top: 0 }
    providerListScrollerClientHeight = 100
    providerListMainContentScrollHeight = 120
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === 'provider-list-scrollbar' ? providerListScrollerClientHeight : 0
      }
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute('data-provider-list-main-content')
          ? providerListMainContentScrollHeight
          : 0
      }
    })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }
    })
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn()
    })
    ipcRequest.mockImplementation((route: string) =>
      route === 'app.get_info' ? Promise.resolve({ appDataPath: '' }) : Promise.resolve(undefined)
    )
  })

  it('filters providers by search text and forwards selection', () => {
    const onSelectProvider = vi.fn()

    render(<ProviderList selectedProviderId="openai" onSelectProvider={onSelectProvider} />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByTestId('provider-list-item-openai')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('provider-list-item-anthropic')).toHaveAttribute('data-selected', 'false')

    fireEvent.change(screen.getByPlaceholderText('搜索模型平台...'), {
      target: { value: 'anth' }
    })

    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Anthropic'))
    expect(onSelectProvider).toHaveBeenCalledWith('anthropic')
  })

  it('hides CherryAI from the provider list', () => {
    useProvidersMock.mockReturnValue({
      providers: [
        ...providers,
        {
          id: 'cherryai',
          name: 'CherryAI',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          isEnabled: true
        }
      ],
      createProvider: vi.fn()
    })

    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.queryByText('CherryAI')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provider-list-item-cherryai')).not.toBeInTheDocument()
  })

  it('triggers add and reorder actions', () => {
    const reorderableProviders = [
      { ...providers[0], isEnabled: true },
      { ...providers[1], isEnabled: true }
    ]

    useProvidersMock.mockReturnValue({
      providers: reorderableProviders,
      createProvider: vi.fn()
    })

    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(useReorderMock).toHaveBeenCalledWith('/providers', { revalidateOnSuccess: false })
    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/i })[0])
    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'trigger-reorder' }))
    expect(reorderSpy).toHaveBeenCalledWith([reorderableProviders[1], reorderableProviders[0]])
  })

  it('does not scroll back to the selected provider after drag reorder changes provider order', () => {
    const reorderableProviders = [
      { ...providers[0], isEnabled: true },
      { ...providers[1], isEnabled: true }
    ]
    let currentProviders = reorderableProviders

    providerItemRects.openai = { bottom: 40, top: 20 }
    useProvidersMock.mockImplementation(() => ({
      providers: currentProviders,
      createProvider: vi.fn()
    }))

    const { rerender } = render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(scrollIntoViewMock).not.toHaveBeenCalled()

    providerItemRects.openai = { bottom: -60, top: -80 }
    fireEvent.click(screen.getByRole('button', { name: 'trigger-reorder' }))
    currentProviders = [reorderableProviders[1], reorderableProviders[0]]

    rerender(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(reorderSpy).toHaveBeenCalledWith([reorderableProviders[1], reorderableProviders[0]])
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })

  it('scrolls the selected provider into view when selection changes outside reorder', () => {
    providerItemRects.openai = { bottom: 40, top: 20 }
    providerItemRects.anthropic = { bottom: 160, top: 120 }

    const { rerender } = render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(scrollIntoViewMock).not.toHaveBeenCalled()

    rerender(<ProviderList selectedProviderId="anthropic" onSelectProvider={vi.fn()} />)

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1)
  })

  it('labels the provider filter icon button for assistive technology', () => {
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(screen.getByRole('button', { name: '筛选服务商' })).toBeInTheDocument()
  })

  it('keeps add buttons inside the provider list scroller', () => {
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    const addButtons = screen.getAllByRole('button', { name: '添加服务商' })
    const [topAddButton, bottomAddButton] = addButtons
    const filterButton = screen.getByRole('button', { name: '筛选服务商' })
    const searchWrap = screen.getByPlaceholderText('搜索模型平台...').closest('div')
    const firstProvider = screen.getByTestId('provider-list-item-openai')
    const lastProvider = screen.getByTestId('provider-list-item-anthropic')

    expect(addButtons).toHaveLength(2)
    expect(topAddButton.compareDocumentPosition(firstProvider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lastProvider.compareDocumentPosition(bottomAddButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(topAddButton).toHaveClass('h-8', 'w-full', 'border-dashed')
    expect(bottomAddButton).toHaveClass('h-8', 'w-full', 'border-dashed')
    expect(searchWrap).toHaveClass('h-9')
    expect(searchWrap).toContainElement(filterButton)
    expect(filterButton).toHaveClass('size-[22px]')
    expect(filterButton).not.toHaveClass('bg-primary/10')
    expect(filterButton.querySelector('svg')).toHaveClass('text-muted-foreground/60')
  })

  it('hides the bottom add button when provider list content does not overflow', () => {
    providerListMainContentScrollHeight = 80

    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(screen.getAllByRole('button', { name: '添加服务商' })).toHaveLength(1)
  })

  it('surfaces reorder persistence errors', async () => {
    reorderSpy.mockRejectedValueOnce(new Error('persist failed'))

    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'trigger-reorder' })[0])

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
  })

  it('applies the agent filter hint without hiding gateway-routable providers', () => {
    const onSelectProvider = vi.fn()
    useProvidersMock.mockReturnValue({
      providers: [
        ...providers,
        {
          id: 'gemini',
          name: 'Gemini',
          presetProviderId: 'gemini',
          defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
          authType: 'api-key',
          isEnabled: true
        }
      ],
      createProvider: vi.fn()
    })
    const { rerender } = render(<ProviderList selectedProviderId="openai" onSelectProvider={onSelectProvider} />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()

    rerender(<ProviderList selectedProviderId="openai" filterModeHint="agent" onSelectProvider={onSelectProvider} />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()
    const filterButton = screen.getByRole('button', { name: '筛选服务商' })
    expect(filterButton).not.toHaveClass('bg-primary/10')
    expect(filterButton.querySelector('svg')).toHaveClass('text-primary!')
  })

  it('shows management actions for preset-derived and custom providers but not canonical presets', () => {
    useProvidersMock.mockReturnValue({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          presetProviderId: 'openai',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          isEnabled: true
        },
        {
          id: 'openai-work',
          name: 'OpenAI Work',
          presetProviderId: 'openai',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          isEnabled: true
        },
        {
          id: 'my-local-llm',
          name: 'My Local LLM',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          isEnabled: true
        }
      ],
      createProvider: vi.fn()
    })

    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(screen.getByTestId('provider-list-manage-openai')).toHaveTextContent('false')
    expect(screen.getByTestId('provider-list-manage-openai-work')).toHaveTextContent('true')
    expect(screen.getByTestId('provider-list-manage-my-local-llm')).toHaveTextContent('true')
  })

  it('opens a confirmation modal before deleting a provider', () => {
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    fireEvent.click(screen.getByTestId('provider-list-delete-openai'))

    expect(confirmActionShow).toHaveBeenCalledTimes(1)
  })

  it('delegates provider deletion from the confirmation callback', async () => {
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    fireEvent.click(screen.getByTestId('provider-list-delete-openai'))

    await vi.waitFor(() => expect(deleteProviderMock).toHaveBeenCalledWith('openai'))
  })
})
