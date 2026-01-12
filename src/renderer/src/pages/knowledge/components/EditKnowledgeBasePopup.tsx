import { ColFlex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { TopView } from '@renderer/components/TopView'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeBase } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeBaseForm } from '@renderer/hooks/useKnowledgeBaseForm.v2'
import { usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledge'
import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { mapKnowledgeBaseV2ToV1 } from '../utils/knowledgeBaseAdapter'
import {
  AdvancedSettingsPanel,
  GeneralSettingsPanel,
  KnowledgeBaseFormModal,
  type PanelConfig
} from './KnowledgeSettings'

const logger = loggerService.withContext('EditKnowledgeBasePopup')

interface ShowParams {
  baseId: string
}

interface PopupContainerProps extends ShowParams {
  resolve: (data: string | null) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ baseId, resolve }) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const { preprocessProviders } = usePreprocessProviders()
  const { base: baseV2 } = useKnowledgeBase(baseId, { enabled: !!baseId })
  const base = useMemo(
    () => (baseV2 ? mapKnowledgeBaseV2ToV1(baseV2, preprocessProviders) : undefined),
    [baseV2, preprocessProviders]
  )
  const {
    newBase,
    setNewBase,
    handlers,
    providerData: { selectedDocPreprocessProvider, docPreprocessSelectOptions }
  } = useKnowledgeBaseForm(base)

  const [open, setOpen] = useState(true)

  const hasCriticalChanges = useMemo(() => {
    if (!base) {
      return false
    }
    return getModelUniqId(base?.model) !== getModelUniqId(newBase?.model) || base?.dimensions !== newBase?.dimensions
  }, [base, newBase])

  const buildPayload = useCallback((nextBase: KnowledgeBase) => {
    return {
      name: nextBase.name,
      description: nextBase.description,
      embeddingModelId: `${nextBase.model.provider}:${nextBase.model.id}`,
      embeddingModelMeta: {
        id: nextBase.model.id,
        provider: nextBase.model.provider,
        name: nextBase.model.name,
        dimensions: nextBase.dimensions
      },
      rerankModelId: nextBase.rerankModel ? `${nextBase.rerankModel.provider}:${nextBase.rerankModel.id}` : undefined,
      rerankModelMeta: nextBase.rerankModel
        ? {
            id: nextBase.rerankModel.id,
            provider: nextBase.rerankModel.provider,
            name: nextBase.rerankModel.name
          }
        : undefined,
      preprocessProviderId: nextBase.preprocessProvider?.provider.id,
      chunkSize: nextBase.chunkSize,
      chunkOverlap: nextBase.chunkOverlap,
      threshold: nextBase.threshold
    }
  }, [])

  const fetchAllItems = useCallback(async (sourceBaseId: string) => {
    const fetchedItems: KnowledgeItemV2[] = []
    let page = 1
    let total = 0

    do {
      const response = (await dataApiService.get(`/knowledges/${sourceBaseId}/items` as any, {
        query: { page, limit: 100 }
      })) as OffsetPaginationResponse<KnowledgeItemV2>
      fetchedItems.push(...response.items)
      total = response.total ?? fetchedItems.length
      page += 1
    } while (fetchedItems.length < total)

    return fetchedItems
  }, [])

  const migrateBase = useCallback(
    async (sourceBase: KnowledgeBase, targetBase: KnowledgeBase) => {
      const timestamp = dayjs().format('YYMMDDHHmmss')
      const nextName = `${targetBase.name || sourceBase.name}-${timestamp}`
      const createdBase = await dataApiService.post('/knowledges' as any, {
        body: buildPayload({ ...targetBase, name: nextName })
      })

      const sourceItems = await fetchAllItems(sourceBase.id)
      if (sourceItems.length > 0) {
        const itemsPayload: CreateKnowledgeItemDto[] = sourceItems.map((item) => ({
          type: item.type,
          data: item.data
        }))

        await dataApiService.post(`/knowledges/${createdBase.id}/items` as any, {
          body: { items: itemsPayload }
        })
      }

      await invalidate(['/knowledges', `/knowledges/${createdBase.id}`])
      return createdBase.id
    },
    [buildPayload, fetchAllItems, invalidate]
  )

  // 处理嵌入模型更改迁移
  const handleEmbeddingModelChangeMigration = useCallback(async () => {
    try {
      if (!base) {
        return
      }
      const migratedBaseId = await migrateBase(base, { ...newBase, id: nanoid() })
      setOpen(false)
      resolve(migratedBaseId)
    } catch (error) {
      logger.error('KnowledgeBase migration failed:', error as Error)
      window.toast.error(t('knowledge.migrate.error.failed') + ': ' + formatErrorMessage(error))
    }
  }, [base, newBase, migrateBase, resolve, t])

  if (!base) {
    return (
      <KnowledgeBaseFormModal
        title={t('knowledge.settings.title')}
        open={open}
        onOk={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        afterClose={() => resolve(null)}
        panels={[
          {
            key: 'general',
            label: t('common.loading'),
            panel: <div style={{ padding: 16 }}>{t('common.loading')}</div>
          }
        ]}
        confirmLoading={true}
      />
    )
  }

  const onOk = async () => {
    if (hasCriticalChanges) {
      window.modal.confirm({
        title: t('knowledge.migrate.confirm.title'),
        content: (
          <ColFlex className="items-start">
            <span>{t('knowledge.migrate.confirm.content')}</span>
            <span>{t('knowledge.embedding_model')}:</span>
            <span style={{ paddingLeft: '1em' }}>{`${t('knowledge.migrate.source_model')}: ${base.model.name}`}</span>
            <span
              style={{ paddingLeft: '1em' }}>{`${t('knowledge.migrate.target_model')}: ${newBase.model.name}`}</span>
            <span>{t('knowledge.dimensions')}:</span>
            <span
              style={{ paddingLeft: '1em' }}>{`${t('knowledge.migrate.source_dimensions')}: ${base.dimensions}`}</span>
            <span
              style={{
                paddingLeft: '1em'
              }}>{`${t('knowledge.migrate.target_dimensions')}: ${newBase.dimensions}`}</span>
          </ColFlex>
        ),
        okText: t('knowledge.migrate.confirm.ok'),
        centered: true,
        onOk: handleEmbeddingModelChangeMigration
      })
    } else {
      try {
        logger.debug('newbase', newBase)
        await dataApiService.patch(`/knowledges/${base.id}` as any, {
          body: buildPayload(newBase)
        })
        await invalidate(['/knowledges', `/knowledges/${base.id}`])
        setOpen(false)
        resolve(base.id)
      } catch (error) {
        logger.error('KnowledgeBase edit failed:', error as Error)
        window.toast.error(t('knowledge.error.failed_to_edit') + formatErrorMessage(error))
      }
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
      title={t('knowledge.settings.title')}
      okText={hasCriticalChanges ? t('knowledge.migrate.button.text') : t('common.save')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={() => resolve(null)}
      panels={panelConfigs}
      defaultExpandAdvanced={true}
    />
  )
}

export default class EditKnowledgeBasePopup {
  static TopViewKey = 'EditKnowledgeBasePopup'

  static hide() {
    TopView.hide(this.TopViewKey)
  }

  static show(props: ShowParams): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            this.hide()
            resolve(v)
          }}
        />,
        this.TopViewKey
      )
    })
  }
}
