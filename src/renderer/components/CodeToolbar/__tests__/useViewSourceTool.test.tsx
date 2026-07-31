import type { ActionTool } from '@renderer/components/ActionTools'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { useViewSourceTool } from '@renderer/components/CodeToolbar/hooks/useViewSourceTool'
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

describe('useViewSourceTool', () => {
  it('switches view modes and exposes the action appropriate to editability', () => {
    const onViewModeChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ editable, enabled, viewMode }: { editable: boolean; enabled: boolean; viewMode: ViewMode }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useViewSourceTool({ enabled, editable, viewMode, onViewModeChange, setTools })
        return tools
      },
      { initialProps: { editable: false, enabled: true, viewMode: 'special' } }
    )

    expect(result.current[0]).toMatchObject({ id: 'view-source', tooltip: 'preview.source' })
    act(() => result.current[0].onClick?.())
    expect(onViewModeChange).toHaveBeenLastCalledWith('source')

    rerender({ editable: false, enabled: true, viewMode: 'source' })
    expect(result.current[0]).toMatchObject({ id: 'view-source', tooltip: 'preview.label' })
    act(() => result.current[0].onClick?.())
    expect(onViewModeChange).toHaveBeenLastCalledWith('special')

    rerender({ editable: true, enabled: true, viewMode: 'special' })
    expect(result.current.map((tool) => tool.id)).toEqual(['edit'])

    rerender({ editable: true, enabled: false, viewMode: 'special' })
    expect(result.current).toEqual([])

    rerender({ editable: true, enabled: true, viewMode: 'split' })
    expect(result.current).toEqual([])
  })
})
