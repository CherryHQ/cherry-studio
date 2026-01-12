import { loggerService } from '@logger'
import AiProviderNew from '@renderer/aiCore/index_new'
import { TopView } from '@renderer/components/TopView'
import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeBaseForm } from '@renderer/hooks/useKnowledgeBaseForm'
import type { KnowledgeBase } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AdvancedSettingsPanel,
  GeneralSettingsPanel,
  KnowledgeBaseFormModal,
  type PanelConfig
} from './KnowledgeSettings'

const logger = loggerService.withContext('AddKnowledgeBasePopup')

interface ShowParams {
  title: string
}

interface PopupContainerProps extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()
  const { createKnowledgeBase } = useKnowledgeBases()
  const {
    newBase,
    setNewBase,
    handlers,
    providerData: { providers, selectedDocPreprocessProvider, docPreprocessSelectOptions }
  } = useKnowledgeBaseForm()

  const onOk = async () => {
    if (!newBase.name?.trim()) {
      window.toast.error(t('knowledge.name_required'))
      return
    }

    if (!newBase.model) {
      window.toast.error(t('knowledge.embedding_model_required'))
      return
    }

    setLoading(true)

    try {
      let dimensions = newBase.dimensions

      // Auto-fetch dimensions if not manually set
      if (!dimensions) {
        const provider = providers.find((p) => p.id === newBase.model.provider)

        if (!provider) {
          window.toast.error(t('knowledge.provider_not_found'))
          setLoading(false)
          return
        }

        try {
          const aiProvider = new AiProviderNew(provider)
          dimensions = await aiProvider.getEmbeddingDimensions(newBase.model)
          logger.info('Auto-fetched embedding dimensions', { dimensions, modelId: newBase.model.id })
        } catch (error) {
          logger.error('Failed to get embedding dimensions', error as Error)
          window.toast.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
          setLoading(false)
          return
        }
      }

      logger.info('Creating knowledge base via Data API', {
        id: newBase.id,
        name: newBase.name,
        modelId: newBase.model?.id,
        provider: newBase.model?.provider,
        dimensions
      })

      // Call Data API to create knowledge base
      const newBaseV2 = await createKnowledgeBase({
        name: newBase.name,
        description: newBase.description,
        embeddingModelId: `${newBase.model.provider}:${newBase.model.id}`,
        embeddingModelMeta: {
          id: newBase.model.id,
          provider: newBase.model.provider,
          name: newBase.model.name,
          dimensions
        },
        rerankModelId: newBase.rerankModel ? `${newBase.rerankModel.provider}:${newBase.rerankModel.id}` : undefined,
        rerankModelMeta: newBase.rerankModel
          ? { id: newBase.rerankModel.id, provider: newBase.rerankModel.provider, name: newBase.rerankModel.name }
          : undefined,
        preprocessProviderId: selectedDocPreprocessProvider?.id,
        chunkSize: newBase.chunkSize,
        chunkOverlap: newBase.chunkOverlap,
        threshold: newBase.threshold
      })

      // Convert to v1 format for UI compatibility (child components not yet migrated)
      const newBaseV1: KnowledgeBase = {
        id: newBaseV2.id,
        name: newBaseV2.name,
        description: newBaseV2.description,
        model: newBase.model,
        dimensions,
        items: [],
        created_at: Date.parse(newBaseV2.createdAt),
        updated_at: Date.parse(newBaseV2.updatedAt),
        version: 1,
        chunkSize: newBaseV2.chunkSize,
        chunkOverlap: newBaseV2.chunkOverlap,
        threshold: newBaseV2.threshold,
        rerankModel: newBase.rerankModel,
        preprocessProvider: selectedDocPreprocessProvider
          ? { type: 'preprocess', provider: selectedDocPreprocessProvider }
          : undefined
      }

      // Cache is automatically refreshed via useKnowledgeBases hook
      setOpen(false)
      resolve(newBaseV1)
    } catch (error) {
      logger.error('KnowledgeBase creation failed:', error as Error)
      window.toast.error(t('knowledge.error.failed_to_create') + getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const panelConfigs: PanelConfig[] = [
    {
      key: 'general',
      label: t('settings.general.label'),
      panel: <GeneralSettingsPanel newBase={newBase} setNewBase={setNewBase} handlers={handlers} />
    },
    {
      key: 'advanced',
      label: t('settings.advanced.title'),
      panel: (
        <AdvancedSettingsPanel
          newBase={newBase}
          selectedDocPreprocessProvider={selectedDocPreprocessProvider}
          docPreprocessSelectOptions={docPreprocessSelectOptions}
          handlers={handlers}
        />
      )
    }
  ]

  return (
    <KnowledgeBaseFormModal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={() => resolve(null)}
      panels={panelConfigs}
      confirmLoading={loading}
    />
  )
}

export default class AddKnowledgeBasePopup {
  static TopViewKey = 'AddKnowledgeBasePopup'

  static hide() {
    TopView.hide(this.TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        this.TopViewKey
      )
    })
  }
}
