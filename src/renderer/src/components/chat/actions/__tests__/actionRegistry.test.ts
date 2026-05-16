import { describe, expect, it, vi } from 'vitest'

import { createActionRegistry, createMessageActionRegistry } from '../actionRegistry'

interface TestContext {
  enabled?: boolean
  hidden?: boolean
  run: (value: string) => void
}

describe('ActionRegistry', () => {
  it('registers, resolves, and executes actions through commands', async () => {
    const registry = createActionRegistry<TestContext>()
    const run = vi.fn()

    registry.registerCommand({
      id: 'copy',
      run: (context) => context.run('copy')
    })
    registry.registerAction({
      id: 'copy-action',
      commandId: 'copy',
      label: 'Copy',
      order: 10,
      surface: 'menu'
    })

    expect(registry.resolve({ run }, 'menu')).toMatchObject([
      {
        id: 'copy-action',
        commandId: 'copy',
        label: 'Copy',
        availability: { visible: true, enabled: true }
      }
    ])

    await expect(registry.execute('copy-action', { run })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('copy')
  })

  it('keeps duplicate-id override stable when old registrations are disposed', () => {
    const registry = createActionRegistry<TestContext>()
    const run = vi.fn()

    const disposeOld = registry.registerAction({ id: 'item', label: 'Old' })
    const disposeNew = registry.registerAction({ id: 'item', label: 'New' })

    expect(registry.resolve({ run })[0]?.label).toBe('New')

    disposeOld()
    expect(registry.resolve({ run })[0]?.label).toBe('New')

    disposeNew()
    expect(registry.resolve({ run })).toEqual([])
  })

  it('combines action and command availability', async () => {
    const registry = createActionRegistry<TestContext>()
    const run = vi.fn()

    registry.registerCommand({
      id: 'command',
      availability: ({ enabled }) => ({ enabled, reason: enabled ? undefined : 'Disabled' }),
      run: ({ run }) => run('command')
    })
    registry.registerAction({
      id: 'visible-disabled',
      commandId: 'command',
      label: 'Visible disabled'
    })
    registry.registerAction({
      id: 'hidden',
      commandId: 'command',
      label: 'Hidden',
      availability: ({ hidden }) => ({ visible: !hidden })
    })

    const disabled = registry.resolve({ enabled: false, hidden: true, run })

    expect(disabled).toMatchObject([
      {
        id: 'visible-disabled',
        availability: { visible: true, enabled: false, reason: 'Disabled' }
      }
    ])
    await expect(registry.execute('visible-disabled', { enabled: false, run })).resolves.toBe(false)
  })

  it('resolves nested actions by surface and preserves confirm metadata', async () => {
    const registry = createActionRegistry<TestContext>()
    const run = vi.fn()

    registry.registerCommand({
      id: 'left',
      run: ({ run }) => run('left')
    })
    registry.registerAction({
      id: 'position',
      label: 'Position',
      surface: 'menu',
      children: [
        {
          id: 'position-left',
          commandId: 'left',
          label: 'Left',
          order: 20,
          surface: 'menu',
          confirm: {
            title: 'Move left',
            confirmText: 'Move',
            destructive: true
          }
        },
        {
          id: 'position-toolbar',
          commandId: 'left',
          label: 'Toolbar only',
          surface: 'toolbar'
        }
      ]
    })

    const resolved = registry.resolve({ run }, 'menu')

    expect(resolved[0]?.children).toMatchObject([
      {
        id: 'position-left',
        confirm: {
          title: 'Move left',
          confirmText: 'Move',
          destructive: true
        }
      }
    ])
    await expect(registry.execute('position-left', { run })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('left')
  })
})

describe('MessageActionRegistry', () => {
  it('keeps provider registration behavior while supporting generic actions', async () => {
    const registry = createMessageActionRegistry()
    const run = vi.fn()
    const message = {
      id: 'message-1',
      role: 'assistant',
      topicId: 'topic-1',
      status: 'success',
      createdAt: '2026-01-01T00:00:00.000Z'
    } as const

    registry.register({
      id: 'provider',
      resolve: ({ message }) => [{ id: `provider:${message.id}`, label: 'Provider action' }]
    })
    registry.registerCommand({
      id: 'copy',
      run: () => run('copy')
    })
    registry.registerAction({
      id: 'copy-action',
      commandId: 'copy',
      label: 'Copy'
    })

    expect(registry.resolve({ message })).toMatchObject([
      { id: 'provider:message-1', label: 'Provider action' },
      { id: 'copy-action', label: 'Copy' }
    ])
    await expect(registry.execute('copy-action', { message })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('copy')

    registry.unregister('copy-action')
    expect(registry.resolve({ message })).toMatchObject([{ id: 'provider:message-1', label: 'Provider action' }])
  })
})
