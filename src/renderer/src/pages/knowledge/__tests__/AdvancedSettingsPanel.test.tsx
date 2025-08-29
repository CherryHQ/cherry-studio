import type { KnowledgeBase, Model } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AdvancedSettingsPanel from '../components/KnowledgeSettings/AdvancedSettingsPanel'

const mocks = vi.hoisted(() => {
  return {
    i18n: {
      t: (k: string) => {
        const translations: Record<string, string> = {
          'knowledge.chunk_size': '分块大小',
          'knowledge.chunk_overlap': '分块重叠',
          'knowledge.threshold': '检索相似度阈值',
          'knowledge.chunk_size_change_warning': '避免修改这个高级设置。'
        }
        return translations[k] || k
      }
    },
    handlers: {
      handleChunkSizeChange: vi.fn(),
      handleChunkOverlapChange: vi.fn(),
      handleThresholdChange: vi.fn()
    }
  }
})

vi.mock('@renderer/components/InfoTooltip', () => ({
  default: ({ title }: { title: string }) => <div>{mocks.i18n.t(title)}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.i18n.t
  })
}))

vi.mock('lucide-react', () => ({
  TriangleAlert: () => <span>warning</span>
}))

vi.mock('antd', () => ({
  Alert: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  InputNumber: ({ ref, value, onChange, placeholder, disabled, style, 'aria-label': ariaLabel }: any) => (
    <input
      ref={ref}
      type="number"
      data-testid="input-number"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      disabled={disabled}
      style={style}
    />
  )
}))

/**
 * 创建测试用的 KnowledgeBase 对象
 * @param overrides 可选的属性覆盖
 * @returns KnowledgeBase 对象
 */
function createKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: '1',
    name: 'Test KB',
    model: {
      id: 'test-model',
      provider: 'test-provider',
      name: 'Test Model',
      group: 'test'
    } as Model,
    items: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    version: 1,
    chunkSize: 500,
    chunkOverlap: 200,
    threshold: 0.5,
    framework: 'langchain',
    ...overrides
  }
}

describe('AdvancedSettingsPanel', () => {
  const mockBase = createKnowledgeBase()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = render(<AdvancedSettingsPanel newBase={mockBase} handlers={mocks.handlers} />)

      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('handlers', () => {
    it('should call handlers when values are changed', () => {
      render(<AdvancedSettingsPanel newBase={mockBase} handlers={mocks.handlers} />)

      const chunkSizeInput = screen.getByLabelText('分块大小')
      fireEvent.change(chunkSizeInput, { target: { value: '600' } })
      expect(mocks.handlers.handleChunkSizeChange).toHaveBeenCalledWith(600)

      const chunkOverlapInput = screen.getByLabelText('分块重叠')
      fireEvent.change(chunkOverlapInput, { target: { value: '300' } })
      expect(mocks.handlers.handleChunkOverlapChange).toHaveBeenCalledWith(300)

      const thresholdInput = screen.getByLabelText('检索相似度阈值')
      fireEvent.change(thresholdInput, { target: { value: '0.6' } })
      expect(mocks.handlers.handleThresholdChange).toHaveBeenCalledWith(0.6)
    })
  })
})
