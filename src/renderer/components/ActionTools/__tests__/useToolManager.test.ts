import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { ActionTool } from '@renderer/components/ActionTools'
import { useToolManager } from '@renderer/components/ActionTools'

const createTool = (id: string, order: number, tooltip = id): ActionTool => ({
  id,
  type: 'core',
  order,
  icon: 'TestIcon',
  tooltip
})

describe('useToolManager', () => {
  it('replaces duplicate tools and keeps the registered tools ordered', () => {
    const { result } = renderHook(() => {
      const [tools, setTools] = useState<ActionTool[]>([])
      const { registerTool } = useToolManager(setTools)
      return { tools, registerTool }
    })

    act(() => {
      result.current.registerTool(createTool('low', 10))
      result.current.registerTool(createTool('high', 30, 'Original'))
      result.current.registerTool(createTool('middle', 20))
      result.current.registerTool(createTool('high', 40, 'Updated'))
    })

    expect(result.current.tools.map(({ id, order, tooltip }) => ({ id, order, tooltip }))).toEqual([
      { id: 'high', order: 40, tooltip: 'Updated' },
      { id: 'middle', order: 20, tooltip: 'middle' },
      { id: 'low', order: 10, tooltip: 'low' }
    ])
  })

  it('removes only the requested tool', () => {
    const { result } = renderHook(() => {
      const [tools, setTools] = useState<ActionTool[]>([
        createTool('first', 30),
        createTool('second', 20),
        createTool('third', 10)
      ])
      const { removeTool } = useToolManager(setTools)
      return { tools, removeTool }
    })

    act(() => {
      result.current.removeTool('second')
    })

    expect(result.current.tools.map((tool) => tool.id)).toEqual(['first', 'third'])
  })
})
