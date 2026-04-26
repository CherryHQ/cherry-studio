import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderList from '../ProviderList'

const reorderSpy = vi.fn()
const useProvidersMock = vi.fn()
const useProviderActionsMock = vi.fn()
const useProviderLogosMock = vi.fn()
const useReorderMock = vi.fn()

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

vi.mock('../ProviderList/useProviderLogos', () => ({
  useProviderLogos: (...args: any[]) => useProviderLogosMock(...args)
}))

vi.mock('../ProviderList/ProviderListItemWithContextMenu', () => ({
  default: ({ provider, selectedProviderId, onSelect }: any) => (
    <button
      type="button"
      data-testid={`provider-list-item-${provider.id}`}
      data-selected={selectedProviderId === provider.id ? 'true' : 'false'}
      onClick={onSelect}>
      {provider.name}
    </button>
  )
}))

vi.mock('../ProviderList/ProviderEditorDrawer', () => ({
  default: ({ open }: any) => <div data-testid="provider-editor-drawer" data-open={open ? 'true' : 'false'} />
}))

describe('ProviderList', () => {
  const providers = [
    { id: 'openai', name: 'OpenAI', isEnabled: true },
    { id: 'anthropic', name: 'Anthropic', isEnabled: false }
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
    useProviderLogosMock.mockReturnValue({
      logos: {},
      saveLogo: vi.fn(),
      clearLogo: vi.fn()
    })
    useReorderMock.mockReturnValue({
      applyReorderedList: reorderSpy
    })
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
    render(<ProviderList selectedProviderId="openai" onSelectProvider={vi.fn()} />)

    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'false')
    fireEvent.click(screen.getByRole('button', { name: /添加/i }))
    expect(screen.getByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'trigger-reorder' }))
    expect(reorderSpy).toHaveBeenCalledWith([providers[1], providers[0]])
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
})
