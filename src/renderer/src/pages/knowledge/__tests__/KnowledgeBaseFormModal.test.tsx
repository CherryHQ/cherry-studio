import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeBaseFormModal, { PanelConfig } from '../components/KnowledgeSettings/KnowledgeBaseFormModal'

// Mock dependencies
const mocks = vi.hoisted(() => ({
  onCancel: vi.fn(),
  onOk: vi.fn()
}))

// Mock HStack component
vi.mock('@renderer/components/Layout', () => ({
  HStack: ({ children, ...props }: any) => (
    <div data-testid="hstack" {...props}>
      {children}
    </div>
  )
}))

// Mock antd components
vi.mock('antd', () => ({
  Modal: ({ children, open, title, onCancel, onOk, ...props }: any) =>
    open ? (
      <div data-testid="modal" data-title={title} {...props}>
        <div data-testid="modal-header">
          <span>{title}</span>
          <button type="button" data-testid="modal-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div data-testid="modal-body">{children}</div>
        <div data-testid="modal-footer">
          <button type="button" data-testid="modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-testid="modal-ok" onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    ) : null,
  Menu: ({ items, defaultSelectedKeys, onSelect, ...props }: any) => (
    <div data-testid="menu" data-default-selected={defaultSelectedKeys?.[0]} {...props}>
      {items?.map((item: any) => (
        <div
          key={item.key}
          data-testid={`menu-item-${item.key}`}
          onClick={() => onSelect?.({ key: item.key })}
          style={{ cursor: 'pointer' }}>
          {item.label}
        </div>
      ))}
    </div>
  )
}))

/**
 * 创建测试用的面板配置
 * @param overrides 可选的属性覆盖
 * @returns PanelConfig 数组
 */
function createPanelConfigs(overrides: Partial<PanelConfig>[] = []): PanelConfig[] {
  const defaultPanels: PanelConfig[] = [
    {
      key: 'general',
      label: 'General Settings',
      panel: <div data-testid="general-panel">General Settings Panel</div>
    },
    {
      key: 'advanced',
      label: 'Advanced Settings',
      panel: <div data-testid="advanced-panel">Advanced Settings Panel</div>
    }
  ]

  return defaultPanels.map((panel, index) => ({
    ...panel,
    ...overrides[index]
  }))
}

/**
 * 渲染 KnowledgeBaseFormModal 组件的辅助函数
 * @param props 可选的组件属性
 * @returns render 结果
 */
function renderModal(props: Partial<any> = {}) {
  const defaultProps = {
    open: true,
    title: 'Knowledge Base Settings',
    panels: createPanelConfigs(),
    onCancel: mocks.onCancel,
    onOk: mocks.onOk
  }

  return render(<KnowledgeBaseFormModal {...defaultProps} {...props} />)
}

describe('KnowledgeBaseFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = renderModal()
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should render modal when open is true', () => {
      renderModal({ open: true })

      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.getByTestId('hstack')).toBeInTheDocument()
      expect(screen.getByTestId('menu')).toBeInTheDocument()
    })

    it('should render first panel by default', () => {
      renderModal()

      expect(screen.getByTestId('general-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()
    })

    it('should handle empty panels array', () => {
      renderModal({ panels: [] })

      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.getByTestId('menu')).toBeInTheDocument()
    })
  })

  describe('menu interaction', () => {
    it('should switch panels when menu item is clicked', () => {
      renderModal()

      // Initially shows general panel
      expect(screen.getByTestId('general-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument()

      // Click advanced menu item
      fireEvent.click(screen.getByTestId('menu-item-advanced'))

      // Should now show advanced panel
      expect(screen.queryByTestId('general-panel')).not.toBeInTheDocument()
      expect(screen.getByTestId('advanced-panel')).toBeInTheDocument()
    })

    it('should set default selected menu to first panel key', () => {
      const panels = createPanelConfigs()
      renderModal({ panels })

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveAttribute('data-default-selected', panels[0].key)
    })

    it('should handle menu selection with custom panels', () => {
      const customPanels: PanelConfig[] = [
        {
          key: 'custom1',
          label: 'Custom Panel 1',
          panel: <div data-testid="custom1-panel">Custom Panel 1</div>
        },
        {
          key: 'custom2',
          label: 'Custom Panel 2',
          panel: <div data-testid="custom2-panel">Custom Panel 2</div>
        }
      ]

      renderModal({ panels: customPanels })

      // Initially shows first custom panel
      expect(screen.getByTestId('custom1-panel')).toBeInTheDocument()

      // Click second custom menu item
      fireEvent.click(screen.getByTestId('menu-item-custom2'))

      // Should now show second custom panel
      expect(screen.queryByTestId('custom1-panel')).not.toBeInTheDocument()
      expect(screen.getByTestId('custom2-panel')).toBeInTheDocument()
    })
  })

  describe('modal props', () => {
    const user = userEvent.setup()
    it('should pass through modal props correctly', () => {
      const customTitle = 'Custom Modal Title'
      renderModal({ title: customTitle })

      const modal = screen.getByTestId('modal')
      expect(modal).toHaveAttribute('data-title', customTitle)
    })

    it('should call onOk when ok button is clicked', async () => {
      renderModal()

      await user.click(screen.getByTestId('modal-ok'))
      expect(mocks.onOk).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('should handle single panel', () => {
      const singlePanel: PanelConfig[] = [
        {
          key: 'only',
          label: 'Only Panel',
          panel: <div data-testid="only-panel">Only Panel</div>
        }
      ]

      renderModal({ panels: singlePanel })

      expect(screen.getByTestId('only-panel')).toBeInTheDocument()
      expect(screen.getByTestId('menu-item-only')).toBeInTheDocument()
    })

    it('should handle panel with undefined key gracefully', () => {
      const panelsWithUndefined = [
        {
          key: 'valid',
          label: 'Valid Panel',
          panel: <div data-testid="valid-panel">Valid Panel</div>
        }
      ]

      renderModal({ panels: panelsWithUndefined })

      expect(screen.getByTestId('valid-panel')).toBeInTheDocument()
    })
  })
})
