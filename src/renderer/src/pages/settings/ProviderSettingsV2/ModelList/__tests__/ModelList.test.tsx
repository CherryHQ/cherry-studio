import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelList from '../ModelList'

const addModelShowMock = vi.fn()
const newApiAddModelShowMock = vi.fn()
const downloadModelShowMock = vi.fn()
const updateModelMock = vi.fn()
const syncProviderModelsMock = vi.fn()

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderPresetMetadataMock = vi.fn()
const useModelMutationsMock = vi.fn()
const useHealthCheckMock = vi.fn()
const openHealthCheckMock = vi.fn()

const createModel = (overrides: Record<string, unknown>) =>
  ({
    capabilities: [],
    endpointTypes: [],
    group: 'chat',
    isEnabled: true,
    providerId: 'openai',
    ...overrides
  }) as any

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cherrystudio/ui')>()

  return {
    ...actual,
    Badge: ({ children }: any) => <span>{children}</span>,
    Button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: any) => <div>{children}</div>
  }
})

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: ({ onSearch, placeholder }: any) => (
    <input placeholder={placeholder} onChange={(event) => onSearch(event.target.value)} />
  )
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div>loading</div>,
  StreamlineGoodHealthAndWellBeing: () => <span>health-icon</span>
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args),
  useProviderPresetMetadata: (...args: any[]) => useProviderPresetMetadataMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: (...args: any[]) => useModelMutationsMock(...args)
}))

vi.mock('../useHealthCheck', () => ({
  useHealthCheck: (...args: any[]) => useHealthCheckMock(...args)
}))

vi.mock('../ManageModelsDrawer', () => ({
  default: ({ open }: any) => (open ? <div>manage-models-drawer</div> : null)
}))

vi.mock('../HealthCheckDrawer', () => ({
  default: () => null
}))

vi.mock('../AddModelPopup', () => ({
  default: { show: (...args: any[]) => addModelShowMock(...args) }
}))

vi.mock('../NewApiAddModelPopup', () => ({
  default: { show: (...args: any[]) => newApiAddModelShowMock(...args) }
}))

vi.mock('../DownloadOVMSModelPopup', () => ({
  default: { show: (...args: any[]) => downloadModelShowMock(...args) }
}))

vi.mock('../../hooks/useProviderModelSync', () => ({
  useProviderModelSync: () => ({
    syncProviderModels: (...args: any[]) => syncProviderModelsMock(...args),
    isSyncingModels: false
  })
}))

vi.mock('../ModelListGroup', () => ({
  default: ({ groupName, items }: any) => (
    <div data-testid="model-group">
      <span>{groupName}</span>
      {items.map((item: any) => (
        <span key={item.model.id}>
          {item.model.name}
          {item.showIdentifier ? `:${item.model.id}` : ''}
          {item.modelStatus ? `:${item.modelStatus.status}` : ''}
        </span>
      ))}
    </div>
  )
}))

