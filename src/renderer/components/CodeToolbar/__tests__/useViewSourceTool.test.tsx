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

interface HookProps {
  canEdit: boolean
  hasSpecialView: boolean
  isStreaming: boolean
  viewMode: ViewMode
}

describe('useViewSourceTool', () => {
  it('keeps source available while a special preview is streaming', () => {
    const onViewModeChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ canEdit, hasSpecialView, isStreaming, viewMode }: HookProps) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useViewSourceTool({
          canEdit,
          hasSpecialView,
          isStreaming,
          viewMode,
          onViewModeChange,
          setTools
        })
        return tools
      },
      { initialProps: { canEdit: true, hasSpecialView: true, isStreaming: true, viewMode: 'special' } }
    )

    expect(result.current[0]).toMatchObject({ id: 'view-source', tooltip: 'preview.source' })
    act(() => result.current[0].onClick?.())
    expect(onViewModeChange).toHaveBeenLastCalledWith('source')

    rerender({ canEdit: true, hasSpecialView: true, isStreaming: true, viewMode: 'source' })
    expect(result.current[0]).toMatchObject({ id: 'view-source', tooltip: 'preview.label' })

    rerender({ canEdit: true, hasSpecialView: true, isStreaming: false, viewMode: 'source' })
    expect(result.current[0]).toMatchObject({ id: 'edit', tooltip: 'code_block.edit.label' })
    act(() => result.current[0].onClick?.())
    expect(onViewModeChange).toHaveBeenLastCalledWith('edit')
  })

  it('offers edit only when a settled source can enter edit mode', () => {
    const onViewModeChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ canEdit, hasSpecialView, isStreaming, viewMode }: HookProps) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useViewSourceTool({
          canEdit,
          hasSpecialView,
          isStreaming,
          viewMode,
          onViewModeChange,
          setTools
        })
        return tools
      },
      { initialProps: { canEdit: true, hasSpecialView: false, isStreaming: false, viewMode: 'source' } }
    )

    expect(result.current[0]).toMatchObject({ id: 'edit', tooltip: 'code_block.edit.label' })

    rerender({ canEdit: true, hasSpecialView: false, isStreaming: false, viewMode: 'edit' })
    expect(result.current).toEqual([])

    rerender({ canEdit: true, hasSpecialView: true, isStreaming: false, viewMode: 'edit' })
    expect(result.current[0]).toMatchObject({ id: 'edit', tooltip: 'preview.label' })
    act(() => result.current[0].onClick?.())
    expect(onViewModeChange).toHaveBeenLastCalledWith('special')

    rerender({ canEdit: true, hasSpecialView: true, isStreaming: false, viewMode: 'split' })
    expect(result.current).toEqual([])
  })
})
