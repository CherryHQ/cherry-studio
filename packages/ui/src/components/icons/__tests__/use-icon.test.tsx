// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IconRef } from '../registry'
import { useIcon } from '../use-icon'

const loaderState = vi.hoisted(() => {
  const pending = new Map<string, { resolve: (icon: unknown) => void; reject: (err: unknown) => void }>()
  const loaded = new Map<string, unknown>()
  // Simulates a catalog that finishes loading between render and effect:
  // the first getLoadedIcon call (render) misses, later calls (effect) hit.
  const lateLoaded = new Map<string, { icon: unknown; calls: number }>()
  return { pending, loaded, lateLoaded }
})

vi.mock('../loader', () => ({
  getLoadedIcon: (ref: { kind: string; key: string }) => {
    const key = `${ref.kind}:${ref.key}`
    const hit = loaderState.loaded.get(key)
    if (hit) return hit
    const late = loaderState.lateLoaded.get(key)
    if (late) {
      late.calls++
      if (late.calls > 1) return late.icon
    }
    return undefined
  },
  loadIcon: (ref: { kind: string; key: string }) =>
    new Promise((resolve, reject) => {
      loaderState.pending.set(`${ref.kind}:${ref.key}`, { resolve, reject })
    })
}))

const providerRef = (key: string): IconRef =>
  ({ kind: 'provider', key, meta: { id: key, colorPrimary: '#000' } }) as IconRef

const OpenaiIcon = { colorPrimary: '#000' } as never
const AnthropicIcon = { colorPrimary: '#111' } as never

async function settle(refKey: string, icon: unknown) {
  await act(async () => {
    loaderState.loaded.set(refKey, icon)
    loaderState.pending.get(refKey)?.resolve(icon)
    loaderState.pending.delete(refKey)
  })
}

beforeEach(() => {
  loaderState.pending.clear()
  loaderState.loaded.clear()
  loaderState.lateLoaded.clear()
})

describe('useIcon', () => {
  it('returns undefined without loading when ref is undefined', () => {
    const { result } = renderHook(() => useIcon(undefined))
    expect(result.current).toBeUndefined()
    expect(loaderState.pending.size).toBe(0)
  })

  it('returns undefined while loading, then the icon once resolved', async () => {
    const { result } = renderHook(() => useIcon(providerRef('openai')))
    expect(result.current).toBeUndefined()
    await settle('provider:openai', OpenaiIcon)
    expect(result.current).toBe(OpenaiIcon)
  })

  it('returns an already-loaded icon synchronously on first render', () => {
    loaderState.loaded.set('provider:openai', OpenaiIcon)
    const { result } = renderHook(() => useIcon(providerRef('openai')))
    expect(result.current).toBe(OpenaiIcon)
    expect(loaderState.pending.size).toBe(0)
  })

  it('does not schedule an extra render when the icon was cached at render time', () => {
    loaderState.loaded.set('provider:openai', OpenaiIcon)
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useIcon(providerRef('openai'))
    })
    expect(result.current).toBe(OpenaiIcon)
    // Render-time cache hits are shown directly — committing them again from
    // the effect would double-render every mounted row in icon-heavy lists.
    expect(renders).toBe(1)
  })

  it('commits a cache hit landing between render and effect (no stuck fallback)', () => {
    // Render-time lookup misses, effect-time lookup hits: without a state
    // commit in the cached branch the fallback would stick until an
    // unrelated re-render.
    loaderState.lateLoaded.set('provider:openai', { icon: OpenaiIcon, calls: 0 })
    const { result } = renderHook(() => useIcon(providerRef('openai')))
    expect(result.current).toBe(OpenaiIcon)
    expect(loaderState.pending.size).toBe(0)
  })

  it('ignores a stale result after a rapid key switch', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useIcon(providerRef(id)), {
      initialProps: { id: 'openai' }
    })
    rerender({ id: 'anthropic' })

    // The first ref resolves late — its result must not surface for the new ref.
    await settle('provider:openai', OpenaiIcon)
    expect(result.current).toBeUndefined()

    await settle('provider:anthropic', AnthropicIcon)
    expect(result.current).toBe(AnthropicIcon)
  })

  it('keeps the previous undefined state when loading fails', async () => {
    const { result } = renderHook(() => useIcon(providerRef('openai')))
    await act(async () => {
      loaderState.pending.get('provider:openai')?.reject(new Error('chunk load failed'))
      loaderState.pending.delete('provider:openai')
    })
    expect(result.current).toBeUndefined()
  })

  it('does not blow up when the component unmounts before the icon resolves', async () => {
    const { unmount } = renderHook(() => useIcon(providerRef('openai')))
    unmount()
    await settle('provider:openai', OpenaiIcon)
  })
})
