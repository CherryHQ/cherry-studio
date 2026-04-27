import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderList from '../ProviderList'

const reorderSpy = vi.fn()
const useProvidersMock = vi.fn()
const useProviderActionsMock = vi.fn()
const useReorderMock = vi.fn()
const useOvmsSupportMock = vi.fn()
const deleteProviderMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    ReorderableList: ({ visibleItems, renderItem, onReorder }: any) => (
      <div>
        {visibleItems.map((item: any, index: number) => (
          <div key={item.id}>{renderItem(item, index, { dragging: false })}</div>
        ))}
        <button type="button" onClick={() => onReorder([...visibleItems].reverse())}>
          trigger-reorder
        </button>
      </div>
    )
  }
})

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: (...args: any[]) => useProvidersMock(...args),
  useProviderActions: (...args: any[]) => useProviderActionsMock(...args)
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
  default: ({ provider, selected, onSelect, onDelete, showManagementActions }: any) => (
    <div data-testid={`provider-list-item-${provider.id}`} data-selected={selected ? 'true' : 'false'}>
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
      isEnabled: false
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
    deleteProviderMock.mockResolvedValue(undefined)
    ;(window as any).modal = { confirm: vi.fn() }
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

    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: /添加/i }))
    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'trigger-reorder' }))
    expect(reorderSpy).toHaveBeenCalledWith([reorderableProviders[1], reorderableProviders[0]])
  })

  it('applies an external filter hint without making the page own list filter state', () => {
    const onSelectProvider = vi.fn()
    const { rerender } = render(<ProviderList selectedProviderId="openai" onSelectProvider={onSelectProvider} />)

    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()

    rerender(<ProviderList selectedProviderId="openai" filterModeHint="agent" onSelectProvider={onSelectProvider} />)

    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
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

    expect(window.modal.confirm).toHaveBeenCalledTimes(1)
    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(options.title).toBeTruthy()
    expect(options.okText).toBeTruthy()
    expect(options.okButtonProps).toEqual({ danger: true })
    expect(options.centered).toBe(true)
  })

  it('delegates provider deletion from the confirmation callback', async () => {
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    fireEvent.click(screen.getByTestId('provider-list-delete-openai'))
    const options = (window.modal.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]

    await options.onOk()

    expect(deleteProviderMock).toHaveBeenCalledWith('openai')
  })
})
