import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock, menuMock, browserWindowMock, popupMock, windowMock } = vi.hoisted(() => {
  const popupMock = vi.fn()
  const windowMock = { id: 1 }
  return {
    loggerMock: { warn: vi.fn(), error: vi.fn() },
    popupMock,
    windowMock,
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

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  Menu: menuMock
}))

import type { NativePopupMenuModel } from '@shared/types/command'
import type { IpcMainInvokeEvent } from 'electron'

import { type ExecuteCommand, showNativePopupMenu } from '../nativePopupMenu'

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

describe('showNativePopupMenu', () => {
  let sender: { send: ReturnType<typeof vi.fn>; isDestroyed: ReturnType<typeof vi.fn> }
  let event: IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
    sender = {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false)
    }
    event = { sender } as unknown as IpcMainInvokeEvent
  })

  const neverExecute: ExecuteCommand = () => false

  it('builds a native menu from a resolved menu model', () => {
    void showNativePopupMenu(event, createModel(), { x: 10, y: 20 }, neverExecute)

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
    const result = showNativePopupMenu(event, createModel(), undefined, neverExecute)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'command', command: 'topic.create' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('executes commands in main when the executeCommand callback handles them', async () => {
    const executeCommand = vi.fn<ExecuteCommand>(() => true)
    const result = showNativePopupMenu(event, createModel(), undefined, executeCommand)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toBeUndefined()
    expect(executeCommand).toHaveBeenCalledWith('topic.create', windowMock)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('returns disabled commands to the caller instead of silently swallowing them', async () => {
    const executeCommand = vi.fn<ExecuteCommand>(() => false)
    const result = showNativePopupMenu(event, createModel(), undefined, executeCommand)

    const template = latestTemplate()
    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'command', command: 'topic.create' })
    expect(executeCommand).toHaveBeenCalledWith('topic.create', windowMock)
  })

  it('returns custom menu item clicks to the caller', async () => {
    const result = showNativePopupMenu(
      event,
      {
        location: 'chat.input.tools.context',
        items: [{ type: 'custom', id: 'tool:web-search', label: 'Web Search', checked: true }]
      } satisfies NativePopupMenuModel,
      undefined,
      neverExecute
    )

    const template = latestTemplate()
    expect(template[0]).toEqual(expect.objectContaining({ label: 'Web Search', type: 'checkbox', checked: true }))

    template[0].click?.()

    await expect(result).resolves.toEqual({ type: 'custom', id: 'tool:web-search' })
  })

  it('returns custom submenu item clicks to the caller', async () => {
    const result = showNativePopupMenu(
      event,
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
      undefined,
      neverExecute
    )

    const submenu = (latestTemplate()[0] as any).submenu
    expect(submenu).toEqual([expect.objectContaining({ label: 'Markdown' })])

    submenu[0].click?.()

    await expect(result).resolves.toEqual({ type: 'custom', id: 'topic:copy:markdown' })
  })

  it('rejects invalid menu payloads', () => {
    void showNativePopupMenu(
      event,
      { items: [{ type: 'command', command: 'unknown.command' }] },
      undefined,
      neverExecute
    )

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('rejects app and tray menu payloads because they are not popup menus', () => {
    void showNativePopupMenu(event, { ...createModel(), location: 'app.menu' }, undefined, neverExecute)
    void showNativePopupMenu(event, { ...createModel(), location: 'tray.menu' }, undefined, neverExecute)

    expect(menuMock.buildFromTemplate).not.toHaveBeenCalled()
  })

  it('settles undefined and logs when building or showing the menu throws', async () => {
    menuMock.buildFromTemplate.mockImplementationOnce(() => {
      throw new Error('build failed')
    })

    const result = showNativePopupMenu(event, createModel(), undefined, neverExecute)

    await expect(result).resolves.toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to show native command popup menu', expect.any(Error))
  })
})
