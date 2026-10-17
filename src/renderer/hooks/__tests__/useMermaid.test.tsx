import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initialize: vi.fn()
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: mocks.initialize
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

import { useMermaid } from '@renderer/hooks/useMermaid'

describe('useMermaid', () => {
  it('uses SVG-native labels for canvas-safe diagram exports', async () => {
    renderHook(() => useMermaid())

    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled())

    expect(mocks.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'default',
      htmlLabels: false
    })
  })
})
