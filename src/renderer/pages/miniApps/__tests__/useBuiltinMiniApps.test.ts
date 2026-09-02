import type * as MiniAppPresets from '@shared/data/presets/miniApps'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useBuiltinMiniApps } from '../useBuiltinMiniApps'

const mocks = vi.hoisted(() => ({ resourcesPath: '/opt/cherry/resources' }))

vi.mock('@data/hooks/useCache', () => ({ useCache: () => [mocks.resourcesPath] }))

/*
 * A NON-EMPTY catalog on purpose. The shipped array is empty this release, so a test
 * written against the real one asserts nothing — it would stay green with the entire
 * filter deleted. The empty-catalog case is the CI catalog test's job, not this one's.
 */
vi.mock('@shared/data/presets/miniApps', async (importOriginal) => ({
  ...(await importOriginal<typeof MiniAppPresets>()),
  BUILTIN_MINI_APPS: [
    { appId: 'com.cherrystudio.miniapp.notes', name: { en: 'Notes', 'zh-CN': '笔记' }, icon: 'icon.webp' },
    { appId: 'com.cherrystudio.miniapp.draw', name: { en: 'Draw' }, icon: 'icon.webp' }
  ]
}))

describe('useBuiltinMiniApps', () => {
  it('offers only the builtins that are not installed yet', () => {
    const { result } = renderHook(() =>
      useBuiltinMiniApps([{ presetMiniAppId: 'com.cherrystudio.miniapp.draw' }], 'zh-CN')
    )

    expect(result.current.map((e) => e.appId)).toEqual(['com.cherrystudio.miniapp.notes'])
    expect(result.current[0].name).toBe('笔记')
  })

  it('re-resolves names when the interface language changes', () => {
    // Kills the memo-deps mutant: drop `language` from the deps array and only this fails.
    const { result, rerender } = renderHook(({ lang }) => useBuiltinMiniApps([], lang), {
      initialProps: { lang: 'en' }
    })
    expect(result.current[0].name).toBe('Notes')

    rerender({ lang: 'zh-CN' })

    expect(result.current[0].name).toBe('笔记')
  })

  it('cannot be silenced by a sideloaded app claiming the same id', () => {
    // `presetMiniAppId` is NULL for everything the user installed themselves, so no
    // package a user can produce can suppress an official offer by claiming its id.
    const { result } = renderHook(() =>
      useBuiltinMiniApps([{ presetMiniAppId: null }, { presetMiniAppId: null }], 'en')
    )

    expect(result.current).toHaveLength(2)
  })

  it('resolves the icon under the shipped resources directory', () => {
    const { result } = renderHook(() => useBuiltinMiniApps([], 'en'))

    // `resources/` has no URL of its own from the renderer, and the per-app
    // `cherry-miniapp://` origin does not exist until the app is installed (§10.4).
    expect(result.current[0].iconUrl).toBe(
      'file:///opt/cherry/resources/builtin-mini-apps/com.cherrystudio.miniapp.notes/icon.webp'
    )
  })

  it('offers nothing until the resources path is known', () => {
    // Filled by `useWindowRuntime` at startup; the first frame can run before it lands.
    mocks.resourcesPath = ''
    try {
      expect(renderHook(() => useBuiltinMiniApps([], 'en')).result.current).toEqual([])
    } finally {
      mocks.resourcesPath = '/opt/cherry/resources'
    }
    // Positive control: the empty result above is the missing path, not a dead filter.
    expect(renderHook(() => useBuiltinMiniApps([], 'en')).result.current).toHaveLength(2)
  })
})
