import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChannelDetail from '../ChannelDetail'
import type { AvailableChannel } from '../channelTypes'

const channelMocks = vi.hoisted(() => ({
  channels: [] as Array<Record<string, unknown>>,
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  mutate: vi.fn()
}))

const agentMocks = vi.hoisted(() => ({
  agents: [{ id: 'agent-1', name: 'Agent One' }]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button">copy</button>
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  WorkspaceSelector: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDivider: (props: React.HTMLAttributes<HTMLHRElement>) => <hr {...props} />,
  SettingGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <section {...props}>{children}</section>
  ),
  SettingsContentBody: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  SettingTitle: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: () => ({ data: [] })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({ agents: agentMocks.agents })
}))

vi.mock('@renderer/hooks/agent/useChannels', () => ({
  useChannels: () => ({
    channels: channelMocks.channels,
    isLoading: false,
    mutate: channelMocks.mutate,
    createChannel: channelMocks.createChannel,
    updateChannel: channelMocks.updateChannel,
    deleteChannel: channelMocks.deleteChannel
  })
}))

vi.mock('@renderer/utils/agentSession', () => ({
  getChannelTypeIcon: () => null
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void } | null>(null)

  const passthrough =
    (tag: keyof React.JSX.IntrinsicElements) =>
    ({
      children,
      closeOnOverlayClick,
      closeLabel,
      ...props
    }: {
      children?: React.ReactNode
      closeOnOverlayClick?: boolean
      closeLabel?: string
    }) => {
      void closeOnOverlayClick
      void closeLabel
      return React.createElement(tag, props, children)
    }

  return {
    Badge: passthrough('span'),
    Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
    ConfirmDialog: ({ open }: { open?: boolean }) => (open ? <div role="dialog" /> : null),
    Dialog: ({
      children,
      open,
      onOpenChange
    }: {
      children?: React.ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <div data-open={open}>
        {children}
        {open && onOpenChange && <button type="button" aria-label="close dialog" onClick={() => onOpenChange(false)} />}
      </div>
    ),
    DialogContent: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('h2'),
    EmptyState: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Label: passthrough('label'),
    NormalTooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Select: ({ children, onValueChange }: { children?: React.ReactNode; onValueChange?: (value: string) => void }) => (
      <SelectContext value={{ onValueChange }}>{children}</SelectContext>
    ),
    SelectContent: passthrough('div'),
    SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) => {
      const context = React.use(SelectContext)

      return (
        <button type="button" onClick={() => context?.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: passthrough('div'),
    SelectValue: passthrough('div'),
    Spinner: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
    Tooltip: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
      <div data-testid="tooltip">
        {children}
        {title && <span>{title}</span>}
      </div>
    )
  }
})

describe('ChannelDetail', () => {
  const channelDef: AvailableChannel = {
    type: 'telegram',
    name: 'Telegram',
    titleKey: 'agent.channels.telegram.title',
    description: 'agent.channels.telegram.description',
    available: true,
    defaultConfig: { bot_token: '', allowed_chat_ids: [] }
  }
  const feishuChannelDef: AvailableChannel = {
    type: 'feishu',
    name: 'Feishu',
    titleKey: 'agent.channels.feishu.title',
    description: 'agent.channels.feishu.description',
    available: true,
    defaultConfig: {
      app_id: '',
      app_secret: '',
      encrypt_key: '',
      verification_token: '',
      allowed_chat_ids: [],
      domain: 'feishu'
    }
  }
  const wechatChannelDef: AvailableChannel = {
    type: 'wechat',
    name: 'WeChat',
    titleKey: 'agent.channels.wechat.title',
    description: 'agent.channels.wechat.description',
    available: true,
    defaultConfig: { token_path: '', allowed_chat_ids: [] }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    HTMLElement.prototype.scrollIntoView = vi.fn()
    channelMocks.channels = [
      {
        id: 'channel-1',
        type: 'telegram',
        name: 'Telegram channel',
        agentId: 'agent-1',
        workspace: { type: 'system' },
        config: { bot_token: 'token', allowed_chat_ids: [] },
        isActive: true,
        permissionMode: 'bypassPermissions',
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z'
      }
    ]

    // Logs and QR events still use IpcApi; connection status comes from Shared Cache.
    window.api = {
      ipcApi: {
        request: vi.fn((route: string) =>
          route === 'channel.get_logs' ? Promise.resolve([]) : Promise.resolve(undefined)
        ),
        on: vi.fn(() => () => {})
      }
    } as never
  })

  it('creates new channels inactive so empty default credentials pass server validation', async () => {
    channelMocks.createChannel.mockResolvedValue({ id: 'channel-2' })
    render(<ChannelDetail channelDef={channelDef} />)

    fireEvent.click(screen.getByText('agent.channels.add'))

    await waitFor(() => {
      expect(channelMocks.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'telegram',
          config: channelDef.defaultConfig,
          isActive: false
        })
      )
    })
  })

  it('sends null permissionMode when clearing an existing override to inherit', async () => {
    render(<ChannelDetail channelDef={channelDef} />)

    const editTooltip = await screen.findByText('common.edit')
    const editButton = within(editTooltip.closest('[data-testid="tooltip"]') as HTMLElement).getByRole('button')
    fireEvent.click(editButton)

    const nameInput = await screen.findByDisplayValue<HTMLInputElement>('Telegram channel')
    expect(nameInput).toHaveFocus()
    expect(nameInput.selectionStart).toBe(nameInput.selectionEnd)

    fireEvent.click(screen.getByText('agent.channels.security.inheritFromAgent'))

    await waitFor(() => {
      expect(channelMocks.updateChannel).toHaveBeenCalledWith('channel-1', { permissionMode: null })
    })
  })

  it('creates Feishu channels active so binding an agent can start QR registration', async () => {
    channelMocks.channels = []
    channelMocks.createChannel.mockResolvedValue({
      id: 'new-feishu-channel',
      type: 'feishu',
      name: 'Feishu 1',
      config: feishuChannelDef.defaultConfig,
      isActive: true
    })
    render(<ChannelDetail channelDef={feishuChannelDef} />)

    fireEvent.click(screen.getByText('agent.channels.add'))

    await waitFor(() => {
      expect(channelMocks.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'feishu',
          config: feishuChannelDef.defaultConfig,
          isActive: true
        })
      )
    })
  })

  it('creates WeChat channels active so binding an agent can start QR login', async () => {
    channelMocks.channels = []
    channelMocks.createChannel.mockResolvedValue({
      id: 'new-wechat-channel',
      type: 'wechat',
      name: 'WeChat',
      config: wechatChannelDef.defaultConfig,
      isActive: true
    })
    render(<ChannelDetail channelDef={wechatChannelDef} />)

    fireEvent.click(screen.getByText('agent.channels.add'))

    await waitFor(() => {
      expect(channelMocks.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wechat',
          config: wechatChannelDef.defaultConfig,
          isActive: true
        })
      )
    })
  })

  it('closes the edit dialog without clearing its content first', () => {
    const { rerender } = render(<ChannelDetail channelDef={channelDef} />)

    const editTooltip = screen.getByText('common.edit')
    const editButton = within(editTooltip.closest('[data-testid="tooltip"]') as HTMLElement).getByRole('button')
    fireEvent.click(editButton)
    fireEvent.click(screen.getByRole('button', { name: 'close dialog' }))

    channelMocks.channels = []
    rerender(<ChannelDetail channelDef={channelDef} />)

    const title = screen.getByRole('heading', { name: 'Telegram channel' })
    expect(title).toBeInTheDocument()
    expect(title.closest('[data-open]')).toHaveAttribute('data-open', 'false')
  })
})
