import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUiModule from '@cherrystudio/ui'

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

vi.mock('@renderer/data/hooks/useDataApi', async () => ({
  useDataChange: (await import('@renderer/data/hooks/useDataChange')).useDataChange,
  useQuery: () => ({ data: [], refetch: vi.fn() })
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

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUiModule>()
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
    ...actual,
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

  it('passes independent WeCom field patches through the settings save boundary', async () => {
    const config = { bot_id: 'old-bot', secret: 'old-secret', allowed_chat_ids: [], allowed_user_ids: [] }
    channelMocks.channels = [{ ...channelMocks.channels[0], type: 'wecom', config, isActive: false }]
    render(<ChannelDetail channelDef={{ ...channelDef, type: 'wecom', name: 'WeCom', defaultConfig: config }} />)
    const tooltip = await screen.findByText('common.edit')
    fireEvent.click(within(tooltip.closest('[data-testid="tooltip"]') as HTMLElement).getByRole('button'))
    for (const [key, value] of [
      ['botId', 'new-bot'],
      ['secret', ' secret ']
    ]) {
      const input = await screen.findByLabelText(`agent.channels.wecom.${key}`)
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
    }
    expect(channelMocks.updateChannel.mock.calls).toEqual([
      ['channel-1', { configPatch: { bot_id: 'new-bot' } }],
      ['channel-1', { configPatch: { secret: ' secret ' } }]
    ])
  })

  it('saves Feishu mention-only changes and renders reloaded values', async () => {
    const user = userEvent.setup()
    const config = {
      app_id: 'app-id',
      app_secret: 'app-secret',
      encrypt_key: 'encrypt-key',
      verification_token: 'verification-token',
      domain: 'lark',
      allowed_chat_ids: ['chat-1']
    }
    channelMocks.channels = [{ ...channelMocks.channels[0], type: 'feishu', config }]
    channelMocks.updateChannel.mockImplementationOnce(async (_id, patch) => ({
      ...channelMocks.channels[0],
      config: { ...config, ...patch.configPatch }
    }))
    const { rerender } = render(<ChannelDetail channelDef={feishuChannelDef} />)
    await user.click(await screen.findByRole('button', { name: 'common.edit' }))

    const mentionSwitch = await screen.findByRole('switch', { name: 'agent.channels.feishu.mentionOnlyLabel' })
    expect(mentionSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(mentionSwitch)
    await waitFor(() => {
      expect(channelMocks.updateChannel).toHaveBeenLastCalledWith('channel-1', {
        configPatch: { mention_only: false }
      })
    })

    const savedChannel = await channelMocks.updateChannel.mock.results.at(-1)!.value
    channelMocks.channels = [savedChannel]
    rerender(<ChannelDetail channelDef={feishuChannelDef} />)
    const reloadedSwitch = screen.getByRole('switch', { name: 'agent.channels.feishu.mentionOnlyLabel' })
    expect(reloadedSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(reloadedSwitch)
    await waitFor(() => {
      expect(channelMocks.updateChannel).toHaveBeenLastCalledWith('channel-1', {
        configPatch: { mention_only: true }
      })
    })
  })

  it('does not overwrite a credential edit that is still saving when the mention switch is toggled', async () => {
    const user = userEvent.setup()
    const config = { app_id: 'app-id', app_secret: 'old-secret', allowed_chat_ids: [] }
    channelMocks.channels = [{ ...channelMocks.channels[0], type: 'feishu', config }]
    let finishSave!: (value: unknown) => void
    const pendingSave = new Promise((resolve) => {
      finishSave = resolve
    })
    channelMocks.updateChannel
      .mockImplementationOnce(() => pendingSave)
      .mockResolvedValueOnce({
        ...channelMocks.channels[0],
        config: { ...config, app_secret: 'new-secret', mention_only: false }
      })
    render(<ChannelDetail channelDef={feishuChannelDef} />)
    await user.click(await screen.findByRole('button', { name: 'common.edit' }))

    try {
      const secretInput = screen.getByPlaceholderText('agent.channels.feishu.appSecretPlaceholder')
      await user.clear(secretInput)
      await user.type(secretInput, 'new-secret')
      await user.tab()
      expect(channelMocks.updateChannel).toHaveBeenCalledWith('channel-1', {
        configPatch: { app_secret: 'new-secret' }
      })

      await user.click(screen.getByRole('switch', { name: 'agent.channels.feishu.mentionOnlyLabel' }))

      expect(channelMocks.updateChannel.mock.calls.at(-1)).toEqual([
        'channel-1',
        { configPatch: { mention_only: false } }
      ])
      const payload = channelMocks.updateChannel.mock.calls.at(-1)![1]
      expect(payload).not.toHaveProperty('config')
      expect(payload).not.toHaveProperty('app_secret')
      expect(payload.configPatch).not.toHaveProperty('app_secret')
    } finally {
      await act(async () => {
        finishSave({ ...channelMocks.channels[0], config: { ...config, app_secret: 'new-secret' } })
        await pendingSave
      })
    }
  })

  it('keeps the mention toggle when a companion Feishu field is saved while updates are pending', async () => {
    const user = userEvent.setup()
    const config = { app_id: 'app-id', app_secret: 'old-secret', mention_only: true, allowed_chat_ids: [] }
    channelMocks.channels = [{ ...channelMocks.channels[0], type: 'feishu', config }]
    let finishSave!: (value: unknown) => void
    const pendingSave = new Promise((resolve) => {
      finishSave = resolve
    })
    channelMocks.updateChannel.mockImplementationOnce(() => pendingSave)
    render(<ChannelDetail channelDef={feishuChannelDef} />)
    await user.click(await screen.findByRole('button', { name: 'common.edit' }))

    try {
      await user.click(screen.getByRole('switch', { name: 'agent.channels.feishu.mentionOnlyLabel' }))
      expect(channelMocks.updateChannel).toHaveBeenLastCalledWith('channel-1', {
        configPatch: { mention_only: false }
      })

      const secretInput = screen.getByPlaceholderText('agent.channels.feishu.appSecretPlaceholder')
      await user.clear(secretInput)
      await user.type(secretInput, 'new-secret')
      await user.tab()
      expect(channelMocks.updateChannel.mock.calls.at(-1)).toEqual([
        'channel-1',
        { configPatch: { app_secret: 'new-secret' } }
      ])
      const payload = channelMocks.updateChannel.mock.calls.at(-1)![1]
      expect(payload).not.toHaveProperty('config')
      expect(payload).not.toHaveProperty('mention_only')
      expect(payload.configPatch).not.toHaveProperty('mention_only')

      await user.click(screen.getByRole('button', { name: 'agent.channels.feishu.domainLark' }))
      expect(channelMocks.updateChannel).toHaveBeenLastCalledWith('channel-1', {
        configPatch: { domain: 'lark' }
      })

      const chatIdsInput = screen.getByPlaceholderText('agent.channels.feishu.chatIdsPlaceholder')
      await user.type(chatIdsInput, ' chat-1, chat-2 ')
      await user.tab()
      expect(channelMocks.updateChannel).toHaveBeenLastCalledWith('channel-1', {
        configPatch: { allowed_chat_ids: ['chat-1', 'chat-2'] }
      })
    } finally {
      await act(async () => {
        finishSave({ ...channelMocks.channels[0], config: { ...config, mention_only: false } })
        await pendingSave
      })
    }
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
