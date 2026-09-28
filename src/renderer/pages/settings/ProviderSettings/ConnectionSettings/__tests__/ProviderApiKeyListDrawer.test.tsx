import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderApiKeyListDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderApiKeyListDrawer'
import type { ApiKeyEntry } from '@shared/data/types/provider'

const addApiKeyMock = vi.fn()
const updateApiKeyMock = vi.fn()
const deleteApiKeyMock = vi.fn()
const checkApiMock = vi.fn()

let mockKeys: ApiKeyEntry[] = []
let mockModels: Array<{ id: string; name: string }> = [{ id: 'openai::gpt-4o', name: 'GPT-4o' }]

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderApiKeys: () => ({
    data: { keys: mockKeys }
  }),
  useProviderMutations: () => ({
    addApiKey: addApiKeyMock,
    updateApiKey: updateApiKeyMock,
    deleteApiKey: deleteApiKeyMock
  }),
  // The quota row inside each key reads the provider for its tier and renewal anchor.
  useProvider: () => ({ provider: { id: 'openai', apiKeys: mockKeys }, updateApiKey: updateApiKeyMock })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: mockModels })
}))

// The rotation policy row appears once a provider has more than one key.
vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [{}, vi.fn()]
}))

vi.mock('../../utils/healthCheck', () => ({
  checkApi: (...args: unknown[]) => checkApiMock(...args),
  // Every model in these tests is chat-capable; the real rule skips image/audio models.
  getModelHealthCheckSkipReason: () => null,
  // The real one classifies the provider error; here the raw message is enough to assert on.
  healthCheckErrorToDiagnosis: () => undefined
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ children, footer, open }: any) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null
}))

describe('ProviderApiKeyListDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKeys = []
    mockModels = [{ id: 'openai::gpt-4o', name: 'GPT-4o' }]
    checkApiMock.mockResolvedValue({ latency: 120 })
    addApiKeyMock.mockResolvedValue(undefined)
    updateApiKeyMock.mockResolvedValue(undefined)
    deleteApiKeyMock.mockResolvedValue(undefined)
    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('creates new drafts via addApiKey with the trimmed key value', async () => {
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.add_key' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: ' sk-new ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(addApiKeyMock).toHaveBeenCalledWith('sk-new', undefined)
    })
  })

  it('saves edits to an existing key via updateApiKey without touching other entries', async () => {
    mockKeys = [
      { id: 'key-1', key: 'sk-old', label: 'Main', isEnabled: true },
      { id: 'key-2', key: 'sk-other', isEnabled: true }
    ]
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'common.edit' })[0])
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'sk-rotated' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateApiKeyMock).toHaveBeenCalledWith('key-1', { key: 'sk-rotated', label: 'Main' })
    })
    expect(addApiKeyMock).not.toHaveBeenCalled()
    expect(deleteApiKeyMock).not.toHaveBeenCalled()
  })

  it('toggles enablement via updateApiKey with only the isEnabled change', async () => {
    mockKeys = [{ id: 'key-1', key: 'sk-a', isEnabled: true }]
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(updateApiKeyMock).toHaveBeenCalledWith('key-1', { isEnabled: false })
    })
  })

  it('never renders a short stored key as plain text', () => {
    mockKeys = [{ id: 'key-1', key: 'short', isEnabled: true }]

    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.queryByText('short')).not.toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
  })

  it('tries a newly added key against the provider so a dead key is caught here', async () => {
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_setup.add_key' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'sk-new' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(checkApiMock).toHaveBeenCalledWith('openai::gpt-4o', expect.objectContaining({ apiKey: 'sk-new' }))
    })
  })

  it('reports a key the provider rejected instead of leaving it looking healthy', async () => {
    mockKeys = [{ id: 'key-1', key: 'sk-dead', isEnabled: true }]
    checkApiMock.mockRejectedValue(new Error('Insufficient Balance'))
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_key.probe.action' }))

    expect(await screen.findByText('settings.provider.api_key.probe.failed')).toBeInTheDocument()
  })

  it('offers no test button when the provider has no model that can answer a probe', () => {
    mockKeys = [{ id: 'key-1', key: 'sk-a', isEnabled: true }]
    mockModels = []
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'settings.provider.api_key.probe.action' })).not.toBeInTheDocument()
  })

  it('removes a key via deleteApiKey by id', async () => {
    mockKeys = [{ id: 'key-1', key: 'sk-a', isEnabled: true }]
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(deleteApiKeyMock).toHaveBeenCalledWith('key-1')
    })
  })
})
