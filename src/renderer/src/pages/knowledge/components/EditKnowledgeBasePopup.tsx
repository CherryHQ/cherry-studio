import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { TopView } from '@renderer/components/TopView'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useKnowledgeBaseForm } from '@renderer/hooks/useKnowledgeBaseForm'
import { getModelUniqId } from '@renderer/services/ModelService'
import { KnowledgeBase, MigrationModeEnum } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { Flex } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AdvancedSettingsPanel,
  GeneralSettingsPanel,
  KnowledgeBaseFormModal,
  type PanelConfig
} from './KnowledgeSettings'

const logger = loggerService.withContext('EditKnowledgeBasePopup')

interface ShowParams {
  base: KnowledgeBase
}

interface PopupContainerProps extends ShowParams {
  resolve: (data: KnowledgeBase | null) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ base: _base, resolve }) => {
  const { t } = useTranslation()
  const { base, updateKnowledgeBase, migrateBase } = useKnowledge(_base.id)
  const {
    newBase,
    setNewBase,
    handlers,
    providerData: { selectedDocPreprocessProvider, docPreprocessSelectOptions }
  } = useKnowledgeBaseForm(_base)

  const [open, setOpen] = useState(true)

  const hasCriticalChanges = useMemo(
    () => getModelUniqId(base?.model) !== getModelUniqId(newBase?.model) || base?.dimensions !== newBase?.dimensions,
    [base, newBase]
  )

  // 处理嵌入模型更改迁移
  const handleEmbeddingModelChangeMigration = useCallback(async () => {
    const migratedBase = { ...newBase, id: nanoid() }
    try {
      await migrateBase(migratedBase, MigrationModeEnum.EmbeddingModelChange)
      setOpen(false)
      resolve(migratedBase)
    } catch (error) {
      logger.error('KnowledgeBase migration failed:', error as Error)
      window.message.error(t('knowledge.migrate.error.failed') + ': ' + formatErrorMessage(error))
    }
  }, [newBase, migrateBase, resolve, t])

  if (!base) {
    resolve(null)
    return null
  }

  const onOk = async () => {
    if (hasCriticalChanges) {
      window.modal.confirm({
        title: t('knowledge.migrate.confirm.title'),
        content: (
          <Flex vertical align="self-start">
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
          </Flex>
        ),
        okText: t('knowledge.migrate.confirm.ok'),
        centered: true,
        onOk: handleEmbeddingModelChangeMigration
      })
    } else {
      try {
        logger.debug('newbase', newBase)
        updateKnowledgeBase(newBase)
        setOpen(false)
        resolve(newBase)
      } catch (error) {
        logger.error('KnowledgeBase edit failed:', error as Error)
        window.message.error(t('knowledge.error.failed_to_edit') + formatErrorMessage(error))
      }
    }
  }

  const onCancel = () => {
    setOpen(false)
    resolve(null)
  }

  const panelConfigs: PanelConfig[] = [
    {
      key: 'general',
      label: t('settings.general.label'),
      panel: (
        <GeneralSettingsPanel
          newBase={newBase}
          setNewBase={setNewBase}
          selectedDocPreprocessProvider={selectedDocPreprocessProvider}
          docPreprocessSelectOptions={docPreprocessSelectOptions}
          handlers={handlers}
        />
      )
    },
    {
      key: 'advanced',
      label: t('settings.advanced.title'),
      panel: <AdvancedSettingsPanel newBase={newBase} handlers={handlers} />
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
    />
  )
}

export default class EditKnowledgeBasePopup {
  static TopViewKey = 'EditKnowledgeBasePopup'

  static hide() {
    TopView.hide(this.TopViewKey)
  }

  static show(props: ShowParams): Promise<KnowledgeBase | null> {
    return new Promise<KnowledgeBase | null>((resolve) => {
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
