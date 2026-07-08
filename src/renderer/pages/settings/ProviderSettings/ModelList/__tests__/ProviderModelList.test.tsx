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

const { modelListGroupMock, searchTextMock } = vi.hoisted(() => ({
  modelListGroupMock: vi.fn(({ groupName }: { groupName: string }) => <div>{groupName}</div>),
  searchTextMock: { value: '' }
}))

vi.mock('../ModelListGroup', () => ({
  default: modelListGroupMock
}))

vi.mock('../useProviderModelList', () => ({
  useProviderModelList: () => ({
    header: {
      enabledModelCount: 1,
      modelCount: 1,
      hasVisibleModels: true,
      allEnabled: false,
      hasNoModels: false,
      searchText: searchTextMock.value,
      setSearchText: vi.fn()
    },
    sections: {
      isLoading: false,
      hasNoModels: false,
      hasVisibleModels: true,
      displayEnabledModelCount: 1,
      enabledSections: [{ groupName: 'OpenAI', items: [] }],
      disabledSections: [],
      displayDisabledModelCount: 0,
      disabled: false,
      pendingModelIds: new Set<string>(),
      onEditModel: vi.fn(),
      onDeleteModel: vi.fn(),
      onDeleteModels: vi.fn(),
      onToggleModel: vi.fn(),
      onToggleModels: vi.fn()
    },
    editDrawer: {
      open: false,
      model: null,
      onClose: vi.fn()
    },
    isBulkUpdating: false
  })
}))

describe('ProviderModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchTextMock.value = ''
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
