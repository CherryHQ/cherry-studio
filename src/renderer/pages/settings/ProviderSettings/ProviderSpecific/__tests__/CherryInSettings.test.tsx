import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  serializeEndpointConfigsWrite,
  setLastWrittenEndpointConfigs
} from '../../hooks/providerSetting/endpointConfigsWriteCoordinator'

const useProviderMock = vi.fn()
const updateProviderMock = vi.fn()
const refetchMock = vi.fn()

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({ label, description, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {label} {description}
    </button>
  ),
  MenuList: ({ children }: any) => <div>{children}</div>,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives', () => ({
  fieldClasses: { input: '', inputGroupBlock: '' }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import CherryInSettings from '../CherryInSettings'

const CHAT = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
const PROVIDER_ID = 'cherryin'

function staleProvider() {
  return {
    id: PROVIDER_ID,
    endpointConfigs: { [CHAT]: { baseUrl: 'https://open.cherryin.net/v1' } }
  } as any
}

async function switchToInternationalHost() {
  const user = userEvent.setup()
  render(<CherryInSettings providerId={PROVIDER_ID} />)
  await user.click(screen.getByRole('button', { name: /open\.cherryin\.ai/ }))
}

describe('CherryInSettings host switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLastWrittenEndpointConfigs(PROVIDER_ID)
    updateProviderMock.mockResolvedValue(undefined)
    refetchMock.mockResolvedValue(undefined)
    useProviderMock.mockReturnValue({
      provider: staleProvider(),
      updateProvider: updateProviderMock,
      refetch: refetchMock
    })
  })

  it('builds the domain swap on the refetched snapshot so a concurrent reasoningFormat survives', async () => {
    refetchMock.mockResolvedValue({
      endpointConfigs: {
        [CHAT]: { baseUrl: 'https://open.cherryin.net/v1', reasoningFormat: { type: 'self-hosted' } }
      }
    })

    await switchToInternationalHost()

    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledTimes(1)
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: {
          [CHAT]: { baseUrl: 'https://open.cherryin.ai/v1', reasoningFormat: { type: 'self-hosted' } }
        }
      })
      expect(getLastWrittenEndpointConfigs(PROVIDER_ID)).toEqual({
        [CHAT]: { baseUrl: 'https://open.cherryin.ai/v1', reasoningFormat: { type: 'self-hosted' } }
      })
    })
  })

  it('serializes with an overlapping drawer save and builds on its published snapshot', async () => {
    let releaseDrawer!: () => void
    const drawerGate = new Promise<void>((resolve) => {
      releaseDrawer = resolve
    })
    const drawerWrite = serializeEndpointConfigsWrite(PROVIDER_ID, async () => {
      await drawerGate
      const landed = {
        [CHAT]: { baseUrl: 'https://open.cherryin.net/v1', reasoningFormat: { type: 'self-hosted' } }
      } as any
      setLastWrittenEndpointConfigs(PROVIDER_ID, landed)
      return landed
    })
    // The refetch misses the in-flight drawer result, forcing the shared-snapshot fallback.
    refetchMock.mockResolvedValue(undefined)

    await switchToInternationalHost()

    // The host write is queued behind the drawer write: give it a chance to
    // run, then assert nothing was persisted while the drawer held the chain.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(updateProviderMock).not.toHaveBeenCalled()

    releaseDrawer()
    await drawerWrite
    await waitFor(() => {
      expect(updateProviderMock).toHaveBeenCalledTimes(1)
      expect(updateProviderMock).toHaveBeenCalledWith({
        endpointConfigs: {
          [CHAT]: { baseUrl: 'https://open.cherryin.ai/v1', reasoningFormat: { type: 'self-hosted' } }
        }
      })
    })
  })
})
