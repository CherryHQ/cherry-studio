import { describe, expect, it } from 'vitest'

import { MenuRegistry, menuRegistry, resolveMenuPresentationMode } from '../menus'

describe('MenuRegistry', () => {
  it('resolves contributions by location and context', () => {
    const registry = new MenuRegistry([
      { location: 'chat.input.toolbar', command: 'topic.create', group: 'topic', order: 10, when: 'chat.active' },
      {
        location: 'chat.input.toolbar',
        command: 'chat.message.search',
        group: 'chat',
        order: 10,
        when: '!chat.generating'
      },
      { location: 'topic.context', command: 'topic.rename', group: 'topic', order: 10 }
    ])

    const model = registry.resolve({
      location: 'chat.input.toolbar',
      context: { 'chat.active': true, 'chat.generating': false },
      getCommandState: (command) => ({
        label: command,
        enabled: true,
        shortcutLabel: command === 'topic.create' ? '⌘N' : ''
      })
    })

    expect(model.items).toEqual([
      {
        type: 'command',
        command: 'chat.message.search',
        label: 'chat.message.search',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '',
        accelerator: undefined
      },
      { type: 'separator' },
      {
        type: 'command',
        command: 'topic.create',
        label: 'topic.create',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '⌘N',
        accelerator: undefined
      }
    ])
  })

  it('rejects unknown command ids during registration', () => {
    const registry = new MenuRegistry()
    expect(() =>
      registry.register({
        location: 'chat.input.toolbar',
        command: 'unknown.command' as never,
        group: 'bad',
        order: 1
      })
    ).toThrow('unknown command')
  })

  it('resolves app menu command contributions through the shared registry', () => {
    const model = menuRegistry.resolve({
      location: 'app.menu',
      context: {},
      getCommandState: (command) => ({
        label: `label:${command}`,
        enabled: true,
        shortcutLabel: '',
        accelerator: `accelerator:${command}`
      })
    })

    expect(model.items).toEqual([
      {
        type: 'command',
        command: 'app.settings.open',
        label: 'label:app.settings.open',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '',
        accelerator: 'accelerator:app.settings.open'
      },
      { type: 'separator' },
      {
        type: 'command',
        command: 'app.zoom.reset',
        label: 'label:app.zoom.reset',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '',
        accelerator: 'accelerator:app.zoom.reset'
      },
      {
        type: 'command',
        command: 'app.zoom.in',
        label: 'label:app.zoom.in',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '',
        accelerator: 'accelerator:app.zoom.in'
      },
      {
        type: 'command',
        command: 'app.zoom.out',
        label: 'label:app.zoom.out',
        enabled: true,
        checked: undefined,
        destructive: undefined,
        iconKey: undefined,
        shortcutLabel: '',
        accelerator: 'accelerator:app.zoom.out'
      }
    ])
  })
})

describe('resolveMenuPresentationMode', () => {
  it('keeps app and tray menus native', () => {
    expect(resolveMenuPresentationMode('app.menu', 'cherry')).toBe('native')
    expect(resolveMenuPresentationMode('tray.menu', 'cherry')).toBe('native')
  })

  it('uses the preferred mode for renderer menu locations', () => {
    expect(resolveMenuPresentationMode('chat.input.tools.context', 'native')).toBe('native')
    expect(resolveMenuPresentationMode('chat.input.tools.context', 'cherry')).toBe('cherry')
  })
})
