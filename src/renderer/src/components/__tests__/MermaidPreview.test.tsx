import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import MermaidPreview from '../CodeBlockView/MermaidPreview'

const mocks = vi.hoisted(() => ({
  useMermaid: vi.fn(),
  usePreviewToolHandlers: vi.fn(),
  usePreviewTools: vi.fn()
}))

// Mock hooks
vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: () => mocks.useMermaid()
}))

vi.mock('@renderer/components/CodeToolbar', () => ({
  usePreviewToolHandlers: () => mocks.usePreviewToolHandlers(),
  usePreviewTools: () => mocks.usePreviewTools()
}))

// Mock nanoid
vi.mock('@reduxjs/toolkit', () => ({
  nanoid: () => 'test-id-123456'
}))

// Mock lodash debounce
vi.mock('lodash', async () => {
  const actual = await import('lodash')
  return {
    ...actual,
    debounce: vi.fn((fn) => {
      const debounced = (...args: any[]) => fn(...args)
      debounced.cancel = vi.fn()
      return debounced
    })
  }
})

// Mock antd components
vi.mock('antd', () => ({
  Flex: ({ children, vertical, ...props }: any) => (
    <div data-testid="flex" data-vertical={vertical} {...props}>
      {children}
    </div>
  ),
  Spin: ({ children, spinning, indicator }: any) => (
    <div data-testid="spin" data-spinning={spinning}>
      {spinning && indicator}
      {children}
    </div>
  )
}))

describe('MermaidPreview', () => {
  const mockMermaid = {
    parse: vi.fn(),
    render: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.useMermaid.mockReturnValue({
      mermaid: mockMermaid,
      isLoading: false,
      error: null
    })

    mocks.usePreviewToolHandlers.mockReturnValue({
      handleZoom: vi.fn(),
      handleCopyImage: vi.fn(),
      handleDownload: vi.fn()
    })

    mocks.usePreviewTools.mockReturnValue({})

    mockMermaid.parse.mockResolvedValue(true)
    mockMermaid.render.mockResolvedValue({
      svg: '<svg class="flowchart" viewBox="0 0 100 100"><g>test diagram</g></svg>'
    })

    // Mock MutationObserver
    global.MutationObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn()
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('visibility detection', () => {
    it('should not render mermaid when element has display: none', async () => {
      const mermaidCode = 'graph TD\nA-->B'

      const { container } = render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      // Mock offsetParent to be null (simulating display: none)
      const mermaidElement = container.querySelector('.mermaid')
      if (mermaidElement) {
        Object.defineProperty(mermaidElement, 'offsetParent', {
          get: () => null,
          configurable: true
        })
      }

      // Re-render to trigger the effect
      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      // Should not call mermaid render when offsetParent is null
      expect(mockMermaid.render).not.toHaveBeenCalled()

      const svgElement = mermaidElement?.querySelector('svg.flowchart')
      expect(svgElement).not.toBeInTheDocument()
    })

    it('should setup MutationObserver to monitor parent elements', () => {
      const mermaidCode = 'graph TD\nA-->B'

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      expect(global.MutationObserver).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should observe parent elements up to fold className', () => {
      const mermaidCode = 'graph TD\nA-->B'

      // Create a DOM structure that simulates MessageGroup fold layout
      const foldContainer = document.createElement('div')
      foldContainer.className = 'fold selected'

      const messageWrapper = document.createElement('div')
      messageWrapper.className = 'message-wrapper'

      const codeBlock = document.createElement('div')
      codeBlock.className = 'code-block'

      foldContainer.appendChild(messageWrapper)
      messageWrapper.appendChild(codeBlock)
      document.body.appendChild(foldContainer)

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>, {
        container: codeBlock
      })

      const observerInstance = (global.MutationObserver as Mock).mock.results[0]?.value
      expect(observerInstance.observe).toHaveBeenCalled()

      // Cleanup
      document.body.removeChild(foldContainer)
    })

    it('should trigger re-render when visibility changes from hidden to visible', async () => {
      const mermaidCode = 'graph TD\nA-->B'

      const { container, rerender } = render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      const mermaidElement = container.querySelector('.mermaid')

      // Initially hidden (offsetParent is null)
      Object.defineProperty(mermaidElement, 'offsetParent', {
        get: () => null,
        configurable: true
      })

      // Clear previous calls
      mockMermaid.render.mockClear()

      // Re-render with hidden state
      rerender(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      // Should not render when hidden
      expect(mockMermaid.render).not.toHaveBeenCalled()

      // Now make it visible
      Object.defineProperty(mermaidElement, 'offsetParent', {
        get: () => document.body,
        configurable: true
      })

      // Simulate MutationObserver callback
      const observerCallback = (global.MutationObserver as Mock).mock.calls[0][0]
      act(() => {
        observerCallback([])
      })

      // Re-render to trigger visibility change effect
      rerender(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      await waitFor(() => {
        expect(mockMermaid.render).toHaveBeenCalledWith('mermaid-test-id-123456', mermaidCode, expect.any(Object))

        const svgElement = mermaidElement?.querySelector('svg.flowchart')
        expect(svgElement).toBeInTheDocument()
        expect(svgElement).toHaveClass('flowchart')
      })
    })

    it('should handle mermaid loading state', () => {
      mocks.useMermaid.mockReturnValue({
        mermaid: mockMermaid,
        isLoading: true,
        error: null
      })

      const mermaidCode = 'graph TD\nA-->B'

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      // Should not render when mermaid is loading
      expect(mockMermaid.render).not.toHaveBeenCalled()

      // Should show loading state
      expect(screen.getByTestId('spin')).toHaveAttribute('data-spinning', 'true')
    })
  })
})
