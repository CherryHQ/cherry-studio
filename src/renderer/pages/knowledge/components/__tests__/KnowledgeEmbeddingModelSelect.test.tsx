import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeEmbeddingModelSelect } from '../KnowledgeEmbeddingModelSelect'

const { localModel, mockModelSelectorProps, mockToastError } = vi.hoisted(() => ({
  localModel: {
    status: 'not_downloaded' as 'not_downloaded' | 'downloading' | 'ready' | 'error' | 'unsupported',
    percent: 0,
    download: vi.fn<() => Promise<boolean>>(),
    cancel: vi.fn<() => Promise<void>>(),
    remove: vi.fn()
  },
  mockModelSelectorProps: [] as Array<Record<string, any>>,
  mockToastError: vi.fn()
}))

vi.mock('@renderer/hooks/useLocalModel', () => ({
  useLocalModel: () => localModel
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [], isLoading: false, refetch: vi.fn() })
}))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: (props: Record<string, any>) => {
    mockModelSelectorProps.push(props)
    return (
      <div>
        {props.trigger}
        <button type="button" onClick={() => props.onOpenChange?.(true)}>
          open-selector
        </button>
        {props.open
          ? props.modelActions?.map(
              (action: { modelId: UniqueModelId; content: ReactNode; onActivate: () => void }) => (
                <div key={action.modelId}>
                  <button type="button" aria-label={`activate-${action.modelId}`} onClick={action.onActivate} />
                  {action.content}
                </div>
              )
            )
          : null}
      </div>
    )
  },
  ModelSelectorRowActionButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: mockToastError } }))
vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classNames: Array<string | false | null | undefined>) => classNames.filter(Boolean).join(' ')
}))
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    const { variant, ...buttonProps } = props
    void variant
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => children
}))
vi.mock('lucide-react', () => ({
  ChevronDown: () => <span>chevron</span>,
  Download: () => <span>download-icon</span>,
  X: () => <span>cancel-icon</span>
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const makeEmbeddingModel = (id: UniqueModelId, providerId: string, name: string): Model =>
  ({
    id,
    providerId,
    name,
    capabilities: [MODEL_CAPABILITY.EMBEDDING],
    supportsStreaming: false,
    isEnabled: true,
    isHidden: false
  }) as Model

describe('KnowledgeEmbeddingModelSelect', () => {
  beforeEach(() => {
    mockModelSelectorProps.length = 0
    mockToastError.mockClear()
    localModel.status = 'not_downloaded'
    localModel.percent = 0
    localModel.download.mockReset().mockResolvedValue(true)
    localModel.cancel.mockReset().mockResolvedValue()
  })

  it('downloads from real model row activation, then selects the model and closes', async () => {
    const onChange = vi.fn()
    render(
      <KnowledgeEmbeddingModelSelect
        aria-label="embedding-model"
        value={null}
        placeholder="not-set"
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'open-selector' }))
    fireEvent.click(screen.getByRole('button', { name: 'activate-local-embedding::qwen3-embedding-0.6b' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('local-embedding::qwen3-embedding-0.6b'))
    expect(screen.queryByRole('button', { name: 'knowledge.rag.download_local_embedding' })).not.toBeInTheDocument()
  })

  it('shows progress and routes the row action to cancellation while downloading', () => {
    localModel.status = 'downloading'
    localModel.percent = 42
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'open-selector' }))
    expect(screen.getByText('42%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(localModel.cancel).toHaveBeenCalledTimes(1)
    expect(localModel.download).not.toHaveBeenCalled()
  })

  it('hides the unsupported local model and uses standard UI when ready', () => {
    const localEmbeddingModel = makeEmbeddingModel(
      'local-embedding::qwen3-embedding-0.6b',
      'local-embedding',
      'Qwen3 Embedding 0.6B (Local)'
    )
    const remoteModel = makeEmbeddingModel('openai::text-embedding-3-small', 'openai', 'text-embedding-3-small')
    const onChange = vi.fn()
    localModel.status = 'unsupported'
    const { rerender } = render(
      <KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />
    )
    expect(mockModelSelectorProps.at(-1)?.modelActions).toEqual([])
    expect(mockModelSelectorProps.at(-1)?.filter(localEmbeddingModel)).toBe(false)
    expect(mockModelSelectorProps.at(-1)?.filter(remoteModel)).toBe(true)
    expect(mockModelSelectorProps.at(-1)?.prioritizedProviderIds).toEqual(['local-embedding'])

    localModel.status = 'ready'
    rerender(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)
    expect(mockModelSelectorProps.at(-1)?.modelActions).toEqual([])
    expect(mockModelSelectorProps.at(-1)?.filter(localEmbeddingModel)).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the model action retryable and reports a genuine download failure', async () => {
    localModel.status = 'error'
    localModel.download.mockRejectedValue(new Error('failed'))
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'open-selector' }))
    fireEvent.click(screen.getByRole('button', { name: 'knowledge.rag.download_local_embedding' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('knowledge.rag.download_local_embedding_failed'))
    expect(screen.getByRole('button', { name: 'knowledge.rag.download_local_embedding' })).toBeInTheDocument()
  })
})
