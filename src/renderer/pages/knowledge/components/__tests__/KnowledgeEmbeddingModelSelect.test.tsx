import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'

import { KnowledgeEmbeddingModelSelect } from '../KnowledgeEmbeddingModelSelect'

const { localModel, mockModelSelectorProps, mockPopupConfirm, mockToastError } = vi.hoisted(() => ({
  localModel: {
    status: 'not_downloaded',
    isStatusResolved: true,
    download: vi.fn<() => Promise<boolean>>()
  },
  mockModelSelectorProps: [] as Array<Record<string, any>>,
  mockPopupConfirm: vi.fn<(options: Record<string, unknown>) => Promise<boolean>>(),
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
vi.mock('@renderer/services/popup', () => ({ popup: { confirm: mockPopupConfirm } }))
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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'knowledge.rag.download_local_embedding': 'Download Local Model',
        'knowledge.rag.download_local_embedding_failed': 'Failed to download the local embedding model',
        'settings.dependencies.localModels.download': 'Download',
        'settings.dependencies.localModels.embedding.subtitle': 'Qwen3 Embedding 0.6B · ~614 MB'
      })[key] ?? key
  })
}))

const makeEmbeddingModel = (id: UniqueModelId, providerId: string, name: string): Model => ({
  id,
  providerId,
  name,
  capabilities: [MODEL_CAPABILITY.EMBEDDING],
  supportsStreaming: false,
  isEnabled: true,
  isHidden: false
})

describe('KnowledgeEmbeddingModelSelect', () => {
  beforeEach(() => {
    mockModelSelectorProps.length = 0
    mockToastError.mockClear()
    localModel.status = 'not_downloaded'
    localModel.isStatusResolved = true
    localModel.download.mockReset().mockResolvedValue(true)
    mockPopupConfirm.mockReset().mockResolvedValue(true)
  })

  it('waits for confirmation before selecting and downloading the local model', async () => {
    const user = userEvent.setup()
    let resolveConfirmation!: (confirmed: boolean) => void
    mockPopupConfirm.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirmation = resolve
      })
    )
    localModel.download.mockReturnValue(new Promise(() => undefined))
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'select-local-model' }))

    expect(mockPopupConfirm).toHaveBeenCalledWith({
      title: 'Download Local Model',
      content: 'Qwen3 Embedding 0.6B · ~614 MB',
      okText: 'Download',
      cancelText: 'Cancel'
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(localModel.download).not.toHaveBeenCalled()

    resolveConfirmation(true)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
    expect(localModel.download).toHaveBeenCalledOnce()
  })

  it('keeps the current selection and does not download when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    mockPopupConfirm.mockResolvedValue(false)
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'select-local-model' }))

    await waitFor(() => expect(mockPopupConfirm).toHaveBeenCalledOnce())
    expect(onChange).not.toHaveBeenCalled()
    expect(localModel.download).not.toHaveBeenCalled()
  })

  it('hides and rejects the local model until the platform probe resolves', async () => {
    const user = userEvent.setup()
    const localEmbeddingModel = makeEmbeddingModel(
      LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
      'local-embedding',
      'Qwen3 Embedding 0.6B'
    )
    localModel.isStatusResolved = false
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    expect(mockModelSelectorProps.at(-1)?.filter(localEmbeddingModel)).toBe(false)
    await user.click(screen.getByRole('button', { name: 'select-local-model' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(mockPopupConfirm).not.toHaveBeenCalled()
    expect(localModel.download).not.toHaveBeenCalled()
  })

  it.each(['ready', 'downloading'] as const)(
    'uses normal selection without another prompt when the model is %s',
    async (status) => {
      const user = userEvent.setup()
      localModel.status = status
      const onChange = vi.fn()
      render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: 'select-local-model' }))

      expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
      expect(mockPopupConfirm).not.toHaveBeenCalled()
      expect(localModel.download).not.toHaveBeenCalled()
    }
  )

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

  it('keeps the selection and reports a confirmed background download failure', async () => {
    const user = userEvent.setup()
    localModel.status = 'error'
    localModel.download.mockRejectedValue(new Error('failed'))
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'select-local-model' }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
    expect(mockPopupConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to download the local embedding model'))
  })
})
