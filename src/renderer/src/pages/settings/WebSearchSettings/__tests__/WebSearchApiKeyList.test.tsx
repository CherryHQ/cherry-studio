import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebSearchApiKeyList } from '../components/WebSearchApiKeyList'
import type * as WebSearchApiKeyListHook from '../hooks/useWebSearchApiKeyList'

const toastErrorMock = vi.fn()
const toastWarningMock = vi.fn()
const confirmMock = vi.fn()
const updateListItemMock = vi.fn()
const removeListItemMock = vi.fn()
const addPendingKeyMock = vi.fn()

const defaultItem = { id: 'saved-0-key-a', key: 'key-a', index: 0, isNew: false }

const mocks = vi.hoisted(() => ({
  useWebSearchApiKeyList: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: React.HTMLAttributes<HTMLDivElement>) => <>{children}</>
}))

vi.mock('../hooks/useWebSearchApiKeyList', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSearchApiKeyListHook>()),
  useWebSearchApiKeyList: (...args: unknown[]) => mocks.useWebSearchApiKeyList(...args)
}))

describe('WebSearchApiKeyList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      toast: {
        ...window.toast,
        error: toastErrorMock,
        warning: toastWarningMock
      },
      modal: {
        ...window.modal,
        confirm: confirmMock
      }
    })
    confirmMock.mockResolvedValue(true)
    updateListItemMock.mockResolvedValue({ isValid: true })
    removeListItemMock.mockResolvedValue(undefined)
    mocks.useWebSearchApiKeyList.mockReturnValue({
      provider: {
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKeys: ['key-a'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      },
      keys: ['key-a'],
      displayItems: [defaultItem],
      hasPendingNewKey: false,
      addPendingKey: addPendingKeyMock,
      updateListItem: updateListItemMock,
      removeListItem: removeListItemMock
    })
  })

  it('shows a save-failed toast when saving a key rejects', async () => {
    updateListItemMock.mockRejectedValueOnce(new Error('persist failed'))
    render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'key-b' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
  })

  it('shows validation warnings without surfacing save errors', async () => {
    updateListItemMock.mockResolvedValueOnce({
      isValid: false,
      error: 'settings.provider.api.key.error.duplicate'
    })
    render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith('settings.provider.api.key.error.duplicate')
    })
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('shows a save-failed toast when deleting a key rejects', async () => {
    removeListItemMock.mockRejectedValueOnce(new Error('persist failed'))
    render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
  })

  it('restores the previous value when editing is cancelled', () => {
    render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.change(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder'), {
      target: { value: 'changed-key' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))

    expect(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder')).toHaveValue('key-a')
    expect(updateListItemMock).not.toHaveBeenCalled()
  })

  it('removes unsaved pending keys without confirmation when cancelled', () => {
    mocks.useWebSearchApiKeyList.mockReturnValue({
      provider: {
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKeys: ['key-a'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      },
      keys: ['key-a'],
      displayItems: [defaultItem, { id: 'pending-1', key: '', index: 1, isNew: true }],
      hasPendingNewKey: true,
      addPendingKey: addPendingKeyMock,
      updateListItem: updateListItemMock,
      removeListItem: removeListItemMock
    })

    render(<WebSearchApiKeyList providerId="tavily" />)
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(removeListItemMock).toHaveBeenCalledOnce()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('does not remove a key when delete confirmation is cancelled', async () => {
    confirmMock.mockResolvedValueOnce(false)
    render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledOnce()
    })
    expect(removeListItemMock).not.toHaveBeenCalled()
  })

  it('syncs edit input when the item key changes externally', () => {
    const { rerender } = render(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    expect(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder')).toHaveValue('key-a')

    mocks.useWebSearchApiKeyList.mockReturnValue({
      provider: {
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKeys: ['key-b'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      },
      keys: ['key-b'],
      displayItems: [{ id: 'saved-0-key-a', key: 'key-b', index: 0, isNew: false }],
      hasPendingNewKey: false,
      addPendingKey: addPendingKeyMock,
      updateListItem: updateListItemMock,
      removeListItem: removeListItemMock
    })
    rerender(<WebSearchApiKeyList providerId="tavily" />)

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    expect(screen.getByPlaceholderText('settings.provider.api.key.new_key.placeholder')).toHaveValue('key-b')
  })

  it('adds a pending key and disables add while pending', () => {
    mocks.useWebSearchApiKeyList.mockReturnValue({
      provider: {
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKeys: ['key-a'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      },
      keys: ['key-a'],
      displayItems: [defaultItem],
      hasPendingNewKey: true,
      addPendingKey: addPendingKeyMock,
      updateListItem: updateListItemMock,
      removeListItem: removeListItemMock
    })

    render(<WebSearchApiKeyList providerId="tavily" />)

    const addButton = screen.getByRole('button', { name: /common.add/ })
    expect(addButton).toBeDisabled()
    fireEvent.click(addButton)
    expect(addPendingKeyMock).not.toHaveBeenCalled()
  })
})
