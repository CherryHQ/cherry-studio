import { configureStore } from '@reduxjs/toolkit'
import type { Model } from '@renderer/types'
import { WebSearchSource } from '@renderer/types'
import type { MainTextMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MainTextBlock from '../MainTextBlock'

// Mock dependencies
const mockUseSettings = vi.fn()
const mockUseSelector = vi.fn()

// Mock hooks
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings()
}))

vi.mock('react-redux', async () => {
  const actual = await import('react-redux')
  return {
    ...actual,
    useSelector: () => mockUseSelector(),
    useDispatch: () => vi.fn()
  }
})

// Mock store to avoid withTypes issues
vi.mock('@renderer/store', () => ({
  useAppSelector: vi.fn(),
  useAppDispatch: vi.fn(() => vi.fn())
}))

// Mock store selectors
vi.mock('@renderer/store/messageBlock', async () => {
  const actual = await import('@renderer/store/messageBlock')
  return {
    ...actual,
    selectFormattedCitationsByBlockId: vi.fn(() => [])
  }
})

// Mock utilities
vi.mock('@renderer/utils/formats', () => ({
  cleanMarkdownContent: vi.fn((content: string) => content),
  encodeHTML: vi.fn((content: string) => content.replace(/"/g, '&quot;'))
}))

// Mock citation utilities
vi.mock('@renderer/utils/citation', () => ({
  withCitationTags: vi.fn((content: string, citations: any[]) => {
    // Simple mock implementation that simulates citation processing
    if (citations.length > 0) {
      return `${content} [processed-citations]`
    }
    return content
  }),
  determineCitationSource: vi.fn((citationReferences: any[], citationBlock?: any) => {
    // Mock implementation that returns the first valid source from citationReferences
    if (citationBlock?.response?.source) {
      return citationBlock.response.source
    }
    if (citationReferences?.length) {
      const validReference = citationReferences.find((ref) => ref.citationBlockSource)
      return validReference?.citationBlockSource
    }
    return undefined
  })
}))

// Mock services
vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: vi.fn()
}))

// Mock Markdown component
vi.mock('@renderer/pages/home/Markdown/Markdown', () => ({
  __esModule: true,
  default: ({ block, postProcess }: any) => {
    const content = postProcess ? postProcess(block.content) : block.content
    return (
      <div data-testid="mock-markdown" data-content={content}>
        Markdown: {content}
      </div>
    )
  }
}))

