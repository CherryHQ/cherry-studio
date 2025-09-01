import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InputEmbeddingDimension from '../InputEmbeddingDimension'

const mocks = vi.hoisted(() => ({
  aiCore: {
    getEmbeddingDimensions: vi.fn()
  },
  i18n: {
    t: (k: string) => {
      const translations: Record<string, string> = {
        'knowledge.embedding_model_required': '请选择嵌入模型',
        'knowledge.provider_not_found': '找不到提供商',
        'message.error.get_embedding_dimensions': '获取嵌入维度失败',
        'knowledge.dimensions_size_placeholder': '请输入维度大小',
        'knowledge.dimensions_auto_set': '自动设置维度'
      }
      return translations[k] || k
    }
  }
}))

// Mock antd components to prevent flaky snapshot tests
vi.mock('antd', () => {
  const MockSpaceCompact: React.FC<React.PropsWithChildren<{ style?: React.CSSProperties }>> = ({
    children,
    style
  }) => (
    <div data-testid="space-compact" style={style}>
      {children}
    </div>
  )

  const MockInputNumber = ({ ref, value, onChange, placeholder, disabled, style }: any) => (
    <input
      ref={ref}
      type="number"
      data-testid="input-number"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      disabled={disabled}
      style={style}
    />
  )

  const MockButton: React.FC<any> = ({ children, onClick, disabled, icon, className, ...rest }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest} className={className}>
      {icon}
      {children}
    </button>
  )

  const MockTooltip: React.FC<React.PropsWithChildren<{ title: string }>> = ({ children, title }) => (
    <div data-testid="tooltip" data-title={title}>
      {children}
    </div>
  )

  return {
    Button: MockButton,
    InputNumber: MockInputNumber,
    Space: { Compact: MockSpaceCompact },
    Tooltip: MockTooltip
  }
})

// Mock dependencies
vi.mock('@renderer/aiCore', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEmbeddingDimensions: mocks.aiCore.getEmbeddingDimensions
  }))
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ provider: { id: 'test-provider', name: 'Test Provider' } })
}))

// mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  RefreshIcon: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="refresh-icon" aria-label="refresh" role="img" {...props}>
      RefreshIcon
    </svg>
  )
}))

// Mock window.message
Object.assign(window, {
  message: {
    error: vi.fn(),
    success: vi.fn()
  }
})

describe('InputEmbeddingDimension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockModel = {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test-provider',
    group: 'test-group'
  }

  const getRefreshButton = () => screen.getByRole('button', { name: /get embedding dimension/i })

  describe('basic rendering', () => {
    it('should match snapshot with all props', () => {
      const { container } = render(<InputEmbeddingDimension value={1536} model={mockModel} style={{ width: '100%' }} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot with loading state', async () => {
      // Manually control the promise to ensure we can snapshot the loading state.
      // This promise is intentionally never resolved.
      const promise = new Promise(() => {})
      mocks.aiCore.getEmbeddingDimensions.mockReturnValue(promise)

      const { container } = render(<InputEmbeddingDimension model={mockModel} />)

      const refreshButton = getRefreshButton()
      await userEvent.click(refreshButton)

      // At this point, the button is guaranteed to be in the loading state
      // because the promise it's awaiting will never resolve.
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should be enabled when model is provided', () => {
      render(<InputEmbeddingDimension model={mockModel} />)

      const input = screen.getByPlaceholderText('请输入维度大小')
      expect(input).not.toBeDisabled()
    })
  })

  describe('functionality', () => {
    it('should call onChange when input value changes', async () => {
      const handleChange = vi.fn()

      render(<InputEmbeddingDimension model={mockModel} onChange={handleChange} />)

      const input = screen.getByPlaceholderText('请输入维度大小')
      fireEvent.change(input, { target: { value: '2048' } })

      expect(handleChange).toHaveBeenCalledWith(2048)
    })

    it('should fetch and set dimension on refresh click', async () => {
      mocks.aiCore.getEmbeddingDimensions.mockResolvedValue(1536)

      const handleChange = vi.fn()
      const user = userEvent.setup()

      render(<InputEmbeddingDimension model={mockModel} onChange={handleChange} />)

      const refreshButton = getRefreshButton()
      await user.click(refreshButton)

      await waitFor(() => {
        expect(mocks.aiCore.getEmbeddingDimensions).toHaveBeenCalledWith(mockModel)
        expect(handleChange).toHaveBeenCalledWith(1536)
      })
    })
  })

  describe('error handling', () => {
    it('should be disabled and show no error when no model is provided', async () => {
      render(<InputEmbeddingDimension />)

      const refreshButton = getRefreshButton()
      expect(refreshButton).toBeDisabled()

      const input = screen.getByPlaceholderText('请输入维度大小')
      expect(input).toBeDisabled()

      // To be absolutely sure, we try to click the disabled button.
      // `userEvent` will not trigger an event on a disabled element by default.
      // We can skip this check to be explicit.
      await userEvent.click(refreshButton, { pointerEventsCheck: 0 })

      expect(window.message.error).not.toHaveBeenCalled()
    })

    it('should show error when API call fails', async () => {
      mocks.aiCore.getEmbeddingDimensions.mockRejectedValue(new Error('API Error'))

      const user = userEvent.setup()
      render(<InputEmbeddingDimension model={mockModel} />)

      const refreshButton = getRefreshButton()
      await user.click(refreshButton)

      await waitFor(() => {
        expect(window.message.error).toHaveBeenCalledWith('获取嵌入维度失败\nAPI Error')
      })
    })

    it('should handle null value correctly', async () => {
      const handleChange = vi.fn()

      render(<InputEmbeddingDimension model={mockModel} value={null} onChange={handleChange} />)

      const input = screen.getByPlaceholderText('请输入维度大小') as HTMLInputElement
      expect(input.value).toBe('')

      // Should allow typing new value
      fireEvent.change(input, { target: { value: '1024' } })
      expect(handleChange).toHaveBeenCalledWith(1024)
    })
  })
})
