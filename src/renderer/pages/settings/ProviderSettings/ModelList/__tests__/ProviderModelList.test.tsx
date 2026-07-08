import { render, screen } from '@testing-library/react'
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

vi.mock('../ModelDrawer', () => ({
  EditModelDrawer: () => null
}))

vi.mock('../ModelListGroup', () => ({
  default: ({ groupName }: { groupName: string }) => <div>{groupName}</div>
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
      setSearchText: vi.fn()
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
  })

  it('renders model groups without section action rows', () => {
    render(<ProviderModelList providerId="openai" disabled={false} />)

    expect(screen.getAllByText('OpenAI')).toHaveLength(2)
    expect(screen.queryByText('settings.models.enabled_models')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'settings.models.more_actions' })).not.toBeInTheDocument()
  })
})
