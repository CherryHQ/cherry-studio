import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

const { commandServiceMock, menuMock, browserWindowMock, popupMock, windowMock } = vi.hoisted(() => {
  const popupMock = vi.fn()
  const windowMock = { id: 1 }
  return {
    popupMock,
    windowMock,
    commandServiceMock: {
      canExecute: vi.fn(),
      execute: vi.fn()
    },
    menuMock: {
      buildFromTemplate: vi.fn(() => ({
        popup: popupMock
      }))
    },
    browserWindowMock: {
      fromWebContents: vi.fn(() => windowMock)
    }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    CommandService: commandServiceMock
  } as any)
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected readonly handlers = new Map<string, (...args: any[]) => unknown>()

    protected ipcHandle(channel: string, handler: (...args: any[]) => unknown) {
      this.handlers.set(channel, handler)
      return { dispose: vi.fn() }
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  Menu: menuMock
}))

import type { NativePopupMenuModel } from '@shared/command'
import { IpcChannel } from '@shared/IpcChannel'

import { NativeCommandPopupMenuService } from '../NativeCommandPopupMenuService'

const createModel = (): NativePopupMenuModel => ({
  location: 'chat.input.tools.context',
  items: [
    {
      type: 'command',
      command: 'topic.create',
      label: 'New topic',
      enabled: true,
      shortcutLabel: '⌘N',
      accelerator: 'CommandOrControl+N'
    }
  ]
})

const latestTemplate = () => {
  const calls = menuMock.buildFromTemplate.mock.calls as unknown as [Array<{ click?: () => void }>][]
  return calls.at(-1)?.[0] ?? []
}

describe('NativeCommandPopupMenuService', () => {
  let service: NativeCommandPopupMenuService
  let sender: { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.clearAllMocks()
    commandServiceMock.canExecute.mockReturnValue(false)
    sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }
    service = new NativeCommandPopupMenuService()
    await (service as any).onInit()
  })

  it('builds a native menu from a resolved menu model', () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    handler({ sender }, createModel(), { x: 10, y: 20 })

    expect(menuMock.buildFromTemplate).toHaveBeenCalledWith([
      expect.objectContaining({
        label: 'New topic',
        enabled: true,
        accelerator: 'CommandOrControl+N',
        registerAccelerator: false
      })
    ])
    expect(popupMock).toHaveBeenCalledWith({ window: windowMock, x: 10, y: 20, callback: expect.any(Function) })
  })

  it('returns renderer command clicks to the caller', async () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    const result = handler({ sender }, createModel(), undefined)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'command', command: 'topic.create' })
    expect(sender.send).not.toHaveBeenCalled()
    expect(commandServiceMock.execute).not.toHaveBeenCalled()
  })

  it('executes main command handlers in main when executable', async () => {
    commandServiceMock.canExecute.mockReturnValue(true)
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    const result = handler({ sender }, createModel(), undefined)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toBeUndefined()
    expect(commandServiceMock.execute).toHaveBeenCalledWith('topic.create', windowMock)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('returns disabled commands to the caller instead of silently swallowing them', async () => {
    commandServiceMock.canExecute.mockReturnValue(false)
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    const result = handler({ sender }, createModel(), undefined)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'command', command: 'topic.create' })
    expect(commandServiceMock.execute).not.toHaveBeenCalled()
  })

  it('returns custom menu item clicks to the caller', async () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    const result = handler(
      { sender },
      {
        location: 'chat.input.tools.context',
        items: [{ type: 'custom', id: 'tool:web-search', label: 'Web Search', checked: true }]
      } satisfies NativePopupMenuModel,
      undefined
    )

    const template = latestTemplate()
    expect(template[0]).toEqual(expect.objectContaining({ label: 'Web Search', type: 'checkbox', checked: true }))

    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'custom', id: 'tool:web-search' })
  })

  it('returns custom submenu item clicks to the caller', async () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    const result = handler(
      { sender },
      {
        location: 'topic.context',
        items: [
          {
            type: 'submenu',
            label: 'Copy',
            enabled: true,
            children: [{ type: 'custom', id: 'topic:copy:markdown', label: 'Markdown' }]
          }
        ]
      } satisfies NativePopupMenuModel,
      undefined
    )

    const submenu = (latestTemplate()[0] as any).submenu
    expect(submenu).toEqual([expect.objectContaining({ label: 'Markdown' })])

    submenu[0].click?.()

    await expect(result).resolves.toEqual({ type: 'custom', id: 'topic:copy:markdown' })
  })

  it('rejects invalid menu payloads', () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)
    handler({ sender }, { items: [{ type: 'command', command: 'unknown.command' }] }, undefined)

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
  })

  it('rejects app and tray menu payloads because they are not popup menus', () => {
    const handler = (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)

    handler({ sender }, { ...createModel(), location: 'app.menu' }, undefined)
    handler({ sender }, { ...createModel(), location: 'tray.menu' }, undefined)

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
  })
})
