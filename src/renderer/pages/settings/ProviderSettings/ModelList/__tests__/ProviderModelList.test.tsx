import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderModelList from '../ProviderModelList'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      i18n: { language: 'en-US' },
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({ list, children, className, getItemKey }: any) => (
    <div className={className}>
      {list.map((item: unknown, index: number) => (
        <div key={getItemKey?.(index) ?? index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

vi.mock('../ModelDrawer', () => ({
  EditModelDrawer: () => null
}))

const { modelListGroupMock, modelListStateMock, searchTextMock } = vi.hoisted(() => ({
  modelListGroupMock: vi.fn(({ groupName }: { groupName: string }) => <div>{groupName}</div>),
  modelListStateMock: { hasNoModels: false, hasVisibleModels: true },
  searchTextMock: { value: '' }
}))

vi.mock('../ModelListGroup', () => ({
  default: modelListGroupMock
}))

vi.mock('../useProviderModelList', () => ({
  useProviderModelList: () => ({
    header: {
      modelCount: 1,
      hasVisibleModels: modelListStateMock.hasVisibleModels,
      hasNoModels: modelListStateMock.hasNoModels,
      searchText: searchTextMock.value,
      setSearchText: vi.fn()
    },
    sections: {
      isLoading: false,
      hasNoModels: modelListStateMock.hasNoModels,
      hasVisibleModels: modelListStateMock.hasVisibleModels,
      displayEnabledModelCount: 1,
      enabledSections: [{ groupName: 'OpenAI', items: [] }],
      disabled: false,
      pendingModelIds: new Set<string>(),
      defaultModelIds: new Set<string>(),
      onEditModel: vi.fn(),
      onDeleteModel: vi.fn(),
      onDeleteModels: vi.fn()
    },
    editDrawer: {
      open: false,
      model: null,
      onClose: vi.fn()
    }
  })
}))

describe('ProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    modelListStateMock.hasNoModels = false
    modelListStateMock.hasVisibleModels = true
    searchTextMock.value = ''
  })

  it('shows guidance to get models when the provider has no models', () => {
    modelListStateMock.hasNoModels = true
    modelListStateMock.hasVisibleModels = false

    const { container } = render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(screen.getByText('settings.models.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.models.empty_hint')).toBeInTheDocument()
    expect(container.querySelector('.lucide-box')).toBeInTheDocument()
  })

  it('renders model groups without section action rows', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(screen.getAllByText('OpenAI')).toHaveLength(1)
    expect(screen.queryByText('settings.models.enabled_models')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.more_actions' })).not.toBeInTheDocument()
  })

  it('passes collapsed state to model groups from the header toggle', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.collapse_all' }))

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false
      }),
      undefined
    )
  })

  it('expands model groups when search text is active', () => {
    const { rerender } = render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.collapse_all' }))

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false
      }),
      undefined
    )

    searchTextMock.value = 'gpt'
    rerender(<ProviderModelList providerId="openai" disabled={false} />)

    expect(modelListGroupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true
      }),
      undefined
    )
  })
})
