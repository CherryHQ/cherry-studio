import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ActionTool } from '@renderer/components/ActionTools'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useSplitViewTool } from '@renderer/components/CodeToolbar/hooks/useSplitViewTool'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

describe('useSplitViewTool', () => {
  it('toggles split view and updates the action for the active mode', () => {
    const onToggleSplitView = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled, viewMode }: { enabled: boolean; viewMode: ViewMode }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useSplitViewTool({ enabled, viewMode, onToggleSplitView, setTools })
        return tools
      },
      { initialProps: { enabled: true, viewMode: 'special' } }
    )

    act(() => result.current[0].onClick?.())
    expect(onToggleSplitView).toHaveBeenCalledOnce()

    rerender({ enabled: true, viewMode: 'split' })

    rerender({ enabled: false, viewMode: 'split' })
    expect(result.current).toEqual([])
  })
})
