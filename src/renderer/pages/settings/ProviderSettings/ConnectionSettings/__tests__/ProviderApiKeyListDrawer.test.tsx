import ProviderApiKeyListDrawer from '@renderer/pages/settings/ProviderSettings/ConnectionSettings/ProviderApiKeyListDrawer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateApiKeysMock = vi.fn()
const useProviderApiKeysMock = vi.fn()

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
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args),
  useProviderMutations: () => ({
    updateApiKeys: updateApiKeysMock
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
    updateApiKeysMock.mockResolvedValue(undefined)
    useProviderApiKeysMock.mockReturnValue({ data: { keys: [] } })
    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('saves new API key drafts as enabled by default', async () => {
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: ' sk-new ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(updateApiKeysMock).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'sk-new',
          isEnabled: true
        })
      ])
    })
  })

  it('requests detection after saving a new enabled API key', async () => {
    const onApiKeyChange = vi.fn()
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'sk-new' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(onApiKeyChange).toHaveBeenCalledWith('detect'))
  })

  it('requests detection after enabling a disabled API key', async () => {
    const onApiKeyChange = vi.fn()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-existing', isEnabled: false }] }
    })
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(onApiKeyChange).toHaveBeenCalledWith('detect'))
  })

  it('does not request detection for a label-only edit', async () => {
    const onApiKeyChange = vi.fn()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-existing', label: 'Old label', isEnabled: true }] }
    })
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api_key.label_placeholder'), {
      target: { value: 'New label' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(updateApiKeysMock).toHaveBeenCalled())
    expect(onApiKeyChange).not.toHaveBeenCalled()
  })

  it('invalidates detected models after removing an enabled API key', async () => {
    const onApiKeyChange = vi.fn()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-existing', isEnabled: true }] }
    })
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => expect(onApiKeyChange).toHaveBeenCalledWith('invalidate'))
  })

  it('invalidates detected models after removing a disabled API key', async () => {
    const onApiKeyChange = vi.fn()
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-disabled', isEnabled: false }] }
    })
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => expect(onApiKeyChange).toHaveBeenCalledWith('invalidate'))
  })

  it('does not emit a key change when persistence fails', async () => {
    const onApiKeyChange = vi.fn()
    updateApiKeysMock.mockRejectedValueOnce(new Error('save failed'))
    render(<ProviderApiKeyListDrawer providerId="openai" open onClose={vi.fn()} onApiKeyChange={onApiKeyChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.add' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'sk-new' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(updateApiKeysMock).toHaveBeenCalled())
    expect(onApiKeyChange).not.toHaveBeenCalled()
  })
})
