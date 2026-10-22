import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import type { ChannelData } from '../channelTypes'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  request: vi.fn(async () => ({ exists: false }))
}))
const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US', resolvedLanguage: 'en-US' } })
}))
vi.mock('@renderer/ipc', async () => {
  const React = await import('react')
  return {
    ipcApi: { request: ipc.request, on: vi.fn(() => () => {}) },
    useIpcOn: (event: string, handler: (data: unknown) => void) => {
      React.useEffect(() => {
        ipc.handlers.set(event, handler)
        return () => {
          if (ipc.handlers.get(event) === handler) ipc.handlers.delete(event)
        }
      }, [event, handler])
    }
  }
})
vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }))

import { FeishuForm, WeChatForm } from '../ChannelForms'

function channel(id: string, type: string): ChannelData {
  return { id, type, name: type, config: {}, isActive: false }
}

function emit(event: string, payload: unknown) {
  act(() => {
    ipc.handlers.get(event)?.(payload)
  })
}

describe('channel login error details', () => {
  beforeEach(() => {
    ipc.handlers.clear()
    ipc.request.mockClear()
    ipc.request.mockResolvedValue({ exists: false })
    detailMocks.open.mockReset()
    vi.mocked(toast.error).mockClear()
    MockUseCacheUtils.resetMocks()
  })

  it('keeps each QR failure on its own event and ignores a cached connection error', async () => {
    MockUseCacheUtils.setSharedCacheValue('channel.status.feishu-1', {
      channelId: 'feishu-1',
      connected: false,
      error: 'old feishu connection'
    })
    MockUseCacheUtils.setSharedCacheValue('channel.status.wechat-1', {
      channelId: 'wechat-1',
      connected: false,
      error: 'old wechat connection'
    })
    render(
      <>
        <FeishuForm channel={channel('feishu-1', 'feishu')} onConfigChange={vi.fn()} />
        <WeChatForm channel={channel('wechat-1', 'wechat')} onConfigChange={vi.fn()} />
      </>
    )
    emit('channel.feishu.qr_login', { channelId: 'feishu-1', status: 'error' })
    emit('channel.wechat.qr_login', { channelId: 'wechat-1', status: 'error' })

    const buttons = screen.getAllByRole('button', { name: 'error.details' })
    expect(screen.getAllByText('agent.channels.error')).toHaveLength(2)
    expect(screen.queryByText('old feishu connection')).not.toBeInTheDocument()
    expect(screen.queryByText('old wechat connection')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()

    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalledTimes(2))
    const [feishu, wechat] = detailMocks.open.mock.calls.map((call) => call[0])
    expect(JSON.stringify([feishu, wechat])).not.toContain('old feishu connection')
    expect(JSON.stringify([feishu, wechat])).not.toContain('old wechat connection')
    expect(feishu.localizedErrorMessage ?? feishu.message).toBe('agent.channels.error')
    expect(feishu.context?.source ?? feishu.source).toBe('settings.channels')
    expect(feishu.context?.operation ?? feishu.operation).toBe('channel.feishu.login')
    expect(feishu.context?.recordId ?? feishu.recordId).toBe('feishu-1')
    expect(feishu.error?.message).toBeUndefined()
    expect(wechat.context?.operation ?? wechat.operation).toBe('channel.wechat.login')
    expect(wechat.context?.recordId ?? wechat.recordId).toBe('wechat-1')
    expect(wechat.error?.message).toBeUndefined()
    expect(wechat.error ?? wechat).not.toBe(feishu.error ?? feishu)

    detailMocks.open.mockClear()
    emit('channel.feishu.qr_login', { channelId: 'feishu-1', status: 'error' })
    fireEvent.click(screen.getAllByRole('button', { name: 'error.details' })[0])
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const again = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(again.context?.recordId ?? again.recordId).toBe('feishu-1')
    expect(again.localizedErrorMessage ?? again.message).toBe('agent.channels.error')
    expect(again.error ?? again).not.toBe(feishu.error ?? feishu)
    expect(JSON.stringify(again)).not.toContain('old feishu connection')
  })

  it('does not invent a cause when the QR event has none and skips expired status', async () => {
    render(<FeishuForm channel={channel('feishu-2', 'feishu')} onConfigChange={vi.fn()} />)
    emit('channel.feishu.qr_login', { channelId: 'feishu-2', status: 'error' })
    fireEvent.click(screen.getByRole('button', { name: 'error.details' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const opened = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(opened.localizedErrorMessage).toBe('agent.channels.error')
    expect(opened.context).toMatchObject({
      source: 'settings.channels',
      operation: 'channel.feishu.login',
      recordId: 'feishu-2',
      message: 'agent.channels.error'
    })
    expect(opened.error).toBeUndefined()
    expect(opened.context.name).toBeUndefined()
    expect(opened.context.stack).toBeUndefined()

    emit('channel.feishu.qr_login', { channelId: 'feishu-2', status: 'expired' })
    expect(screen.queryByRole('button', { name: 'error.details' })).not.toBeInTheDocument()
  })
})
