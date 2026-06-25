import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MODEL_LIST_CAPABILITY_FILTERS } from '../modelListDerivedState'
import ProviderModelList from '../ProviderModelList'

const onToggleVisibleModelsMock = vi.fn()
const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

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
    Button: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    MenuItem: ({ icon, label, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {icon}
        {label}
      </button>
    ),
    MenuList: ({ children }: any) => <div>{children}</div>,
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <>{children}</>,
    Tooltip: ({ children }: any) => <>{children}</>
  }
})

vi.mock('../ModelDrawer', () => ({
  EditModelDrawer: () => null
}))

vi.mock('../ModelListGroup', () => ({
  default: ({
    expansionCommand,
    groupName
  }: {
    expansionCommand?: { expanded: boolean; version: number }
    groupName: string
  }) => (
    <div>
      {groupName}
      {expansionCommand ? `:${String(expansionCommand.expanded)}:${expansionCommand.version}` : null}
    </div>
  )
}))

vi.mock('../useProviderModelList', () => ({
  useProviderModelList: () => ({
    header: {
      enabledModelCount: 1,
      modelCount: 1,
      hasVisibleModels: true,
      allEnabled: false,
      hasNoModels: false,
      searchText: '',
      setSearchText: vi.fn(),
      selectedCapabilityFilter: 'all',
      setSelectedCapabilityFilter: vi.fn(),
      capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
      capabilityModelCounts: MODEL_LIST_CAPABILITY_FILTERS.reduce<Record<string, number>>((counts, filter) => {
        counts[filter] = filter === 'all' ? 1 : 0
        return counts
      }, {}),
      onToggleVisibleModels: onToggleVisibleModelsMock
    },
    sections: {
      isLoading: false,
      hasNoModels: false,
      hasVisibleModels: true,
      displayEnabledModelCount: 1,
      enabledSections: [{ groupName: 'OpenAI', items: [] }],
      disabledSections: [{ groupName: 'OpenAI', items: [] }],
      displayDisabledModelCount: 1,
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
    ;(window as any).toast = {
      error: vi.fn()
    }
    onToggleVisibleModelsMock.mockResolvedValue(undefined)
  })

  it('renders enabled-section actions and closes visible models from the action menu', () => {
    render(
      <ProviderModelList
        providerId="openai"
        disabled={false}
        enabledSectionActions={() => <button type="button">health-action</button>}
      />
    )

    expect(screen.getByText('health-action')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'settings.models.more_actions' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_disable' }))

    expect(onToggleVisibleModelsMock).toHaveBeenCalledWith(false)
  })

  it('shows an error toast when section bulk close fails', async () => {
    onToggleVisibleModelsMock.mockRejectedValue(new Error('bulk close failed'))

    render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_disable' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('settings.models.manage.operation_failed')
    })
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to disable visible provider models',
      expect.objectContaining({
        providerId: 'openai',
        error: expect.any(Error)
      })
    )
  })

  it('enables visible disabled models from the action menu', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.bulk_enable' }))

    expect(onToggleVisibleModelsMock).toHaveBeenCalledWith(true)
  })

  it('collapses and expands all groups from the action menu', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.expand_all' })[0])
    expect(screen.getAllByText(/:true:1/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.models.collapse_all' })[0])
    expect(screen.getAllByText(/:false:2/).length).toBeGreaterThan(0)
  })
})
