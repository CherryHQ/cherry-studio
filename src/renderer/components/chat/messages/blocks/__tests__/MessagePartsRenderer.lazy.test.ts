import { describe, expect, it, vi } from 'vitest'

const toolRendererRegistryEvaluated = vi.hoisted(() => vi.fn())

vi.mock('../../tools/agent/toolRendererRegistry', () => {
  toolRendererRegistryEvaluated()
  return {
    isValidAgentToolsType: () => false,
    renderTool: () => ({ key: 'tool', label: null }),
    toolRenderers: {}
  }
})

describe('MessagePartsRenderer lazy Agent tool boundary', () => {
  it('does not evaluate the Agent renderer registry from the ordinary chat import graph', async () => {
    await import('../MessagePartsRenderer')

    expect(toolRendererRegistryEvaluated).not.toHaveBeenCalled()
  })

  it('detects the registry when the lazy implementation is explicitly loaded', async () => {
    await import('../../tools/agent/toolRendererRegistry')

    expect(toolRendererRegistryEvaluated).toHaveBeenCalledTimes(1)
  })
})
