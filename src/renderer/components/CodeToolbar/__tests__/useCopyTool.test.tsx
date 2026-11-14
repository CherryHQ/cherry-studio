import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ActionTool } from '@renderer/components/ActionTools'
import { useCopyTool } from '@renderer/components/CodeToolbar/hooks/useCopyTool'
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

function findTool(tools: ActionTool[], id: string) {
  const tool = tools.find((candidate) => candidate.id === id)
  expect(tool).toBeDefined()
  return tool!
}

describe('useCopyTool', () => {
  it('exposes and runs the source-copy action', async () => {
    const onCopySource = vi.fn().mockResolvedValue(true)
    const previewRef = { current: null }
    const { result } = renderHook(() => {
      const [tools, setTools] = useState<ActionTool[]>([])
      useCopyTool({
        showPreviewTools: false,
        previewRef,
        onCopySource,
        setTools
      })
      return tools
    })

    await act(async () => findTool(result.current, 'copy').onClick?.())

    expect(onCopySource).toHaveBeenCalledOnce()
  })

  it('adds an image-copy action backed by the preview handle', async () => {
    const preview = {
      pan: vi.fn(),
      zoom: vi.fn(),
      copy: vi.fn().mockResolvedValue(true),
      download: vi.fn(),
      dialog: vi.fn().mockResolvedValue(undefined)
    } satisfies BasicPreviewHandles
    const previewRef: { current: BasicPreviewHandles | null } = { current: null }
    const onCopySource = vi.fn().mockResolvedValue(true)
    const { result, rerender } = renderHook(
      ({ showPreviewTools }) => {
        const [tools, setTools] = useState<ActionTool[]>([])
        useCopyTool({
          showPreviewTools,
          previewRef,
          onCopySource,
          setTools
        })
        return tools
      },
      { initialProps: { showPreviewTools: true } }
    )

    previewRef.current = preview
    await act(async () => findTool(result.current, 'copy-image').onClick?.())

    expect(preview.copy).toHaveBeenCalledOnce()

    rerender({ showPreviewTools: false })
    expect(result.current.some((tool) => tool.id === 'copy-image')).toBe(false)
  })
})
