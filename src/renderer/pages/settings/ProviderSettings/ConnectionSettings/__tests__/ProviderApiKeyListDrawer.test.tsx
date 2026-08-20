import ProviderApiKeyListDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderApiKeyListDrawer'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const addApiKeyMock = vi.fn()
const updateApiKeyMock = vi.fn()
const deleteApiKeyMock = vi.fn()

let mockKeys: ApiKeyEntry[] = []

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
  })
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

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
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

  it('removes a key via deleteApiKey by id', async () => {
    mockKeys = [{ id: 'key-1', key: 'sk-a', isEnabled: true }]
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(deleteApiKeyMock).toHaveBeenCalledWith('key-1')
    })
  })
})
