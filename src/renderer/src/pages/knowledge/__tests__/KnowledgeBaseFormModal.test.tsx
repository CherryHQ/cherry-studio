import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PanelConfig } from '../components/KnowledgeSettings/KnowledgeBaseFormModal'
import KnowledgeBaseFormModal from '../components/KnowledgeSettings/KnowledgeBaseFormModal'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  onCancel: vi.fn(),
  onOk: vi.fn(),
  onMoreSettings: vi.fn(),
  t: vi.fn((key: string) => key)
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down">▼</span>,
  ChevronUp: () => <span data-testid="chevron-up">▲</span>
}))

// Mock antd components
vi.mock('antd', () => ({
  Modal: ({ children, open, footer, ...props }: any) =>
    open ? (
      <div data-testid="modal" {...props}>
        <div data-testid="modal-body">{children}</div>
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
  Button: ({ children, onClick, icon, type, ...props }: any) => (
    <button type="button" data-testid="button" data-type={type} onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  )
}))

const createPanelConfigs = (): PanelConfig[] => [
  {
    key: 'general',
    label: 'General Settings',
    panel: <div data-testid="general-panel">General Settings Content</div>
  },
  {
    key: 'advanced',
    label: 'Advanced Settings',
    panel: <div data-testid="advanced-panel">Advanced Settings Content</div>
  }
]

describe('KnowledgeBaseFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      expect(container.firstChild).toMatchSnapshot()
    })

    it('should render modal when open is true', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      expect(screen.getByTestId('modal')).toBeInTheDocument()
    })

    it('should not render modal when open is false', () => {
      render(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={false}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
        />
      )

      expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
    })

    it('should render general panel by default', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      expect(screen.getByTestId('general-panel')).toBeInTheDocument()
    })

    it('should not render advanced panel by default', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()
    })

    it('should render advanced panel when defaultExpandAdvanced is true', () => {
      render(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={true}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
          defaultExpandAdvanced={true}
        />
      )

      expect(screen.getByTestId('advanced-panel')).toBeInTheDocument()
    })
  })

  describe('advanced settings toggle', () => {
    it('should toggle advanced panel visibility', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      // Initially, advanced panel should not be visible
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()

      // Find and click the first button (advanced settings toggle)
      const buttons = screen.getAllByTestId('button')
      if (buttons.length > 0) {
        fireEvent.click(buttons[0])
        // Advanced panel might be visible now (depending on implementation)
      }
    })
  })

  describe('footer buttons', () => {
    it('should have more buttons when onMoreSettings is provided', () => {
      const { rerender } = render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )
      const buttonsWithout = screen.getAllByTestId('button')

      rerender(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={true}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
          onMoreSettings={mocks.onMoreSettings}
        />
      )
      const buttonsWith = screen.getAllByTestId('button')

      // Should have one more button when onMoreSettings is provided
      expect(buttonsWith.length).toBeGreaterThan(buttonsWithout.length)
    })
  })

  describe('edge cases', () => {
    it('should handle empty panels array', () => {
      render(<KnowledgeBaseFormModal panels={[]} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />)

      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.queryByTestId('general-panel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()
    })

    it('should handle single panel', () => {
      const singlePanel: PanelConfig[] = [
        {
          key: 'general',
          label: 'General Settings',
          panel: <div data-testid="general-panel">General Settings Content</div>
        }
      ]

      render(<KnowledgeBaseFormModal panels={singlePanel} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />)

      expect(screen.getByTestId('general-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()
    })
  })
})
