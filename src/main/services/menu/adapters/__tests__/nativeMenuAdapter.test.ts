import type { ResolvedMenuItem } from '@shared/types/command'
import type { CommandId } from '@shared/utils/command'
import { describe, expect, it, vi } from 'vitest'

import { toElectronMenuTemplate } from '../nativeMenuAdapter'

describe('toElectronMenuTemplate', () => {
  it('maps command items to Electron menu options', () => {
    const executeCommand = vi.fn()
    const template = toElectronMenuTemplate(
      [
        {
          type: 'command',
          command: 'topic.create',
          label: 'New topic',
          enabled: true,
          shortcutLabel: '⌘N',
          accelerator: 'CommandOrControl+N'
        }
      ],
      { registerAccelerator: false, executeCommand }
    )

    expect(template[0]).toEqual(
      expect.objectContaining({
        label: 'New topic',
        enabled: true,
        type: 'normal',
        accelerator: 'CommandOrControl+N',
        registerAccelerator: false
      })
    )

    const menuItem = {} as never
    const browserWindow = {} as never
    const event = {} as never
    template[0].click?.(menuItem, browserWindow, event)
    expect(executeCommand).toHaveBeenCalledWith('topic.create', { menuItem, browserWindow, event })
  })

  it('preserves separators, checkbox state, roles, custom items, and nested submenus', () => {
    const customClick = vi.fn()
    const items: ResolvedMenuItem<CommandId>[] = [
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Topic',
        enabled: true,
        children: [
          {
            type: 'command',
            command: 'topic.rename',
            label: 'Rename topic',
            enabled: false,
            checked: true,
            shortcutLabel: ''
          }
        ]
      }
    ]
    const nativeItems = [
      ...items,
      { type: 'role', role: 'quit', label: 'Quit Cherry Studio' },
      { type: 'custom', label: 'Website', click: customClick }
    ] as const

    const template = toElectronMenuTemplate(nativeItems, { executeCommand: vi.fn() })

    expect(template[0]).toEqual({ type: 'separator' })
    expect(template[1]).toEqual(
      expect.objectContaining({
        label: 'Topic',
        enabled: true,
        submenu: [
          expect.objectContaining({
            label: 'Rename topic',
            enabled: false,
            type: 'checkbox',
            checked: true
          })
        ]
      })
    )
    expect((template[1] as { submenu: Array<{ registerAccelerator?: boolean }> }).submenu[0].registerAccelerator).toBe(
      undefined
    )
    expect(template[2]).toEqual(expect.objectContaining({ role: 'quit', label: 'Quit Cherry Studio' }))

    template[3].click?.({} as never, {} as never, {} as never)
    expect(customClick).toHaveBeenCalledTimes(1)
  })
})
