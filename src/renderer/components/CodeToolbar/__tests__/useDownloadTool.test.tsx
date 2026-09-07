import type { ActionTool } from '@renderer/components/ActionTools'
import { useDownloadTool } from '@renderer/components/CodeToolbar/hooks/useDownloadTool'
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'
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

describe('useDownloadTool', () => {
  it('runs source download directly when preview actions are hidden', () => {
    const onDownloadSource = vi.fn()
    const previewRef = { current: null }
    const { result } = renderHook(() => {
      const [tools, setTools] = useState<ActionTool[]>([])
      useDownloadTool({
        showPreviewTools: false,
        previewRef,
        onDownloadSource,
        setTools
      })
      return tools
    })

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ id: 'download' })
    expect(result.current[0].children).toBeUndefined()
    act(() => result.current[0].onClick?.())

    expect(onDownloadSource).toHaveBeenCalledOnce()
  })

  it('offers source, SVG, and PNG downloads through the preview menu', () => {
    const onDownloadSource = vi.fn()
    const preview = {
      pan: vi.fn(),
      zoom: vi.fn(),
      copy: vi.fn().mockResolvedValue(true),
      download: vi.fn()
    } satisfies BasicPreviewHandles
    const previewRef: { current: BasicPreviewHandles | null } = { current: null }
    const { result } = renderHook(() => {
      const [tools, setTools] = useState<ActionTool[]>([])
      useDownloadTool({
        showPreviewTools: true,
        previewRef,
        onDownloadSource,
        setTools
      })
      return tools
    })
    const children = result.current[0].children ?? []

    expect(children.map((tool) => tool.id)).toEqual(['download', 'download-svg', 'download-png'])
    previewRef.current = preview
    act(() => {
      children.forEach((tool) => tool.onClick?.())
    })

    expect(onDownloadSource).toHaveBeenCalledOnce()
    expect(preview.download.mock.calls).toEqual([['svg'], ['png']])
  })
})
