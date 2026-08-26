import '@testing-library/jest-dom/vitest'

import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderLoginSetupDialog from '../ProviderLoginSetupDialog'

const mocks = vi.hoisted(() => ({
  addApiKey: vi.fn(),
  checkApi: vi.fn(),
  createModels: vi.fn(),
  enableProvider: vi.fn(),
  fetchModels: vi.fn(),
  ipcRequest: vi.fn(),
  localModels: [] as Model[],
  oauthWithCherryIn: vi.fn(),
  updateModels: vi.fn(),
  updateProvider: vi.fn()
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mocks.localModels }),
  useModelMutations: () => ({ createModels: mocks.createModels, updateModels: mocks.updateModels })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderMutations: () => ({
    addApiKey: mocks.addApiKey,
    enableProvider: mocks.enableProvider,
    updateProvider: mocks.updateProvider
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@renderer/services/oauth', () => ({
  oauthWithCherryIn: (...args: unknown[]) => mocks.oauthWithCherryIn(...args)
}))

vi.mock('@renderer/utils/error', () => ({
  serializeHealthCheckError: (cause: unknown) => ({ message: cause instanceof Error ? cause.message : String(cause) })
}))

vi.mock('../utils/healthCheck', () => ({
  checkApi: (...args: unknown[]) => mocks.checkApi(...args),
  getModelHealthCheckSkipReason: () => null,
  healthCheckErrorToDisplayString: (error: { message?: string }) => error.message ?? ''
}))

