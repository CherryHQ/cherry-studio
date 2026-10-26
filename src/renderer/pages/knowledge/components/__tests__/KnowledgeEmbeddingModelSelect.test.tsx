import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ModelSelectorModule from '@renderer/components/ModelSelector'
import type { ModelSelectorSingleIdProps } from '@renderer/components/ModelSelector'
import type { ApiPath, ResponseForPath } from '@shared/data/api/paths'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { KnowledgeEmbeddingModelSelect } from '../KnowledgeEmbeddingModelSelect'

const { localModel, mockModelSelectorProps, mockShowDownloadPopup, integration } = vi.hoisted(() => ({
  integration: { enabled: false },
  localModel: {
    status: 'not_downloaded',
    isStatusResolved: true
  },
  mockModelSelectorProps: [] as Array<Record<string, any>>,
  mockShowDownloadPopup: vi.fn<(params: Record<string, unknown>) => Promise<boolean>>()
}))

vi.mock('@renderer/hooks/useLocalModel', () => ({
  useLocalModel: () => localModel
}))

vi.mock('@renderer/components/ModelSelector', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelSelectorModule>()
  return {
    ModelSelector: (props: ModelSelectorSingleIdProps) => {
      if (integration.enabled) return <actual.ModelSelector {...props} />
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
  }
})

// jsdom has no viewport measurements; keep the real selector's rows and filtering.
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: unknown[]
    children: (item: unknown, index: number) => ReactNode
  }) => list.map(children)
}))

vi.mock('@renderer/components/popups/LocalModelDownloadPopup', () => ({
  default: { show: mockShowDownloadPopup }
}))
vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'knowledge.rag.download_local_model': 'Download Local Model',
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
    integration.enabled = false
    mockModelSelectorProps.length = 0
    localModel.status = 'not_downloaded'
    localModel.isStatusResolved = true
    mockShowDownloadPopup.mockReset().mockResolvedValue(true)
  })

  it('offers Ollama and local embeddings, excludes chat models, and selects the Ollama id', async () => {
    const user = userEvent.setup()
    integration.enabled = true
    localModel.status = 'ready'
    const embeddingModel: Model = {
      ...makeEmbeddingModel('ollama::acme-retriever:latest', 'ollama', 'acme-retriever:latest'),
      apiModelId: 'acme-retriever:latest',
      supportsStreaming: true
    }
    const models: Model[] = [
      embeddingModel,
      { ...makeEmbeddingModel('ollama::llama3', 'ollama', 'llama3'), capabilities: [], supportsStreaming: true },
      makeEmbeddingModel(LOCAL_EMBEDDING_UNIQUE_MODEL_ID, 'local-embedding', 'Qwen3 Embedding 0.6B')
    ]
    const providers: Provider[] = ['ollama', 'local-embedding'].map((id) => ({
      id,
      name: id,
      isEnabled: true,
      authType: 'api-key',
      apiKeys: [],
      settings: {},
      reportsActualCost: false
    }))
    const onChange = vi.fn()
    await mockUseQuery.withImplementation(
      <TPath extends ApiPath>(path: TPath) => ({
        data: (path === '/models' ? models : path === '/providers' ? providers : []) as ResponseForPath<TPath, 'GET'>,
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn().mockResolvedValue(undefined),
        mutate: vi.fn()
      }),
      async () => {
        render(<KnowledgeEmbeddingModelSelect value={null} placeholder="Choose embedding model" onChange={onChange} />)

        await user.click(screen.getByRole('button', { name: /Choose embedding model/ }))

        expect(await screen.findByRole('option', { name: /acme-retriever:latest/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /Qwen3 Embedding 0.6B/ })).toBeInTheDocument()
        expect(screen.queryByRole('option', { name: /llama3/ })).not.toBeInTheDocument()
        await user.click(screen.getByRole('option', { name: /acme-retriever:latest/ }))

        expect(onChange).toHaveBeenCalledWith('ollama::acme-retriever:latest')
      }
    )
  })

  it('selects the local model only once the download dialog reports it on disk', async () => {
    const user = userEvent.setup()
    let finishDownload!: (downloaded: boolean) => void
    mockShowDownloadPopup.mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve
      })
    )
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'select-local-model' }))

    expect(mockShowDownloadPopup).toHaveBeenCalledWith({
      id: 'qwen3-embedding-0.6b',
      description: 'Qwen3 Embedding 0.6B · ~614 MB'
    })
    // The dialog stays open for the whole download, so nothing is selected yet.
    expect(onChange).not.toHaveBeenCalled()

    finishDownload(true)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
  })

  // False covers a decline, a mid-download cancel and a download the user gave up on.
  it('keeps the current selection when the model never arrives', async () => {
    const user = userEvent.setup()
    mockShowDownloadPopup.mockResolvedValue(false)
    const onChange = vi.fn()
    render(<KnowledgeEmbeddingModelSelect value={null} placeholder="not-set" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'select-local-model' }))

    await waitFor(() => expect(mockShowDownloadPopup).toHaveBeenCalledOnce())
    expect(onChange).not.toHaveBeenCalled()
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
    expect(mockShowDownloadPopup).not.toHaveBeenCalled()
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
      expect(mockShowDownloadPopup).not.toHaveBeenCalled()
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
})
