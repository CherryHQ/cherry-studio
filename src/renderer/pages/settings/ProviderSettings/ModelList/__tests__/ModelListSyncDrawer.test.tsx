import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ModelListSyncDrawer from '../ModelListSyncDrawer'
import type { ModelSyncPreviewResponse } from '../modelSyncPreviewTypes'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (options && 'selected' in options && 'total' in options) {
          return `${key}:${options.selected}/${options.total}`
        }
        return key
      }
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Alert: ({ message }: any) => <div>{message}</div>,
    Button: ({ children, ...props }: any) => {
      Reflect.deleteProperty(props, 'loading')
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Checkbox: ({ checked, disabled, onCheckedChange }: any) => (
      <input
        aria-label="model-selection"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onCheckedChange(!checked)}
      />
    )
  }
})

vi.mock('@renderer/config/models', () => ({
  getModelLogo: () => null
}))

vi.mock('../../components/ModelTagsWithLabel', () => ({
  default: () => null
}))

vi.mock('../../primitives/ProviderSettingsDrawer', () => ({
  default: ({ open, title, children, footer, bodyClassName, contentClassName }: any) =>
    open ? (
      <div data-testid="drawer-content" className={contentClassName}>
        <h1>{title}</h1>
        <div data-testid="drawer-body" className={bodyClassName}>
          {children}
        </div>
        <footer>{footer}</footer>
      </div>
    ) : null
}))

const preview: ModelSyncPreviewResponse = {
  added: [
    {
      id: 'openai::gpt-5',
      providerId: 'openai',
      apiModelId: 'gpt-5',
      name: 'GPT 5',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    },
    {
      id: 'openai::claude-sonnet',
      providerId: 'openai',
      apiModelId: 'claude-sonnet',
      name: 'Claude Sonnet',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
  ],
  missing: [
    {
      model: {
        id: 'openai::legacy-model',
        providerId: 'openai',
        apiModelId: 'legacy-model',
        name: 'Legacy Model',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      removalReason: 'missing_from_provider'
    }
  ]
}

describe('ModelListSyncDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders pull-result search and filters visible model rows', () => {
    render(<ModelListSyncDrawer open preview={preview} isApplying={false} onApply={vi.fn()} onClose={vi.fn()} />)

    const searchInput = screen.getByPlaceholderText('models.search.placeholder')
    expect(searchInput).toBeInTheDocument()
    expect(screen.getByTestId('drawer-content')).toHaveClass('w-[min(calc(100vw-24px),520px)]')
    expect(screen.getByTestId('drawer-body')).toHaveClass('pt-0')
    expect(screen.getByText('GPT 5')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
    expect(screen.getByText('Legacy Model')).toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: 'claude' } })

    expect(screen.queryByText('GPT 5')).not.toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
    expect(screen.queryByText('Legacy Model')).not.toBeInTheDocument()
  })

  it('clears pull-result search and restores rows', () => {
    render(<ModelListSyncDrawer open preview={preview} isApplying={false} onApply={vi.fn()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), { target: { value: 'legacy-model' } })
    expect(screen.getByText('Legacy Model')).toBeInTheDocument()
    expect(screen.queryByText('GPT 5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))

    expect(screen.getByPlaceholderText('models.search.placeholder')).toHaveValue('')
    expect(screen.getByText('GPT 5')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
  })

  it('keeps hidden selections in the apply payload while filtering visible rows', async () => {
    const onApply = vi.fn()
    render(<ModelListSyncDrawer open preview={preview} isApplying={false} onApply={onApply} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('settings.models.manage.fetch_summary_add:2/2')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('models.search.placeholder'), { target: { value: 'claude' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.models.manage.sync_apply_changes' }))

    expect(onApply).toHaveBeenCalledWith({
      toAdd: preview.added,
      toRemove: ['openai::legacy-model']
    })
  })
})
