import { Button, ConfirmDialog, SelectDropdown } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { SettingDivider, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { Bot, Check, File, Image, type LucideIcon, MessageSquare, MessagesSquare, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AgentTrashSection,
  AssistantTrashSection,
  FileTrashSection,
  PaintingTrashSection,
  SessionTrashSection,
  TopicTrashSection,
  type TrashDomainSectionProps
} from './TrashDomainSections'
import type { TrashItem } from './trashUtils'

const logger = loggerService.withContext('TrashSettings')

type TrashCategory = 'topics' | 'agents' | 'sessions' | 'assistants' | 'paintings' | 'files'

const CATEGORIES: { id: TrashCategory; labelKey: string; Icon: LucideIcon }[] = [
  { id: 'topics', labelKey: 'settings.data.trash.domain.topics', Icon: MessageSquare },
  { id: 'agents', labelKey: 'settings.data.trash.domain.agents', Icon: Bot },
  { id: 'sessions', labelKey: 'settings.data.trash.domain.sessions', Icon: MessagesSquare },
  { id: 'assistants', labelKey: 'settings.data.trash.domain.assistants', Icon: Sparkles },
  { id: 'paintings', labelKey: 'settings.data.trash.domain.paintings', Icon: Image },
  { id: 'files', labelKey: 'settings.data.trash.domain.files', Icon: File }
]

const SECTION_BY_CATEGORY: Record<TrashCategory, FC<TrashDomainSectionProps>> = {
  topics: TopicTrashSection,
  agents: AgentTrashSection,
  sessions: SessionTrashSection,
  assistants: AssistantTrashSection,
  paintings: PaintingTrashSection,
  files: FileTrashSection
}

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

  const [category, setCategory] = useState<TrashCategory>('topics')
  const categoryOptions = useMemo(
    () => CATEGORIES.map(({ id, labelKey, Icon }) => ({ id, label: t(labelKey), Icon })),
    [t]
  )
  const ActiveSection = SECTION_BY_CATEGORY[category]

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
        toast.success(t('settings.data.trash.empty_trash.success'))
      } else {
        logger.error(`empty trash finished with non-completed status: ${status}`)
        toast.error(t('settings.data.trash.empty_trash.error'))
      }
    } catch (error) {
      logger.error('empty trash failed', error as Error)
      toast.error(t('settings.data.trash.empty_trash.error'))
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
        <div className="mt-3">
          <SelectDropdown
            items={categoryOptions}
            selectedId={category}
            onSelect={(id) => setCategory(id as TrashCategory)}
            triggerClassName="w-56"
            renderSelected={({ label, Icon }) => (
              <>
                <Icon size={16} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </>
            )}
            renderItem={({ label, Icon }, isSelected) => (
              <div className="flex w-full items-center gap-2">
                <Icon size={16} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{label}</span>
                {isSelected && <Check size={16} className="shrink-0 text-primary" />}
              </div>
            )}
          />
        </div>
      </SettingGroup>
      <ActiveSection {...sectionProps} />
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
