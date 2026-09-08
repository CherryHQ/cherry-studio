import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractConnection: vi.fn(),
  matchesProvider: vi.fn(),
  readFiles: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({ dataApiService: { get: vi.fn() } }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))
vi.mock('../../cliConfig', () => ({
  cliConfigConnectionMatchesProvider: (...args: unknown[]) => mocks.matchesProvider(...args),
  extractConnectionFromCliConfigDraft: (...args: unknown[]) => mocks.extractConnection(...args),
  gatewayExpectedModel: vi.fn(),
  readCliConfigFiles: (...args: unknown[]) => mocks.readFiles(...args),
  resolveCliConfigApplyContext: vi.fn()
}))

const { useCurrentCliConfigConnection } = await import('../useCurrentCliConfigConnection')

const provider = {
  id: 'anthropic',
  name: 'Anthropic',
  isEnabled: true
} as Provider

const connection = { baseUrl: 'https://example.com', apiKey: 'key', model: 'model' }
const oldConnection = { baseUrl: 'https://old.example.com', apiKey: 'old-key', model: 'old-model' }
const newConnection = { baseUrl: 'https://new.example.com', apiKey: 'new-key', model: 'new-model' }
const providerConfig: CliProviderConfig = { modelId: null }

describe('useCurrentCliConfigConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extractConnection.mockImplementation((_tool, files: Array<{ target?: string }>) =>
      files[0]?.target === 'new' ? newConnection : files[0]?.target === 'old' ? oldConnection : connection
    )
    mocks.matchesProvider.mockReturnValue(false)
  })

  it('keeps the newest config read when an older read resolves afterward', async () => {
    const reads: Array<{
      resolve: (files: never[]) => void
      reject: (error: Error) => void
    }> = []
    mocks.readFiles.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          reads.push({ resolve, reject })
        })
    )

    const { result } = renderHook(() =>
      useCurrentCliConfigConnection({
        enabledProvider: provider,
        selectedCliTool: CodeCli.HERMES,
        currentProviderConfig: providerConfig
      })
    )

    await waitFor(() => expect(reads).toHaveLength(1))
    act(() => result.current.reload())
    await waitFor(() => expect(reads).toHaveLength(2))

    await act(async () => {
      reads[1].resolve([{ target: 'new' }] as never[])
      await Promise.resolve()
    })
    expect(result.current.connection).toEqual(newConnection)

    await act(async () => {
      reads[0].resolve([{ target: 'old' }] as never[])
      await Promise.resolve()
    })
    expect(result.current.connection).toEqual(newConnection)
  })

  it('does not let an older failed read clear a newer connection', async () => {
    const reads: Array<{
      resolve: (files: never[]) => void
      reject: (error: Error) => void
    }> = []
    mocks.readFiles.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          reads.push({ resolve, reject })
        })
    )

    const { result } = renderHook(() =>
      useCurrentCliConfigConnection({
        enabledProvider: provider,
        selectedCliTool: CodeCli.HERMES,
        currentProviderConfig: providerConfig
      })
    )

    await waitFor(() => expect(reads).toHaveLength(1))
    act(() => result.current.reload())
    await waitFor(() => expect(reads).toHaveLength(2))

    await act(async () => {
      reads[1].resolve([])
      await Promise.resolve()
    })
    expect(result.current.connection).toEqual(connection)

    await act(async () => {
      reads[0].reject(new Error('stale read failed'))
      await Promise.resolve()
    })
    expect(result.current.connection).toEqual(connection)
  })
})
