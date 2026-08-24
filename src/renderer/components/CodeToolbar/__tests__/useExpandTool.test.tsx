import type { ActionTool } from '@renderer/components/ActionTools'
import { useExpandTool } from '@renderer/components/CodeToolbar/hooks/useExpandTool'
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

describe('useExpandTool', () => {
  it('tracks availability and expansion state while invoking the toggle action', () => {
    const toggle = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled, expanded, expandable }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useExpandTool({ enabled, expanded, expandable, toggle, setTools })
        return tools
      },
      { initialProps: { enabled: true, expanded: false, expandable: true } }
    )

    expect(result.current[0]).toMatchObject({ id: 'expand', tooltip: 'code_block.expand' })
    expect(result.current[0].visible?.()).toBe(true)
    act(() => result.current[0].onClick?.())
    expect(toggle).toHaveBeenCalledOnce()

    rerender({ enabled: true, expanded: true, expandable: false })
    expect(result.current[0]).toMatchObject({ id: 'expand', tooltip: 'code_block.collapse' })
    expect(result.current[0].visible?.()).toBe(false)

    rerender({ enabled: false, expanded: true, expandable: false })
    expect(result.current).toEqual([])
  })
})
