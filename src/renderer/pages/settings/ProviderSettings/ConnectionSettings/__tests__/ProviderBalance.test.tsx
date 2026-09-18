import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import type { Provider } from '@shared/data/types/provider'
import type { ProviderBalance as Balance } from '@shared/data/types/providerBalance'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ProviderBalanceErrorCode } from '@shared/ipc/errors/providerBalance'
import { MockUseDataApiUtils, mockUseMutation } from '@test-mocks/renderer/useDataApi'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderBalance } from '../../hooks/providerSetting/useProviderBalance'
import { ProviderBalance } from '../ProviderBalance'
import { ProviderBalanceConfigDrawer } from '../ProviderBalanceConfigDrawer'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })

function wrapper() {
  const cache = new Map()
  return ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
    </I18nextProvider>
  )
}

const balance = (amount: number): Balance => ({
  kind: 'account-balance',
  balances: [{ currency: 'USD', amount }],
  updatedAt: '2026-09-18T01:00:00.000Z'
})
const provider: Provider = {
  id: 'deepseek',
  presetProviderId: 'deepseek',
  name: 'DeepSeek',
  supportsBalance: true,
  updatedAt: 1,
  apiKeys: [
    { id: 'a', isEnabled: true },
    { id: 'b', isEnabled: true }
  ],
  authType: 'api-key',
  settings: {},
  isEnabled: true,
  reportsActualCost: false
}

describe('provider balance settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/providers/:providerId', provider)
  })

  it('keeps the last successful balance on refresh failure and recovers on retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(ipcApi, 'request')
      .mockResolvedValueOnce(balance(12.5))
      .mockRejectedValueOnce(new IpcError(ProviderBalanceErrorCode.NETWORK))
      .mockResolvedValueOnce(balance(8))
    render(<ProviderBalance providerId="deepseek" />, { wrapper: wrapper() })
    expect(await screen.findByText(/USD.*12\.50/)).toBeInTheDocument()
    const timestamp = screen.getByText(/Last updated:/).textContent
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach')
    expect(screen.getByText(/USD.*12\.50/)).toBeInTheDocument()
    expect(screen.getByText(/Last updated:/)).toHaveTextContent(timestamp)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(/USD.*8\.00/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('isolates results by key and persisted revision, including late responses', async () => {
    let finishOld!: (value: Balance) => void
    vi.spyOn(ipcApi, 'request')
      .mockImplementationOnce(
        () =>
          new Promise<Balance>((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValueOnce(balance(20))
      .mockResolvedValueOnce(balance(30))
    const { result, rerender } = renderHook(({ keyId }) => useProviderBalance('deepseek', keyId), {
      initialProps: { keyId: 'a' },
      wrapper: wrapper()
    })
    await waitFor(() => expect(finishOld).toBeDefined())
    rerender({ keyId: 'b' })
    await waitFor(() => expect(result.current.data?.balances[0].amount).toBe(20))
    await act(async () => {
      finishOld(balance(99))
    })
    expect(result.current.data?.balances[0].amount).toBe(20)
    MockUseDataApiUtils.mockQueryData('/providers/:providerId', { ...provider, updatedAt: 2 })
    rerender({ keyId: 'b' })
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.data?.balances[0].amount).toBe(30))
  })

  it('tests a custom form without saving and persists only when Save is clicked', async () => {
    const user = userEvent.setup()
    const custom = { ...provider, id: 'custom', presetProviderId: undefined, supportsBalance: false }
    MockUseDataApiUtils.mockQueryData('/providers/:providerId', custom)
    const save = vi.fn().mockResolvedValue(custom)
    mockUseMutation.mockReturnValue({ trigger: save, isLoading: false, error: undefined })
    const request = vi.spyOn(ipcApi, 'request').mockResolvedValue(balance(5))
    const close = vi.fn()
    render(<ProviderBalanceConfigDrawer providerId="custom" keyId="a" onClose={close} />, { wrapper: wrapper() })
    await user.click(screen.getByRole('switch', { name: 'Enable balance queries' }))
    await user.click(screen.getByRole('button', { name: 'Test query' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the query URL')
    expect(request).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Balance query URL' }), 'https://relay.example/balance')
    await user.type(screen.getByRole('textbox', { name: /Balance field path/ }), 'data.balance')
    await user.click(screen.getByRole('button', { name: 'Test query' }))
    expect(await screen.findByText('USD 5')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(
      'provider.balance.test',
      expect.objectContaining({
        providerId: 'custom',
        keyId: 'a',
        config: expect.objectContaining({ amountPath: 'data.balance' })
      })
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledWith({
      params: { providerId: 'custom' },
      body: {
        providerSettings: {
          balanceQuery: {
            enabled: true,
            endpoint: 'https://relay.example/balance',
            amountPath: 'data.balance',
            currency: 'CNY',
            rechargeUrl: ''
          }
        }
      }
    })
    expect(close).toHaveBeenCalled()
  })

  it('does not query or display balance for an unsupported built-in provider', () => {
    MockUseDataApiUtils.mockQueryData('/providers/:providerId', { ...provider, supportsBalance: false })
    const request = vi.spyOn(ipcApi, 'request')
    render(<ProviderBalance providerId="deepseek" />, { wrapper: wrapper() })
    expect(screen.queryByText('Balance')).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })
})
