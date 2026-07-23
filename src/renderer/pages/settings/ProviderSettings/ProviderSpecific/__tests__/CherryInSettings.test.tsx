import { CHERRYIN_HOSTS, type CherryInEndpointSelection } from '@shared/utils/cherryin'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({
  endpointSelectedHandler: undefined as ((selection: CherryInEndpointSelection) => void) | undefined,
  request: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({ description, label }: { description: string; label: string }) => (
    <div>
      {label}
      {description}
    </div>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    provider: {
      endpointConfigs: {
        openai: { baseUrl: 'https://open.cherryin.net' }
      }
    }
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcMocks.request },
  useIpcOn: (_event: string, handler: (selection: CherryInEndpointSelection) => void) => {
    ipcMocks.endpointSelectedHandler = handler
  }
}))

import CherryInSettings from '../CherryInSettings'

describe('CherryInSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.endpointSelectedHandler = undefined
    ipcMocks.request.mockResolvedValue({
      host: CHERRYIN_HOSTS.china,
      mode: 'china',
      source: 'manual'
    } satisfies CherryInEndpointSelection)
  })

  it('updates its local selection when another window selects an endpoint', async () => {
    render(<CherryInSettings providerId="cherryin" />)

    await waitFor(() => expect(screen.getByText('open.cherryin.net')).toBeInTheDocument())

    act(() => {
      ipcMocks.endpointSelectedHandler?.({
        host: CHERRYIN_HOSTS.global,
        mode: 'global',
        source: 'manual'
      })
    })

    expect(screen.getByText('open.cherryin.ai')).toBeInTheDocument()
  })
})
