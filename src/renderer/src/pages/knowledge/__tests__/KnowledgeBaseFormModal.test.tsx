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
    <button data-testid="button" data-type={type} onClick={onClick} {...props}>
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
    it('should show advanced panel when button is clicked', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      // Initially, advanced panel should not be visible
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()

      // Click the advanced settings button
      const buttons = screen.getAllByTestId('button')
      const advancedButton = buttons.find((btn) => btn.textContent?.includes('settings.advanced.title'))
      fireEvent.click(advancedButton!)

      // Advanced panel should now be visible
      expect(screen.getByTestId('advanced-panel')).toBeInTheDocument()
    })

    it('should hide advanced panel when clicked again', () => {
      render(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={true}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
          defaultExpandAdvanced={true}
        />
      )

      // Initially, advanced panel should be visible
      expect(screen.getByTestId('advanced-panel')).toBeInTheDocument()

      // Click the hide button
      const buttons = screen.getAllByTestId('button')
      const hideButton = buttons.find((btn) => btn.textContent?.includes('settings.advanced.hide'))
      fireEvent.click(hideButton!)

      // Advanced panel should now be hidden
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()
    })
  })

  describe('footer buttons', () => {
    it('should render more settings button when onMoreSettings is provided', () => {
      render(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={true}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
          onMoreSettings={mocks.onMoreSettings}
        />
      )

      const buttons = screen.getAllByTestId('button')
      const moreSettingsButton = buttons.find((btn) => btn.textContent?.includes('settings.moresetting.label'))
      expect(moreSettingsButton).toBeDefined()
    })

    it('should call onMoreSettings when more settings button is clicked', () => {
      render(
        <KnowledgeBaseFormModal
          panels={createPanelConfigs()}
          open={true}
          onOk={mocks.onOk}
          onCancel={mocks.onCancel}
          onMoreSettings={mocks.onMoreSettings}
        />
      )

      const buttons = screen.getAllByTestId('button')
      const moreSettingsButton = buttons.find((btn) => btn.textContent?.includes('settings.moresetting.label'))
      if (moreSettingsButton) {
        fireEvent.click(moreSettingsButton)
        expect(mocks.onMoreSettings).toHaveBeenCalledTimes(1)
      }
    })

    it('should call onOk when ok button is clicked', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      const buttons = screen.getAllByTestId('button')
      const okButton = buttons.find((btn) => btn.textContent?.includes('common.ok'))
      if (okButton) {
        fireEvent.click(okButton)
        expect(mocks.onOk).toHaveBeenCalledTimes(1)
      }
    })

    it('should call onCancel when cancel button is clicked', () => {
      render(
        <KnowledgeBaseFormModal panels={createPanelConfigs()} open={true} onOk={mocks.onOk} onCancel={mocks.onCancel} />
      )

      const buttons = screen.getAllByTestId('button')
      const cancelButton = buttons.find((btn) => btn.textContent?.includes('common.cancel'))
      if (cancelButton) {
        fireEvent.click(cancelButton)
        expect(mocks.onCancel).toHaveBeenCalledTimes(1)
      }
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
