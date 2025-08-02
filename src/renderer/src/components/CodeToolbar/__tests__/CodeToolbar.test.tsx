import { ActionTool } from '@renderer/components/ActionTools'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeToolbar from '../toolbar'

// Test constants
const MORE_BUTTON_TOOLTIP = 'code_block.more'

// Mock components
const mocks = vi.hoisted(() => ({
  CodeToolButton: vi.fn(({ tool }) => (
    <div data-testid={`tool-button-${tool.id}`} data-tool-id={tool.id} data-tool-type={tool.type}>
      {tool.icon}
    </div>
  )),
  Tooltip: vi.fn(({ children, title }) => (
    <div data-testid="tooltip" data-title={title}>
      {children}
    </div>
  )),
  HStack: vi.fn(({ children, className }) => (
    <div data-testid="hstack" className={className}>
      {children}
    </div>
  )),
  ToolWrapper: vi.fn(({ children, onClick, className }) => (
    <div data-testid="tool-wrapper" onClick={onClick} className={className} role="button" tabIndex={0}>
      {children}
    </div>
  )),
  EllipsisVertical: vi.fn(() => <div data-testid="ellipsis-icon" className="tool-icon" />),
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string) => key)
  }))
}))

vi.mock('../button', () => ({
  default: mocks.CodeToolButton
}))

vi.mock('antd', () => ({
  Tooltip: mocks.Tooltip
}))

vi.mock('@renderer/components/Layout', () => ({
  HStack: mocks.HStack
}))

vi.mock('./styles', () => ({
  ToolWrapper: mocks.ToolWrapper
}))

vi.mock('lucide-react', () => ({
  EllipsisVertical: mocks.EllipsisVertical
}))

vi.mock('react-i18next', () => ({
  useTranslation: mocks.useTranslation
}))

// Helper function to create mock tools
const createMockTool = (overrides: Partial<ActionTool> = {}): ActionTool => ({
  id: 'test-tool',
  type: 'core',
  order: 1,
  icon: <div data-testid="test-icon">Icon</div>,
  tooltip: 'Test Tool',
  onClick: vi.fn(),
  ...overrides
})

// Common test data
const createMixedTools = () => [
  createMockTool({ id: 'quick1', type: 'quick' }),
  createMockTool({ id: 'quick2', type: 'quick' }),
  createMockTool({ id: 'core1', type: 'core' })
]

const createCoreOnlyTools = () => [
  createMockTool({ id: 'core1', type: 'core' }),
  createMockTool({ id: 'core2', type: 'core' })
]

// Helper function to click more button
const clickMoreButton = () => {
  const tooltip = screen.getByTestId('tooltip')
  fireEvent.click(tooltip.firstChild as Element)
}

