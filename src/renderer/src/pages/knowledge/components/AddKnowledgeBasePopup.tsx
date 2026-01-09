import { loggerService } from '@logger'
import AiProviderNew from '@renderer/aiCore/index_new'
import { TopView } from '@renderer/components/TopView'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useKnowledgeBaseForm } from '@renderer/hooks/useKnowledgeBaseForm'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
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
  const { addKnowledgeBase } = useKnowledgeBases()
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

      const _newBase: KnowledgeBase = {
        ...newBase,
        dimensions,
        created_at: Date.now(),
        updated_at: Date.now()
      }

      logger.info('Creating knowledge base', {
        id: _newBase.id,
        name: _newBase.name,
        modelId: _newBase.model?.id,
        provider: _newBase.model?.provider,
        dimensions: _newBase.dimensions
      })

      await window.api.knowledgeBase.create(getKnowledgeBaseParams(_newBase))

      addKnowledgeBase(_newBase)
      setOpen(false)
      resolve(_newBase)
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
