import { ActionTool } from '@renderer/components/ActionTools'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CodeToolButton from '../button'

// Mock Antd components
const mocks = vi.hoisted(() => ({
  Tooltip: vi.fn(({ children, title }) => (
    <div data-testid="tooltip" data-title={title}>
      {children}
    </div>
  )),
  Dropdown: vi.fn(({ children, menu }) => (
    <div data-testid="dropdown" data-menu={JSON.stringify(menu)}>
      {children}
    </div>
  ))
}))

vi.mock('antd', () => ({
  Tooltip: mocks.Tooltip,
  Dropdown: mocks.Dropdown
}))

// Mock ToolWrapper
vi.mock('../styles', () => ({
  ToolWrapper: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" data-testid="tool-wrapper" onClick={onClick}>
      {children}
    </button>
  )
}))

// Helper function to create mock tools
const createMockTool = (overrides: Partial<ActionTool> = {}): ActionTool => ({
  id: 'test-tool',
  type: 'core',
  order: 10,
  icon: <span data-testid="test-icon">Test Icon</span>,
  tooltip: 'Test Tool',
  onClick: vi.fn(),
  ...overrides
})

const createMockChildTool = (id: string, tooltip: string): Omit<ActionTool, 'children'> => ({
  id,
  type: 'quick',
  order: 10,
  icon: <span data-testid={`${id}-icon`}>{tooltip} Icon</span>,
  tooltip,
  onClick: vi.fn()
})

describe('CodeToolButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering modes', () => {
    it('should render as simple button when no children', () => {
      const tool = createMockTool()
      render(<CodeToolButton tool={tool} />)

      // Should render button with tooltip
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
      expect(screen.getByTestId('tool-wrapper')).toBeInTheDocument()
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()

      // Should not render dropdown
      expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument()
    })

    it('should render as simple button when children array is empty', () => {
      const tool = createMockTool({ children: [] })
      render(<CodeToolButton tool={tool} />)

      expect(screen.queryByTestId('dropdown')).not.toBeInTheDocument()
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })

    it('should render as dropdown when has children', () => {
      const children = [createMockChildTool('child1', 'Child 1')]
      const tool = createMockTool({ children })
      render(<CodeToolButton tool={tool} />)

      // Should render dropdown containing the main button
      expect(screen.getByTestId('dropdown')).toBeInTheDocument()
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
      expect(screen.getByTestId('tool-wrapper')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should trigger onClick when simple button is clicked', () => {
      const mockOnClick = vi.fn()
      const tool = createMockTool({ onClick: mockOnClick })
      render(<CodeToolButton tool={tool} />)

      fireEvent.click(screen.getByTestId('tool-wrapper'))

      expect(mockOnClick).toHaveBeenCalledTimes(1)
    })

    it('should handle missing onClick gracefully', () => {
      const tool = createMockTool({ onClick: undefined })
      render(<CodeToolButton tool={tool} />)

      expect(() => {
        fireEvent.click(screen.getByTestId('tool-wrapper'))
      }).not.toThrow()
    })
  })

  describe('dropdown functionality', () => {
    it('should configure dropdown with correct menu structure', () => {
      const mockOnClick1 = vi.fn()
      const mockOnClick2 = vi.fn()
      const children = [createMockChildTool('child1', 'Child 1'), createMockChildTool('child2', 'Child 2')]
      children[0].onClick = mockOnClick1
      children[1].onClick = mockOnClick2

      const tool = createMockTool({ children })
      render(<CodeToolButton tool={tool} />)

      // Verify dropdown was called with correct menu structure
      expect(mocks.Dropdown).toHaveBeenCalled()
      const dropdownProps = mocks.Dropdown.mock.calls[0][0]

      expect(dropdownProps.menu.items).toHaveLength(2)
      expect(dropdownProps.menu.items[0].key).toBe('child1')
      expect(dropdownProps.menu.items[0].label).toBe('Child 1')
      expect(dropdownProps.menu.items[0].onClick).toBe(mockOnClick1)
      expect(dropdownProps.trigger).toEqual(['click'])
    })
  })

  describe('accessibility', () => {
    it('should provide accessible button element with tooltip', () => {
      const tool = createMockTool({ tooltip: 'Accessible Tool' })
      render(<CodeToolButton tool={tool} />)

      const button = screen.getByTestId('tool-wrapper')
      expect(button.tagName).toBe('BUTTON')
      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-title', 'Accessible Tool')
    })
  })

  describe('error handling', () => {
    it('should render without crashing for minimal tool configuration', () => {
      const minimalTool: ActionTool = {
        id: 'minimal',
        type: 'core',
        order: 1,
        icon: null,
        tooltip: ''
      }

      expect(() => {
        render(<CodeToolButton tool={minimalTool} />)
      }).not.toThrow()
    })
  })
})
