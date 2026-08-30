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

  it('keeps existing shortcuts resolved while their provider resolves a newly added target', async () => {
    const one = item('test', 'one')
    const two = item('test', 'two')
    let finishUpdate: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn((targets) => {
        if (targets.length === 1) return Promise.resolve(resolved(one.target, 'One'))
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishUpdate = resolve
        })
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [one] }
    })

    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } }))
    rerender({ shortcuts: [one, two] })
    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(2))

    expect(result.current).toMatchObject([{ status: 'resolved', resource: { label: 'One' } }, { status: 'loading' }])

    act(() =>
      finishUpdate(
        new Map([
          [createSidebarShortcutId(one.target), { label: 'One', renderIcon: () => null }],
          [createSidebarShortcutId(two.target), { label: 'Two', renderIcon: () => null }]
        ])
      )
    )
    await waitFor(() => expect(result.current[1]).toMatchObject({ status: 'resolved', resource: { label: 'Two' } }))
  })

  it('only re-resolves the provider whose target set changed', async () => {
    const alpha = item('alpha', 'one')
    const beta = item('beta', 'one')
    const betaTwo = item('beta', 'two')
    let finishBetaUpdate: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    const alphaProvider: SidebarShortcutProvider = {
      id: 'alpha',
      validate: () => true,
      resolveMany: vi.fn(async () => resolved(alpha.target, 'Alpha')),
      activate: vi.fn()
    }
    const betaProvider: SidebarShortcutProvider = {
      id: 'beta',
      validate: () => true,
      resolveMany: vi.fn((targets) => {
        if (targets.length === 1) return Promise.resolve(resolved(beta.target, 'Beta'))
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishBetaUpdate = resolve
        })
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([alphaProvider, betaProvider])
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [alpha, beta] }
    })

    await waitFor(() => expect(result.current.every((entry) => entry.status === 'resolved')).toBe(true))
    rerender({ shortcuts: [alpha, beta, betaTwo] })
    await waitFor(() => expect(betaProvider.resolveMany).toHaveBeenCalledTimes(2))

    expect(alphaProvider.resolveMany).toHaveBeenCalledTimes(1)
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Alpha' } })

    act(() =>
      finishBetaUpdate(
        new Map([
          [createSidebarShortcutId(beta.target), { label: 'Beta', renderIcon: () => null }],
          [createSidebarShortcutId(betaTwo.target), { label: 'Beta Two', renderIcon: () => null }]
        ])
      )
    )
    await waitFor(() => expect(result.current[2]).toMatchObject({ status: 'resolved' }))
  })

  it('keeps stale results visible while provider invalidation re-resolves and releases the subscription', async () => {
    let invalidate = () => {}
    const cleanup = vi.fn()
    const shortcut = item('test', 'one')
    let finishRefresh: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    let isInitialResolution = true
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn(() => {
        if (isInitialResolution) {
          isInitialResolution = false
          return Promise.resolve(resolved(shortcut.target, 'One'))
        }
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishRefresh = resolve
        })
      }),
      subscribe: vi.fn((_targets, nextInvalidate) => {
        invalidate = nextInvalidate
        return cleanup
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const { result, unmount } = renderHook(() => useResolvedSidebarShortcuts([shortcut], registry))

    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } }))
    act(() => invalidate())
    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(2))
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } })

    act(() => finishRefresh(resolved(shortcut.target, 'Updated')))
    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Updated' } }))
    expect(provider.subscribe).toHaveBeenCalledWith([shortcut.target], expect.any(Function))

    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
