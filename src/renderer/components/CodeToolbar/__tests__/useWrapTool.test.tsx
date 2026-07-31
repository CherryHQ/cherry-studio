import type { ActionTool } from '@renderer/components/ActionTools'
import { useWrapTool } from '@renderer/components/CodeToolbar/hooks/useWrapTool'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

describe('useWrapTool', () => {
  it('tracks availability and wrapping state while invoking the toggle action', () => {
    const toggle = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled, wrapped, wrappable }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useWrapTool({ enabled, wrapped, wrappable, toggle, setTools })
        return tools
      },
      { initialProps: { enabled: true, wrapped: false, wrappable: true } }
    )

    expect(result.current[0]).toMatchObject({ id: 'wrap', tooltip: 'code_block.wrap.on' })
    expect(result.current[0].visible?.()).toBe(true)
    act(() => result.current[0].onClick?.())
    expect(toggle).toHaveBeenCalledOnce()

    rerender({ enabled: true, wrapped: true, wrappable: false })
    expect(result.current[0]).toMatchObject({ id: 'wrap', tooltip: 'code_block.wrap.off' })
    expect(result.current[0].visible?.()).toBe(false)

    rerender({ enabled: false, wrapped: true, wrappable: false })
    expect(result.current).toEqual([])
  })
})
