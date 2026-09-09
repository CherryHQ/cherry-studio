import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))

const { resolveLaunchModelId } = await import('../launchModelId')

type ResolveLaunchModelIdArgs = Parameters<typeof resolveLaunchModelId>[0]

const provider = { id: 'anthropic', name: 'Anthropic' } as Provider

function makeArgs(overrides: Partial<ResolveLaunchModelIdArgs> = {}): ResolveLaunchModelIdArgs {
  return {
    enabledProvider: provider,
    currentProviderConfig: { modelId: 'anthropic::claude-sonnet-4-5' },
    upsertProviderConfig: vi.fn(),
    setCurrentProvider: vi.fn(),
    errorToastKey: 'code.select_provider_model',
    logLabel: 'Invalid test model id configured',
    ...overrides
  }
}

describe('resolveLaunchModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the parsed model id for a valid selection, with no side effects', async () => {
    const args = makeArgs()

    await expect(resolveLaunchModelId(args)).resolves.toEqual({
      uniqueModelId: 'anthropic::claude-sonnet-4-5',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5'
    })
    expect(args.upsertProviderConfig).not.toHaveBeenCalled()
    expect(args.setCurrentProvider).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('toasts and returns null for a missing provider, without touching the config', async () => {
    const args = makeArgs({ enabledProvider: undefined })

    await expect(resolveLaunchModelId(args)).resolves.toBeNull()

    expect(mocks.toastError).toHaveBeenCalledWith('code.select_provider_model')
    expect(args.upsertProviderConfig).not.toHaveBeenCalled()
    expect(args.setCurrentProvider).not.toHaveBeenCalled()
  })

  it('toasts and returns null for a missing modelId, without touching the config', async () => {
    const args = makeArgs({ currentProviderConfig: { modelId: null } })

    await expect(resolveLaunchModelId(args)).resolves.toBeNull()

    expect(mocks.toastError).toHaveBeenCalledWith('code.select_provider_model')
    expect(args.upsertProviderConfig).not.toHaveBeenCalled()
    expect(args.setCurrentProvider).not.toHaveBeenCalled()
  })

  it('treats an unparseable modelId as corrupt state: clears the selection, toasts, returns null', async () => {
    // The preference type only admits well-formed ids; corrupt values exist in
    // legacy profiles at runtime, which is exactly what this branch recovers from.
    const corruptModelId = 'corrupt-value' as NonNullable<ResolveLaunchModelIdArgs['currentProviderConfig']>['modelId']
    const args = makeArgs({ currentProviderConfig: { modelId: corruptModelId } })

    await expect(resolveLaunchModelId(args)).resolves.toBeNull()

    expect(args.upsertProviderConfig).toHaveBeenCalledWith('anthropic', { modelId: null })
    expect(args.setCurrentProvider).toHaveBeenCalledWith(null)
    expect(mocks.toastError).toHaveBeenCalledWith('code.select_provider_model')
  })
})
