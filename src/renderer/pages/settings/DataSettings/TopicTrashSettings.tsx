import dayjs from 'dayjs'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmptyState } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

const logger = loggerService.withContext('TopicTrashSettings')

const TopicTrashSettings: React.FC = () => {
  const { t } = useTranslation()

  const { data: trashedTopics, isLoading, mutate } = useQuery('/topics/trash')

  const { trigger: restoreTrigger } = useMutation('POST', '/topics/:id/restore', {
    refresh: ['/topics', '/topics/trash']
  })
  const { trigger: purgeTrigger } = useMutation('DELETE', '/topics/trash/:id', {
    refresh: ['/topics/trash']
  })
  const { trigger: emptyTrashTrigger, isLoading: isEmptying } = useMutation('DELETE', '/topics/trash', {
    refresh: ['/topics/trash']
  })

  const handleRestore = useCallback(
    async (id: string, name: string) => {
      try {
        await restoreTrigger({ params: { id } })
        toast.success(t('common.success'))
        logger.info('Restored topic', { id, name })
      } catch (err) {
        logger.error('Failed to restore topic', err as Error)
        toast.error(t('common.error'))
      }
    },
    [restoreTrigger, t]
  )

  const handlePurge = useCallback(
    async (id: string, name: string) => {
      const confirmed = await popup.confirm({
        title: t('settings.data.topic_trash.delete_permanently'),
        content: t('settings.data.topic_trash.confirm_delete')
      })
      if (!confirmed) return
      try {
        await purgeTrigger({ params: { id } })
        logger.info('Permanently purged topic', { id, name })
      } catch (err) {
        logger.error('Failed to purge topic', err as Error)
        toast.error(t('common.error'))
      }
    },
    [purgeTrigger, t]
  )

  const handleEmptyTrash = useCallback(async () => {
    const confirmed = await popup.confirm({
      title: t('settings.data.topic_trash.empty_trash'),
      content: t('settings.data.topic_trash.confirm_empty')
    })
    if (!confirmed) return
    try {
      const result = await emptyTrashTrigger({})
      logger.info('Emptied trash', { purgedCount: result.purgedCount })
      void mutate()
    } catch (err) {
      logger.error('Failed to empty trash', err as Error)
      toast.error(t('common.error'))
    }
  }, [emptyTrashTrigger, mutate, t])

  const topics = trashedTopics ?? []

  return (
    <div className="flex flex-col gap-6">
      <SettingTitle>{t('settings.data.topic_trash.title')}</SettingTitle>
      <SettingGroup>
        <div className="flex items-center justify-between">
          <SettingHelpText>{t('settings.data.topic_trash.retention_note')}</SettingHelpText>
          {topics.length > 0 && (
            <Button variant="destructive" size="sm" onClick={() => void handleEmptyTrash()} disabled={isEmptying}>
              <Trash2 size={14} className="mr-1" />
              {t('settings.data.topic_trash.empty_trash')}
            </Button>
          )}
        </div>
      </SettingGroup>

      {isLoading ? null : topics.length === 0 ? (
        <EmptyState description={t('settings.data.topic_trash.empty')} />
      ) : (
        <div className="flex flex-col gap-1">
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-[var(--color-background-soft)]">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{topic.name || <em>{topic.id}</em>}</span>
                <span className="text-xs text-[var(--foreground-tertiary)]">
                  {t('settings.data.topic_trash.deleted_at')}: {dayjs(topic.deletedAt).format('YYYY-MM-DD HH:mm')}
                </span>
              </div>
              <div className="ml-3 flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRestore(topic.id, topic.name)}
                  title={t('settings.data.topic_trash.restore')}>
                  <RotateCcw size={14} className="mr-1" />
                  {t('settings.data.topic_trash.restore')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handlePurge(topic.id, topic.name)}
                  title={t('settings.data.topic_trash.delete_permanently')}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TopicTrashSettings
