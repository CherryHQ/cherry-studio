import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ActionTool } from '@renderer/components/ActionTools'
import { useRunTool } from '@renderer/components/CodeToolbar/hooks/useRunTool'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

describe('useRunTool', () => {
  it('runs only while idle and removes the action when disabled', () => {
    const onRun = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled, isRunning }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useRunTool({ enabled, isRunning, onRun, setTools })
        return tools
      },
      { initialProps: { enabled: true, isRunning: false } }
    )

    expect(result.current[0]).toMatchObject({ id: 'run', tooltip: 'code_block.run' })
    act(() => result.current[0].onClick?.())
    expect(onRun).toHaveBeenCalledOnce()

    rerender({ enabled: true, isRunning: true })
    act(() => result.current[0].onClick?.())
    expect(onRun).toHaveBeenCalledOnce()

    rerender({ enabled: false, isRunning: true })
    expect(result.current).toEqual([])
  })
})