describe('ModelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api.getAppInfo = vi.fn().mockResolvedValue({})
    updateModelMock.mockReset()
    syncProviderModelsMock.mockReset()
    syncProviderModelsMock.mockResolvedValue([])
    useProviderMock.mockImplementation((providerId: string) => ({
      provider: { id: providerId, name: providerId }
    }))
    useModelsMock.mockImplementation(({ providerId }: { providerId: string }) => ({
      models:
        providerId === 'new-api'
          ? [
              createModel({
                id: 'new-api::model-alpha',
                name: 'Alpha',
                providerId: 'new-api'
              })
            ]
          : providerId === 'ovms'
            ? [
                createModel({
                  id: 'ovms::model-alpha',
                  name: 'Alpha',
                  providerId: 'ovms'
                })
              ]
            : [
                createModel({
                  id: 'openai::reasoning-alpha',
                  name: 'Alpha',
                  capabilities: [MODEL_CAPABILITY.REASONING]
                }),
                createModel({
                  id: 'openai::vision-alpha',
                  name: 'Alpha',
                  capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION],
                  group: undefined
                }),
                createModel({
                  id: 'openai::model-beta',
                  name: 'Beta',
                  capabilities: [MODEL_CAPABILITY.EMBEDDING],
                  group: 'embedding',
                  isEnabled: false
                }),
                createModel({
                  id: 'openai::tooling',
                  name: 'Gamma',
                  capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.WEB_SEARCH],
                  group: 'tools'
                })
              ]
    }))
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ key: 'sk-test' }] }
    })
    useProviderPresetMetadataMock.mockReturnValue({
      data: {}
    })
    useModelMutationsMock.mockReturnValue({
      deleteModel: vi.fn(),
      updateModel: updateModelMock
    })
    useHealthCheckMock.mockReturnValue({
      isChecking: false,
      modelStatuses: [
        {
          model: createModel({
            id: 'openai::reasoning-alpha',
            name: 'Alpha',
            capabilities: [MODEL_CAPABILITY.REASONING]
          }),
          status: HealthStatus.SUCCESS,
          keyResults: [],
          latency: 120
        }
      ],
      availableApiKeys: ['sk-test'],
      healthCheckOpen: false,
      openHealthCheck: openHealthCheckMock,
      closeHealthCheck: vi.fn(),
      startHealthCheck: vi.fn()
    })
  })

  it('filters rendered model groups by search text', () => {
    render(<ModelList providerId="openai" />)

    expect(screen.getByTestId('provider-model-list')).toBeInTheDocument()
    expect(screen.getByText('Alpha:openai::reasoning-alpha:success')).toBeInTheDocument()
    expect(screen.getByText('Alpha:openai::vision-alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getAllByText('settings.models.check.enabled')).not.toHaveLength(0)
    expect(screen.getAllByText('settings.models.check.disabled')).not.toHaveLength(0)

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), {
      target: { value: 'beta' }
    })

    expect(screen.queryByText('Alpha:openai::reasoning-alpha:success')).not.toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('stacks capability chips with search filtering', async () => {
    render(<ModelList providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /models\.type\.reasoning/i }))

    await waitFor(() => {
      expect(screen.getByText('Alpha:openai::reasoning-alpha:success')).toBeInTheDocument()
    })
    expect(screen.queryByText('Alpha:openai::vision-alpha')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), {
      target: { value: 'vision' }
    })

    await waitFor(() => {
      expect(screen.getByText('common.no_results')).toBeInTheDocument()
    })
  })

  it('opens manage, refresh and add actions for a regular provider', () => {
    render(<ModelList providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /^manage$/i }))
    expect(screen.getByText('manage-models-drawer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^settings\.models\.manage\.fetch_list$/i }))
    expect(syncProviderModelsMock).toHaveBeenCalledWith({ id: 'openai', name: 'openai' })

    fireEvent.click(screen.getByRole('button', { name: /^settings\.models\.add\.add_model$/i }))
    expect(addModelShowMock).toHaveBeenCalled()
  })

  it('uses the new-api add flow and ovms download flow when applicable', () => {
    const { rerender } = render(<ModelList providerId="new-api" />)
    fireEvent.click(screen.getByRole('button', { name: /^settings\.models\.add\.add_model$/i }))
    expect(newApiAddModelShowMock).toHaveBeenCalled()

    rerender(<ModelList providerId="ovms" />)
    fireEvent.click(screen.getByRole('button', { name: /^button\.download$/i }))
    expect(downloadModelShowMock).toHaveBeenCalled()
  })

  it('updates enabled state for visible models from toolbar actions', async () => {
    render(<ModelList providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /^settings\.models\.check\.enabled$/i }))
    await waitFor(() => {
      expect(updateModelMock).toHaveBeenCalledTimes(1)
    })
    expect(updateModelMock).toHaveBeenCalledWith('openai', 'model-beta', { isEnabled: true })
  })

  it('opens the health check drawer from the toolbar', () => {
    render(<ModelList providerId="openai" />)

    fireEvent.click(screen.getByRole('button', { name: /^settings\.models\.check\.button_caption$/i }))

    expect(openHealthCheckMock).toHaveBeenCalled()
  })
})
