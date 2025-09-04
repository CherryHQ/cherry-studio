import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import { useKnowledgeBaseForm } from '@renderer/hooks/useKnowledgeBaseForm'
import { KnowledgeBase, MigrationModeEnum } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import { Flex, Tag } from 'antd'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('MigrationInfoTag')

const MigrationInfoTag: FC<{ base: KnowledgeBase }> = ({ base: _base }) => {
  const { t } = useTranslation()
  const { migrateBase } = useKnowledge(_base.id)
  const { newBase } = useKnowledgeBaseForm(_base)

  // 处理嵌入模型更改迁移
  const handleMigration = useCallback(async () => {
    const migratedBase = { ...newBase, id: nanoid() }
    try {
      await migrateBase(migratedBase, MigrationModeEnum.MigrationToLangChain)
    } catch (error) {
      logger.error('KnowledgeBase migration failed:', error as Error)
      window.message.error(t('knowledge.migrate.error.failed') + ': ' + formatErrorMessage(error))
    }
  }, [newBase, migrateBase, t])

  const onClick = async () => {
    window.modal.confirm({
      title: t('knowledge.migrate.confirm.title'),
      content: (
        <Flex vertical align="self-start">
          <span>{t('knowledge.migrate.migrate_to_langchain.content')}</span>
        </Flex>
      ),
      okText: t('knowledge.migrate.confirm.ok'),
      centered: true,
      onOk: handleMigration
    })
  }

  return (
    <Tag
      color="blue"
      style={{
        borderRadius: 20,
        margin: 0,
        cursor: 'pointer'
      }}
      onClick={onClick}>
      {t('knowledge.migrate.migrate_to_langchain.info')}
    </Tag>
  )
}

export default MigrationInfoTag
