import { Button, ConfirmDialog } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { SettingDivider, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AgentTrashSection,
  AssistantTrashSection,
  FileTrashSection,
  PaintingTrashSection,
  SessionTrashSection,
  TopicTrashSection
} from './TrashDomainSections'
import type { TrashItem } from './trashUtils'

const logger = loggerService.withContext('TrashSettings')

const PURGE_INVALIDATE_PATHS = [
  '/topics',
  '/topics/*',
  '/agents',
  '/agents/*',
  '/agent-sessions',
  '/agent-sessions/*',
  '/assistants',
  '/assistants/*',
  '/paintings',
  '/paintings/*',
  '/files/entries',
  '/files/entries/*'
]

interface PendingDelete {
  item: TrashItem
  deleteItem: (item: TrashItem) => Promise<void>
}

const TrashSettings: FC = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [retentionDays] = usePreference('data.trash.retention_days')

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [isEmptying, setIsEmptying] = useState(false)

  const handleRequestDelete = (item: TrashItem, deleteItem: (item: TrashItem) => Promise<void>) => {
    setPendingDelete({ item, deleteItem })
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      await pendingDelete.deleteItem(pendingDelete.item)
    } finally {
      setIsDeleting(false)
      setPendingDelete(null)
    }
  }

  const handleEmptyTrash = async () => {
    setIsEmptying(true)
    try {
      const { status } = await ipcApi.request('trash.purge_now')
      await invalidate(PURGE_INVALIDATE_PATHS)
      if (status === 'completed') {
        window.toast.success(t('settings.data.trash.empty_trash.success'))
      } else {
        logger.error(`empty trash finished with non-completed status: ${status}`)
        window.toast.error(t('settings.data.trash.empty_trash.error'))
      }
    } catch (error) {
      logger.error('empty trash failed', error as Error)
      window.toast.error(t('settings.data.trash.empty_trash.error'))
    } finally {
      setIsEmptying(false)
      setEmptyTrashOpen(false)
    }
  }

  const sectionProps = { retentionDays, onRequestDelete: handleRequestDelete }

  return (
    <>
      <SettingGroup>
        <SettingTitle>
          <span>{t('settings.data.trash.title')}</span>
          <Button variant="outline" onClick={() => setEmptyTrashOpen(true)}>
            {t('settings.data.trash.empty_trash.button')}
          </Button>
        </SettingTitle>
        <SettingDivider />
        <SettingHelpText>
          {retentionDays > 0
            ? t('settings.data.trash.retention_hint', { days: retentionDays })
            : t('settings.data.trash.retention_hint_never')}
        </SettingHelpText>
      </SettingGroup>
      <TopicTrashSection {...sectionProps} />
      <AgentTrashSection {...sectionProps} />
      <SessionTrashSection {...sectionProps} />
      <AssistantTrashSection {...sectionProps} />
      <PaintingTrashSection {...sectionProps} />
      <FileTrashSection {...sectionProps} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null)
        }}
        destructive
        title={t('settings.data.trash.permanent_delete.confirm_title')}
        description={t('settings.data.trash.permanent_delete.confirm_content', {
          name: pendingDelete?.item.name || t('settings.data.trash.unnamed')
        })}
        confirmText={t('settings.data.trash.permanent_delete.label')}
        cancelText={t('common.cancel')}
        confirmLoading={isDeleting}
        onConfirm={handleConfirmDelete}
      />
      <ConfirmDialog
        open={emptyTrashOpen}
        onOpenChange={(open) => {
          if (!open && !isEmptying) setEmptyTrashOpen(false)
        }}
        destructive
        title={t('settings.data.trash.empty_trash.confirm_title')}
        description={t('settings.data.trash.empty_trash.confirm_content')}
        confirmText={t('settings.data.trash.empty_trash.button')}
        cancelText={t('common.cancel')}
        confirmLoading={isEmptying}
        onConfirm={handleEmptyTrash}
      />
    </>
  )
}

export default TrashSettings
