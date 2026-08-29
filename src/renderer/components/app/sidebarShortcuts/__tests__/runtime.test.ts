// @vitest-environment jsdom
import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutTarget } from '../../../../utils/sidebar'
import { SidebarShortcutRegistry } from '../registry'
import { resolveSidebarShortcuts, useResolvedSidebarShortcuts } from '../runtime'
import type { ResolvedShortcut, SidebarShortcutProvider } from '../types'

function item(providerId: string, resourceId: string, activationId?: string): SidebarShortcutItem {
  const target = createSidebarShortcutTarget(providerId, resourceId, activationId)
  return { type: 'shortcut', id: `item:${providerId}:${resourceId}`, target, fallbackLabel: resourceId }
}

function resolved(target: SidebarShortcutItem['target'], label: string) {
  return new Map([[createSidebarShortcutId(target), { label, renderIcon: () => null }]])
}

describe('resolveSidebarShortcuts', () => {
  it('batches each provider once and distinguishes missing resources', async () => {
    const resolveMany = vi.fn(
      async (targets) =>
        new Map([
          [
            targets[0]!.locator.resourceId === 'one' ? createSidebarShortcutId(targets[0]) : '',
            { label: 'One', renderIcon: () => null }
          ]
        ])
    )
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: (target) => target.locator.providerId === 'test' && target.activationId === undefined,
      resolveMany,
      activate: vi.fn()
    }
    const shortcuts = [item('test', 'one'), item('test', 'missing')]

    const result = await resolveSidebarShortcuts(shortcuts, new SidebarShortcutRegistry([provider]))

    expect(resolveMany).toHaveBeenCalledTimes(1)
    expect(resolveMany.mock.calls[0][0]).toHaveLength(2)
    expect(result.map((entry) => entry.status)).toEqual(['resolved', 'missing'])
  })

  it('marks request failures, unknown providers, and unknown activations unavailable', async () => {
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: (target) => target.activationId === undefined,
      resolveMany: vi.fn().mockRejectedValue(new Error('offline')),
      activate: vi.fn()
    }

    const result = await resolveSidebarShortcuts(
      [item('test', 'one'), item('unknown', 'two'), item('test', 'three', 'run')],
      new SidebarShortcutRegistry([provider])
    )

    expect(result.map((entry) => entry.status)).toEqual(['unavailable', 'unavailable', 'unavailable'])
    expect(provider.resolveMany).toHaveBeenCalledWith([result[0].shortcut.target])
  })

  it('ignores an obsolete request after the shortcut set changes', async () => {
    const pending = new Map<string, (value: Map<string, ResolvedShortcut>) => void>()
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn(
        (targets) =>
          new Promise<Map<string, ResolvedShortcut>>((resolve) => {
            pending.set(targets[0]!.locator.resourceId, resolve)
          })
      ),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const slow = item('test', 'slow')
    const fast = item('test', 'fast')
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [slow] }
    })

    await waitFor(() => expect(pending.has('slow')).toBe(true))
    rerender({ shortcuts: [fast] })
    await waitFor(() => expect(pending.has('fast')).toBe(true))
    act(() => pending.get('fast')!(resolved(fast.target, 'Fast')))
    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Fast' } }))

    act(() => pending.get('slow')!(resolved(slow.target, 'Slow')))
    await act(async () => Promise.resolve())
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Fast' } })
  })

  it('re-resolves on provider invalidation and releases the subscription', async () => {
    let invalidate = () => {}
    const cleanup = vi.fn()
    const shortcut = item('test', 'one')
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn(async () => resolved(shortcut.target, 'One')),
      subscribe: vi.fn((_targets, nextInvalidate) => {
        invalidate = nextInvalidate
        return cleanup
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const { unmount } = renderHook(() => useResolvedSidebarShortcuts([shortcut], registry))

    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(1))
    act(() => invalidate())
    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(2))
    expect(provider.subscribe).toHaveBeenCalledWith([shortcut.target], expect.any(Function))

    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
