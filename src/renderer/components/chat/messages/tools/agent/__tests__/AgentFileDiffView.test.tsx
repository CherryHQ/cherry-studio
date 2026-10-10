import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AgentFileDiffView } from '../AgentFileDiffView'

const diffModules = vi.hoisted(() => {
  let resolve: () => void
  const loadingGate = new Promise<void>((resolveGate) => {
    resolve = resolveGate
  })

  return {
    coreEvaluated: vi.fn(),
    reactEvaluated: vi.fn(),
    loadingGate,
    resolve: resolve!
  }
})

vi.mock('@pierre/diffs', async () => {
  diffModules.coreEvaluated()
  await diffModules.loadingGate

  return {
    parseDiffFromFile: vi.fn(() => ({ files: [] }))
  }
})

vi.mock('@pierre/diffs/react', async () => {
  diffModules.reactEvaluated()
  await diffModules.loadingGate

  return {
    FileDiff: () => <div>Rendered diff</div>
  }
})

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    activeShikiTheme: 'github-light',
    isShikiThemeDark: false
  })
}))

describe('AgentFileDiffView lazy boundary', () => {
  it('does not evaluate the diff renderer when imported', () => {
    expect(diffModules.coreEvaluated).not.toHaveBeenCalled()
    expect(diffModules.reactEvaluated).not.toHaveBeenCalled()
  })

  it('keeps children mounted while the diff renderer loads', async () => {
    render(
      <AgentFileDiffView filePath="example.ts" hunks={[{ oldString: 'old', newString: 'new' }]}>
        <span>Tool output</span>
      </AgentFileDiffView>
    )

    const child = screen.getByText('Tool output')
    await waitFor(() => {
      expect(diffModules.coreEvaluated).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('Rendered diff')).not.toBeInTheDocument()

    diffModules.resolve()

    expect(await screen.findByText('Rendered diff')).toBeInTheDocument()
    expect(diffModules.reactEvaluated).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Tool output')).toBe(child)
  })
})
