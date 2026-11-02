import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import type { ExternalOpenTarget } from '@shared/types/externalApp'

import { buildOpenTargetMenuItems, getOpenTargetLabel } from '../openTargetPresentation'

const t = ((key: string) => key) as TFunction

describe('getOpenTargetLabel', () => {
  it('uses the resolved application name for a system-default target', () => {
    const target: ExternalOpenTarget = {
      id: 'system_default',
      name: 'System Handler',
      kind: 'system_default'
    }

    expect(getOpenTargetLabel(target, t)).toBe('System Handler')
  })
})

describe('buildOpenTargetMenuItems', () => {
  const targets: ExternalOpenTarget[] = [
    { id: 'vscode', kind: 'application', name: 'VS Code' },
    { id: 'file_manager', kind: 'file_manager' },
    { id: 'system_default', kind: 'system_default', name: 'Preview' },
    { id: 'terminal', kind: 'terminal', name: 'Warp' }
  ]

  it('exposes the default app and the file manager, and groups every other target under Open with', () => {
    const onOpen = vi.fn()
    const items = buildOpenTargetMenuItems({ targets, onOpen, t })

    expect(items.map((item) => item.type !== 'separator' && item.id)).toEqual([
      'external-open-target.system_default',
      'external-open-target.file_manager',
      'external-open-target.open-with'
    ])
    const openWith = items[2]
    if (openWith?.type !== 'submenu') throw new Error('Expected the Open with submenu')
    expect(openWith.children.map((item) => item.type !== 'separator' && item.id)).toEqual([
      'external-open-target.vscode',
      'external-open-target.terminal'
    ])

    const defaultApp = items[0]
    if (defaultApp?.type !== 'item') throw new Error('Expected the default app item')
    defaultApp.onSelect()
    expect(onOpen).toHaveBeenCalledWith(targets[2])
  })

  it('omits Open with when only the default app and the file manager exist', () => {
    const items = buildOpenTargetMenuItems({ targets: [targets[1], targets[2]], onOpen: vi.fn(), t })
    expect(items.map((item) => item.type !== 'separator' && item.id)).toEqual([
      'external-open-target.system_default',
      'external-open-target.file_manager'
    ])
  })
})