describe('CodeToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot with mixed tools', () => {
      const { container } = render(<CodeToolbar tools={createMixedTools()} />)
      expect(container).toMatchSnapshot()
    })

    it('should match snapshot with only core tools', () => {
      const { container } = render(<CodeToolbar tools={[createMockTool({ id: 'core1', type: 'core' })]} />)
      expect(container).toMatchSnapshot()
    })
  })

  describe('empty state', () => {
    it('should render nothing when no tools provided', () => {
      const { container } = render(<CodeToolbar tools={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when all tools are not visible', () => {
      const tools = [
        createMockTool({ id: 'tool1', visible: () => false }),
        createMockTool({ id: 'tool2', visible: () => false })
      ]
      const { container } = render(<CodeToolbar tools={tools} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('tool visibility filtering', () => {
    it('should only render visible tools', () => {
      const tools = [
        createMockTool({ id: 'visible-tool', visible: () => true }),
        createMockTool({ id: 'hidden-tool', visible: () => false }),
        createMockTool({ id: 'no-visible-prop' }) // Should be visible by default
      ]
      render(<CodeToolbar tools={tools} />)

      expect(screen.getByTestId('tool-button-visible-tool')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-no-visible-prop')).toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-hidden-tool')).not.toBeInTheDocument()
    })

    it('should show tools without visible function by default', () => {
      const tools = [createMockTool({ id: 'default-visible' })]
      render(<CodeToolbar tools={tools} />)

      expect(screen.getByTestId('tool-button-default-visible')).toBeInTheDocument()
    })
  })

  describe('tool type grouping and quick tools behavior', () => {
    it('should separate core and quick tools - show quick tools when expanded', () => {
      const tools = [
        createMockTool({ id: 'core1', type: 'core' }),
        createMockTool({ id: 'quick1', type: 'quick' }),
        createMockTool({ id: 'core2', type: 'core' }),
        createMockTool({ id: 'quick2', type: 'quick' })
      ]
      render(<CodeToolbar tools={tools} />)

      // Initial state: core tools visible, quick tools hidden
      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core2')).toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-quick1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-quick2')).not.toBeInTheDocument()

      // After clicking more button, quick tools should be visible
      clickMoreButton()

      expect(screen.getByTestId('tool-button-quick1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-quick2')).toBeInTheDocument()
    })

    it('should render only core tools when no quick tools exist', () => {
      render(<CodeToolbar tools={createCoreOnlyTools()} />)

      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core2')).toBeInTheDocument()
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument() // No more button
    })

    it('should show single quick tool directly without more button', () => {
      const tools = [createMockTool({ id: 'quick1', type: 'quick' }), createMockTool({ id: 'core1', type: 'core' })]
      render(<CodeToolbar tools={tools} />)

      expect(screen.getByTestId('tool-button-quick1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument() // No more button
    })

    it('should show more button when multiple quick tools exist', () => {
      render(<CodeToolbar tools={createMixedTools()} />)

      // Initially quick tools should be hidden
      expect(screen.queryByTestId('tool-button-quick1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-quick2')).not.toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.getByTestId('tooltip')).toBeInTheDocument() // More button exists
    })

    it('should toggle quick tools visibility when more button is clicked', () => {
      render(<CodeToolbar tools={createMixedTools()} />)

      // Initial state: quick tools hidden
      expect(screen.queryByTestId('tool-button-quick1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-quick2')).not.toBeInTheDocument()

      // Click more button: quick tools visible
      clickMoreButton()
      expect(screen.getByTestId('tool-button-quick1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-quick2')).toBeInTheDocument()

      // Click more button again: quick tools hidden
      clickMoreButton()
      expect(screen.queryByTestId('tool-button-quick1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tool-button-quick2')).not.toBeInTheDocument()
    })

    it('should apply active class to more button when quick tools are shown', () => {
      const tools = [createMockTool({ id: 'quick1', type: 'quick' }), createMockTool({ id: 'quick2', type: 'quick' })]
      render(<CodeToolbar tools={tools} />)

      const tooltip = screen.getByTestId('tooltip')
      const moreButton = tooltip.firstChild as Element

      // Initial state: no active class
      expect(moreButton).not.toHaveClass('active')

      // After click: has active class
      fireEvent.click(moreButton)
      expect(moreButton).toHaveClass('active')

      // After second click: no active class
      fireEvent.click(moreButton)
      expect(moreButton).not.toHaveClass('active')
    })

    it('should display correct tooltip and icon for more button', () => {
      render(<CodeToolbar tools={createMixedTools()} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toHaveAttribute('data-title', MORE_BUTTON_TOOLTIP)

      expect(screen.getByTestId('ellipsis-icon')).toBeInTheDocument()
      expect(screen.getByTestId('ellipsis-icon')).toHaveClass('tool-icon')
    })

    it('should render core tools regardless of quick tools state', () => {
      const tools = [
        createMockTool({ id: 'quick1', type: 'quick' }),
        createMockTool({ id: 'quick2', type: 'quick' }),
        createMockTool({ id: 'core1', type: 'core' }),
        createMockTool({ id: 'core2', type: 'core' })
      ]
      render(<CodeToolbar tools={tools} />)

      // Core tools always visible
      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core2')).toBeInTheDocument()

      // After clicking more button, core tools still visible
      clickMoreButton()
      expect(screen.getByTestId('tool-button-core1')).toBeInTheDocument()
      expect(screen.getByTestId('tool-button-core2')).toBeInTheDocument()
    })
  })
})