describe('MainTextBlock', () => {
  // Get references to mocked modules
  let mockGetModelUniqId: any
  let mockWithCitationTags: any
  let mockDetermineCitationSource: any

  // Create a mock store for Provider
  const mockStore = configureStore({
    reducer: {
      messageBlocks: (state = {}) => state
    }
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    // Get the mocked functions
    const { getModelUniqId } = await import('@renderer/services/ModelService')
    const { withCitationTags, determineCitationSource } = await import('@renderer/utils/citation')
    mockGetModelUniqId = getModelUniqId as any
    mockWithCitationTags = withCitationTags as any
    mockDetermineCitationSource = determineCitationSource as any

    // Default mock implementations
    mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: false })
    mockUseSelector.mockReturnValue([]) // Empty citations by default
    mockGetModelUniqId.mockImplementation((model: Model) => `${model.id}-${model.name}`)
  })

  // Test data factory functions
  const createMainTextBlock = (overrides: Partial<MainTextMessageBlock> = {}): MainTextMessageBlock => ({
    id: 'test-block-1',
    messageId: 'test-message-1',
    type: MessageBlockType.MAIN_TEXT,
    status: MessageBlockStatus.SUCCESS,
    createdAt: new Date().toISOString(),
    content: 'Test content',
    ...overrides
  })

  const createModel = (overrides: Partial<Model> = {}): Model =>
    ({
      id: 'test-model-1',
      name: 'Test Model',
      provider: 'test-provider',
      ...overrides
    }) as Model

  // Helper functions
  const renderMainTextBlock = (props: {
    block: MainTextMessageBlock
    role: 'user' | 'assistant'
    mentions?: Model[]
    citationBlockId?: string
  }) => {
    return render(
      <Provider store={mockStore}>
        <MainTextBlock {...props} />
      </Provider>
    )
  }

  // User-focused query helpers
  const getRenderedMarkdown = () => screen.queryByTestId('mock-markdown')
  const getRenderedPlainText = () => screen.queryByRole('paragraph')
  const getMentionElements = () => screen.queryAllByText(/@/)

  describe('basic rendering', () => {
    it('should render in markdown mode for assistant messages', () => {
      const block = createMainTextBlock({ content: 'Assistant response' })
      renderMainTextBlock({ block, role: 'assistant' })

      // User should see markdown-rendered content
      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: Assistant response')).toBeInTheDocument()
      expect(getRenderedPlainText()).not.toBeInTheDocument()
    })

    it('should render in plain text mode for user messages when setting disabled', () => {
      mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: false })
      const block = createMainTextBlock({ content: 'User message\nWith line breaks' })
      renderMainTextBlock({ block, role: 'user' })

      // User should see plain text with preserved formatting
      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedPlainText()!.textContent).toBe('User message\nWith line breaks')
      expect(getRenderedMarkdown()).not.toBeInTheDocument()

      // Check preserved whitespace
      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveStyle({ whiteSpace: 'pre-wrap' })
    })

    it('should render user messages as markdown when setting enabled', () => {
      mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: true })
      const block = createMainTextBlock({ content: 'User **bold** content' })
      renderMainTextBlock({ block, role: 'user' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: User **bold** content')).toBeInTheDocument()
    })

    it('should preserve complex formatting in plain text mode', () => {
      mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: false })
      const complexContent = `Line 1
  Indented line
**Bold not parsed**
- List not parsed`

      const block = createMainTextBlock({ content: complexContent })
      renderMainTextBlock({ block, role: 'user' })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe(complexContent)
      expect(textElement).toHaveClass('markdown')
    })

    it('should handle empty content gracefully', () => {
      const block = createMainTextBlock({ content: '' })
      expect(() => {
        renderMainTextBlock({ block, role: 'assistant' })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })

  describe('mentions functionality', () => {
    it('should display model mentions when provided', () => {
      const block = createMainTextBlock({ content: 'Content with mentions' })
      const mentions = [
        createModel({ id: 'model-1', name: 'deepseek-r1' }),
        createModel({ id: 'model-2', name: 'claude-sonnet-4' })
      ]

      renderMainTextBlock({ block, role: 'assistant', mentions })

      // User should see mention tags
      expect(screen.getByText('@deepseek-r1')).toBeInTheDocument()
      expect(screen.getByText('@claude-sonnet-4')).toBeInTheDocument()

      // Service should be called for model processing
      expect(mockGetModelUniqId).toHaveBeenCalledTimes(2)
      expect(mockGetModelUniqId).toHaveBeenCalledWith(mentions[0])
      expect(mockGetModelUniqId).toHaveBeenCalledWith(mentions[1])
    })

    it('should not display mentions when none provided', () => {
      const block = createMainTextBlock({ content: 'No mentions content' })

      renderMainTextBlock({ block, role: 'assistant', mentions: [] })
      expect(getMentionElements()).toHaveLength(0)

      renderMainTextBlock({ block, role: 'assistant', mentions: undefined })
      expect(getMentionElements()).toHaveLength(0)
    })

    it('should style mentions correctly for user visibility', () => {
      const block = createMainTextBlock({ content: 'Styled mentions test' })
      const mentions = [createModel({ id: 'model-1', name: 'Test Model' })]

      renderMainTextBlock({ block, role: 'assistant', mentions })

      const mentionElement = screen.getByText('@Test Model')
      expect(mentionElement).toHaveStyle({ color: 'var(--color-link)' })

      // Check container layout
      const container = mentionElement.closest('[style*="gap"]')
      expect(container).toHaveStyle({
        gap: '8px',
        marginBottom: '10px'
      })
    })
  })

  describe('content processing', () => {
    it('should process content through format utilities', () => {
      const block = createMainTextBlock({
        content: 'Content to process',
        citationReferences: [{ citationBlockSource: 'DEFAULT' as any }]
      })
      const mockCitations = [{ id: '1', content: 'Citation content', number: 1 }]

      // Mock the useSelector calls - first call for citations, second call for citationBlock
      mockUseSelector
        .mockReturnValueOnce(mockCitations) // selectFormattedCitationsByBlockId
        .mockReturnValueOnce(undefined) // messageBlocksSelectors.selectById

      renderMainTextBlock({
        block,
        role: 'assistant',
        citationBlockId: 'test-citations'
      })

      // Verify determineCitationSource was called with correct parameters
      expect(mockDetermineCitationSource).toHaveBeenCalledWith(block.citationReferences)

      // Verify citation processing was called with correct parameters
      expect(mockWithCitationTags).toHaveBeenCalledWith('Content to process', mockCitations, 'DEFAULT')

      // Verify the processed content is rendered
      expect(screen.getByText('Markdown: Content to process [processed-citations]')).toBeInTheDocument()
    })
  })

  describe('citation integration', () => {
    it('should display content normally when no citations are present', () => {
      const block = createMainTextBlock({ content: 'Content without citations' })
      mockUseSelector.mockReturnValue([])

      renderMainTextBlock({ block, role: 'assistant' })

      expect(screen.getByText('Markdown: Content without citations')).toBeInTheDocument()
      expect(mockUseSelector).toHaveBeenCalled()
    })

    it('should integrate with citation processing when all conditions are met', () => {
      const block = createMainTextBlock({
        content: 'Content with citation [1]',
        citationReferences: [{ citationBlockSource: WebSearchSource.OPENAI }]
      })

      const mockCitations = [
        {
          id: '1',
          number: 1,
          url: 'https://example.com',
          title: 'Example Citation',
          content: 'Citation content'
        }
      ]

      // Mock the useSelector calls - first call for citations, second call for citationBlock
      mockUseSelector
        .mockReturnValueOnce(mockCitations) // selectFormattedCitationsByBlockId
        .mockReturnValueOnce(undefined) // messageBlocksSelectors.selectById

      renderMainTextBlock({
        block,
        role: 'assistant',
        citationBlockId: 'citation-test'
      })

      // Verify citation integration works
      expect(mockUseSelector).toHaveBeenCalled()
      expect(getRenderedMarkdown()).toBeInTheDocument()

      // Verify determineCitationSource was called
      expect(mockDetermineCitationSource).toHaveBeenCalledWith(block.citationReferences)

      // Verify withCitationTags was called with correct parameters
      expect(mockWithCitationTags).toHaveBeenCalledWith(
        'Content with citation [1]',
        mockCitations,
        WebSearchSource.OPENAI
      )

      // Verify the processed content is rendered
      expect(screen.getByText('Markdown: Content with citation [1] [processed-citations]')).toBeInTheDocument()
    })

    it('should skip citation processing when conditions are not met', () => {
      const testCases = [
        {
          name: 'no citationReferences',
          block: createMainTextBlock({ content: 'Content [1]' }),
          citationBlockId: 'test'
        },
        {
          name: 'no citationBlockId',
          block: createMainTextBlock({
            content: 'Content [1]',
            citationReferences: [{ citationBlockSource: 'DEFAULT' as any }]
          }),
          citationBlockId: undefined
        },
        {
          name: 'no citations data',
          block: createMainTextBlock({
            content: 'Content [1]',
            citationReferences: [{ citationBlockSource: 'DEFAULT' as any }]
          }),
          citationBlockId: 'test'
        }
      ]

      testCases.forEach(({ block, citationBlockId }) => {
        mockUseSelector.mockReturnValue([]) // No citations

        const { unmount } = renderMainTextBlock({
          block,
          role: 'assistant',
          citationBlockId
        })

        expect(getRenderedMarkdown()).toBeInTheDocument()
        // Should render original content without citation processing
        expect(screen.getByText(`Markdown: ${block.content}`)).toBeInTheDocument()

        unmount()
      })
    })

    it('should handle multiple citations gracefully', () => {
      const block = createMainTextBlock({
        content: 'Multiple citations [1] and [2]',
        citationReferences: [{ citationBlockSource: 'DEFAULT' as any }]
      })

      const multipleCitations = [
        { id: '1', number: 1, url: 'https://first.com', title: 'First' },
        { id: '2', number: 2, url: 'https://second.com', title: 'Second' }
      ]

      mockUseSelector.mockReturnValue(multipleCitations)

      expect(() => {
        renderMainTextBlock({ block, role: 'assistant', citationBlockId: 'multi-test' })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })

  describe('settings integration', () => {
    it('should respond to markdown rendering setting changes', () => {
      const block = createMainTextBlock({ content: 'Settings test content' })

      // Test with markdown enabled
      mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: true })
      const { unmount } = renderMainTextBlock({ block, role: 'user' })
      expect(getRenderedMarkdown()).toBeInTheDocument()
      unmount()

      // Test with markdown disabled
      mockUseSettings.mockReturnValue({ renderInputMessageAsMarkdown: false })
      renderMainTextBlock({ block, role: 'user' })
      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedMarkdown()).not.toBeInTheDocument()
    })
  })

  describe('integration and robustness', () => {
    it('should handle null and undefined values gracefully', () => {
      const block = createMainTextBlock({ content: 'Null safety test' })

      expect(() => {
        renderMainTextBlock({
          block,
          role: 'assistant',
          mentions: undefined,
          citationBlockId: undefined
        })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })

    it('should integrate properly with Redux store for citations', () => {
      const block = createMainTextBlock({
        content: 'Redux integration test',
        citationReferences: [{ citationBlockSource: 'DEFAULT' as any }]
      })

      mockUseSelector.mockReturnValue([])
      renderMainTextBlock({ block, role: 'assistant', citationBlockId: 'redux-test' })

      // Verify Redux integration
      expect(mockUseSelector).toHaveBeenCalled()
      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })
})
