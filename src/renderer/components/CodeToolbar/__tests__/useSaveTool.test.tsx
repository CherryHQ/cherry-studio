import type { CodeEditorHandles } from '@cherrystudio/ui'
import type { ActionTool } from '@renderer/components/ActionTools'
import { useSaveTool } from '@renderer/components/CodeToolbar/hooks/useSaveTool'
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

describe('useSaveTool', () => {
  it('saves through the editor handle and removes the action when disabled', () => {
    const save = vi.fn()
    const sourceViewRef = { current: { save } as CodeEditorHandles }
    const { result, rerender } = renderHook(
      ({ enabled }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useSaveTool({ enabled, sourceViewRef, setTools })
        return tools
      },
      { initialProps: { enabled: true } }
    )

    expect(result.current[0]).toMatchObject({ id: 'save', tooltip: 'code_block.edit.save.label' })
    act(() => result.current[0].onClick?.())
    expect(save).toHaveBeenCalledOnce()

    rerender({ enabled: false })
    expect(result.current).toEqual([])
  })
})