vi.mock('../utils/modelSync', () => ({
  fetchResolvedProviderModels: (...args: unknown[]) => mocks.fetchModels(...args),
  resolveCreateModelEndpointTypes: () => undefined,
  toCreateModelDto: (providerId: string, model: Model) => ({
    providerId,
    modelId: model.apiModelId,
    name: model.name
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    apiKeys: [],
    authType: 'oauth',
    isEnabled: false,
    reportsActualCost: false,
    settings: {},
    ...overrides
  } as Provider
}

function makeModel(providerId: string, apiModelId: string): Model {
  return {
    id: `${providerId}::${apiModelId}`,
    providerId,
    apiModelId,
    name: apiModelId,
    capabilities: [],
    isEnabled: true,
    isHidden: false,
    supportsStreaming: true
  }
}

function renderDialog(
  provider: Provider,
  kind: 'managed-oauth' | 'external-cli' | 'cherryin',
  overrides: Partial<React.ComponentProps<typeof ProviderLoginSetupDialog>> = {}
) {
  const props = {
    provider,
    kind,
    onBack: vi.fn(),
    onClose: vi.fn(),
    onContinueToApiSetup: vi.fn(),
    onSetupSuccess: vi.fn(),
    ...overrides
  }
  return { props, ...render(<ProviderLoginSetupDialog {...props} />) }
}

describe('ProviderLoginSetupDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.localModels = []
    mocks.addApiKey.mockResolvedValue(undefined)
    mocks.createModels.mockImplementation(async (dtos: Array<{ providerId: string; modelId: string }>) =>
      dtos.map((dto) => makeModel(dto.providerId, dto.modelId))
    )
    mocks.updateModels.mockResolvedValue([])
    mocks.updateProvider.mockResolvedValue(undefined)
    mocks.enableProvider.mockResolvedValue(undefined)
    mocks.checkApi.mockResolvedValue({ latency: 10 })
  })

  it('returns to the provider list without an intermediate animation in the guided flow', () => {
    const provider = makeProvider('openai-codex')
    const { props } = renderDialog(provider, 'managed-oauth', { seamlessTransitions: true })

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.back_to_providers' }))

    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  it('signs in, adds only compatible models, verifies one model, then enables the provider', async () => {
    const provider = makeProvider('openai-codex')
    const alpha = makeModel(provider.id, 'alpha')
    const beta = makeModel(provider.id, 'beta')
    const operations: string[] = []
    let finishCheck: () => void = () => {}

    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'oauth.has_token') return false
      if (route === 'oauth.sign_in') {
        operations.push('sign-in')
        return { accountId: null }
      }
      throw new Error(`Unexpected route: ${route}`)
    })
    mocks.fetchModels.mockResolvedValue([alpha, beta])
    mocks.createModels.mockImplementation(async (dtos: Array<{ providerId: string; modelId: string }>) => {
      operations.push('models')
      return dtos.map((dto) => makeModel(dto.providerId, dto.modelId))
    })
    mocks.checkApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = () => {
            operations.push('check')
            resolve({ latency: 10 })
          }
        })
    )
    mocks.enableProvider.mockImplementation(async () => {
      operations.push('enable')
    })
    const { props } = renderDialog(provider, 'managed-oauth', {
      modelFilter: (model) => model.apiModelId === 'alpha'
    })

    await waitFor(() =>
      expect(mocks.checkApi).toHaveBeenCalledWith(alpha.id, expect.objectContaining({ timeout: 15000 }))
    )
    expect(mocks.enableProvider).not.toHaveBeenCalled()
    expect(mocks.createModels).toHaveBeenCalledWith([
      expect.objectContaining({ providerId: provider.id, modelId: 'alpha' })
    ])

    finishCheck()

    await waitFor(() => expect(props.onSetupSuccess).toHaveBeenCalledWith([alpha]))
    expect(operations).toEqual(['sign-in', 'models', 'check', 'enable'])
  })

  it('skips browser sign-in when already authenticated', async () => {
    const provider = makeProvider('grok-cli')
    const model = makeModel(provider.id, 'grok-build')
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'oauth.has_token') return true
      throw new Error(`Unexpected route: ${route}`)
    })
    mocks.fetchModels.mockResolvedValue([model])
    const { props } = renderDialog(provider, 'managed-oauth')

    await waitFor(() => expect(props.onSetupSuccess).toHaveBeenCalledWith([model]))
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
  })

  it('keeps the provider disabled after a failed check and retries without duplicating models', async () => {
    const provider = makeProvider('openai-codex')
    const model = makeModel(provider.id, 'alpha')
    mocks.ipcRequest.mockResolvedValue(true)
    mocks.fetchModels.mockResolvedValue([model])
    mocks.checkApi.mockRejectedValueOnce(new Error('subscription unavailable')).mockResolvedValueOnce({ latency: 10 })
    const { props } = renderDialog(provider, 'managed-oauth')

    expect(await screen.findByRole('alert')).toHaveTextContent('subscription unavailable')
    expect(mocks.enableProvider).not.toHaveBeenCalled()
    expect(mocks.createModels).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    await waitFor(() => expect(props.onSetupSuccess).toHaveBeenCalledWith([model]))
    expect(mocks.createModels).toHaveBeenCalledTimes(1)
    expect(mocks.enableProvider).toHaveBeenCalledTimes(1)
  })

  it('launches Claude Code login, waits for completion, then enables without an API probe', async () => {
    vi.useFakeTimers()
    const provider = makeProvider('claude-code', { authMethods: ['external-cli'] })
    const model = makeModel(provider.id, 'claude-sonnet')
    let loginChecks = 0
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'oauth.check_external_login') {
        loginChecks += 1
        return loginChecks > 1
      }
      if (route === 'app.get_info') return { homePath: '/tmp/test-home' }
      if (route === 'code_cli.run') return { success: true }
      throw new Error(`Unexpected route: ${route}`)
    })
    mocks.fetchModels.mockResolvedValue([model])
    const { props } = renderDialog(provider, 'external-cli')

    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(mocks.ipcRequest).toHaveBeenCalledWith('code_cli.run', {
      mode: 'login-flow',
      cliTool: 'claude-code',
      directory: '/tmp/test-home'
    })

    await act(async () => vi.advanceTimersByTimeAsync(1000))

    expect(props.onSetupSuccess).toHaveBeenCalledWith([model])
    expect(mocks.checkApi).not.toHaveBeenCalled()
    expect(mocks.enableProvider).toHaveBeenCalledTimes(1)
  })

  it('saves CherryIN OAuth keys and continues to model selection without enabling', async () => {
    vi.useFakeTimers()
    const provider = makeProvider('cherryin', { authType: 'api-key' })
    mocks.oauthWithCherryIn.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('oauth-key-a, oauth-key-b, oauth-key-a')
      return 'oauth-key-a, oauth-key-b, oauth-key-a'
    })
    const { props } = renderDialog(provider, 'cherryin')

    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_UNMOUNT_DELAY_MS))

    expect(mocks.addApiKey).toHaveBeenCalledTimes(2)
    expect(mocks.addApiKey).toHaveBeenNthCalledWith(1, 'oauth-key-a', 'OAuth')
    expect(mocks.addApiKey).toHaveBeenNthCalledWith(2, 'oauth-key-b', 'OAuth')
    expect(props.onContinueToApiSetup).toHaveBeenCalledWith('models')
    expect(mocks.enableProvider).not.toHaveBeenCalled()
  })

  it('redacts a CherryIN key when saving it fails', async () => {
    const provider = makeProvider('cherryin', { authType: 'api-key' })
    mocks.addApiKey.mockRejectedValueOnce(new Error('Could not save oauth-secret-key'))
    mocks.oauthWithCherryIn.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('oauth-secret-key')
      return 'oauth-secret-key'
    })

    renderDialog(provider, 'cherryin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('••••')
    expect(alert).not.toHaveTextContent('oauth-secret-key')
    expect(mocks.enableProvider).not.toHaveBeenCalled()
  })

  it('lets CherryIN users switch to API-key setup and cancels the OAuth wait', async () => {
    vi.useFakeTimers()
    const provider = makeProvider('cherryin', { authType: 'api-key' })
    let flowSignal: AbortSignal | undefined
    mocks.oauthWithCherryIn.mockImplementation(
      (_setKey: (keys: string) => Promise<void>, config: { signal?: AbortSignal }) => {
        flowSignal = config.signal
        return new Promise(() => {})
      }
    )
    const { props } = renderDialog(provider, 'cherryin')
    await act(async () => vi.advanceTimersByTimeAsync(0))

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.oauth.cherryIn.use_api_key' }))
    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_UNMOUNT_DELAY_MS))

    expect(flowSignal?.aborted).toBe(true)
    expect(props.onContinueToApiSetup).toHaveBeenCalledWith('api-key')
    expect(mocks.enableProvider).not.toHaveBeenCalled()
  })

  it('shows an inline error and stays disabled when no compatible models are available', async () => {
    const provider = makeProvider('grok-cli')
    mocks.ipcRequest.mockResolvedValue(true)
    mocks.fetchModels.mockResolvedValue([makeModel(provider.id, 'image-only')])
    renderDialog(provider, 'managed-oauth', { modelFilter: () => false })

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.provider.api_setup.no_compatible_models')
    expect(mocks.createModels).not.toHaveBeenCalled()
    expect(mocks.enableProvider).not.toHaveBeenCalled()
  })
})
