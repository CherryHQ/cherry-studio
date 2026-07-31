import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeEmbeddingModelSelect } from '../KnowledgeEmbeddingModelSelect'

const { localModel, mockModelSelectorProps, mockToastError } = vi.hoisted(() => ({
  localModel: {
    status: 'not_downloaded' as 'not_downloaded' | 'downloading' | 'ready' | 'error' | 'unsupported',
    download: vi.fn<() => Promise<boolean>>()
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
        <button type="button" onClick={() => props.onSelect(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)}>
          select-local-model
        </button>
      </div>
    )
  }
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
  }
}))
vi.mock('lucide-react', () => ({
  ChevronDown: () => <span>chevron</span>
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
    localModel.download.mockReset().mockResolvedValue(true)
  })

  it('selects immediately and starts the local model download in the background', () => {
    localModel.download.mockReturnValue(new Promise(() => undefined))
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'select-local-model' }))

    expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
    expect(localModel.download).toHaveBeenCalledOnce()
    expect(mockModelSelectorProps.at(-1)?.open).toBeUndefined()
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
  })

  it('uses normal selection without downloading again when the model is ready', () => {
    localModel.status = 'ready'
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'select-local-model' }))

    expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
    expect(localModel.download).not.toHaveBeenCalled()
  })

  it('hides the unsupported local model and keeps it as the first provider otherwise', () => {
    const localEmbeddingModel = makeEmbeddingModel(
      LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      'local-embedding',
      'Qwen3 Embedding 0.6B'
    )
    const remoteModel = makeEmbeddingModel('openai::text-embedding-3-small', 'openai', 'text-embedding-3-small')
    localModel.status = 'unsupported'
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={vi.fn()} />)

    expect(mockModelSelectorProps.at(-1)?.filter(localEmbeddingModel)).toBe(false)
    expect(mockModelSelectorProps.at(-1)?.filter(remoteModel)).toBe(true)
    expect(mockModelSelectorProps.at(-1)?.prioritizedProviderIds).toEqual(['local-embedding'])
  })

  it('keeps the selection and reports a background download failure', async () => {
    localModel.status = 'error'
    localModel.download.mockRejectedValue(new Error('failed'))
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'select-local-model' }))

    expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('knowledge.rag.download_local_embedding_failed'))
  })
})
