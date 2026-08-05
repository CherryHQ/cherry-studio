import { CHERRYIN_HOSTS, type CherryInEndpointSelection } from '@shared/utils/cherryin'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMocks = vi.hoisted(() => ({
  endpointSelectedHandler: undefined as ((selection: CherryInEndpointSelection) => void) | undefined,
  request: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({ description, label }: { description?: string; label: string }) => (
    <div>
      {label}
      {description}
    </div>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div data-testid="route-trigger">{children}</div>
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
      mode: 'china'
    } satisfies CherryInEndpointSelection)
  })

  it('updates the selected route and service links across windows', async () => {
    render(<CherryInSettings providerId="cherryin" />)

    const trigger = screen.getByTestId('route-trigger')
    await waitFor(() => expect(within(trigger).getByText('加速线路')).toBeInTheDocument())
    expect(within(trigger).queryByText('open.cherryin.net')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '官方网站' })).toHaveAttribute('href', CHERRYIN_HOSTS.china)
    expect(screen.getByRole('link', { name: '获取密钥' })).toHaveAttribute(
      'href',
      `${CHERRYIN_HOSTS.china}/console/token`
    )
    expect(screen.getByRole('link', { name: '模型文档' })).toHaveAttribute('href', `${CHERRYIN_HOSTS.china}/pricing`)

    act(() => {
      ipcMocks.endpointSelectedHandler?.({
        host: CHERRYIN_HOSTS.global,
        mode: 'global'
      })
    })

    expect(within(trigger).getByText('国际线路')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '官方网站' })).toHaveAttribute('href', CHERRYIN_HOSTS.global)
    expect(screen.getByRole('link', { name: '获取密钥' })).toHaveAttribute(
      'href',
      `${CHERRYIN_HOSTS.global}/console/token`
    )
    expect(screen.getByRole('link', { name: '模型文档' })).toHaveAttribute('href', `${CHERRYIN_HOSTS.global}/pricing`)
  })

  it('shows the automatic mode instead of its resolved endpoint', async () => {
    ipcMocks.request.mockResolvedValue({
      host: CHERRYIN_HOSTS.global,
      mode: 'auto'
    } satisfies CherryInEndpointSelection)

    render(<CherryInSettings providerId="cherryin" />)

    const trigger = screen.getByTestId('route-trigger')
    await waitFor(() => expect(within(trigger).getByText('自动优选')).toBeInTheDocument())
    expect(within(trigger).queryByText('open.cherryin.ai')).not.toBeInTheDocument()
  })
})
