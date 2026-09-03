import { Button, ConfirmDialog, SelectDropdown } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { type FileEntryRefCount, REF_COUNTS_MAX_ENTRY_IDS } from '@shared/data/api/schemas/files'
import { Bot, Check, File, Image, type LucideIcon, MessageSquare, MessagesSquare, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { PendingPermanentDelete } from './TrashSection'

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

type FileReferencePreview =
  | { status: 'idle' | 'loading' }
  | { status: 'error' }
  | { status: 'ready'; referencedFiles: number; totalReferences: number }

function getFileReferenceBlockedKey(fileCount: number, referenceCount: number) {
  if (fileCount === 1) {
    return referenceCount === 1
      ? 'settings.data.trash.file_refs.blocked_one_one'
      : 'settings.data.trash.file_refs.blocked_one_other'
  }
  return referenceCount === 1
    ? 'settings.data.trash.file_refs.blocked_other_one'
    : 'settings.data.trash.file_refs.blocked_other_other'
}

/** `0` = keep forever. */
const RETENTION_DAY_OPTIONS = [7, 30, 90, 0]

const TrashSettings: FC = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [retentionDays, setRetentionDays] = usePreference('data.trash.retention_days')
  const retentionOptions = useMemo(
    () =>
      RETENTION_DAY_OPTIONS.map((days) => ({
        id: String(days),
        label:
          days === 0
            ? t('settings.data.trash.retention.forever')
            : t('settings.data.trash.retention.days', { count: days })
      })),
    [t]
  )

  const [category, setCategory] = useState<TrashCategory>('topics')
  const [isBatchMode, setIsBatchMode] = useState(false)
  const categoryOptions = useMemo(
    () => CATEGORIES.map(({ id, labelKey, Icon }) => ({ id, label: t(labelKey), Icon })),
    [t]
  )
  const ActiveSection = SECTION_BY_CATEGORY[category]

  const [pendingDelete, setPendingDelete] = useState<PendingPermanentDelete | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [fileReferencePreview, setFileReferencePreview] = useState<FileReferencePreview>({ status: 'idle' })
  const referenceRequestToken = useRef(0)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [isEmptying, setIsEmptying] = useState(false)

  const closePendingDelete = useCallback(() => {
    referenceRequestToken.current += 1
    setPendingDelete(null)
    setFileReferencePreview({ status: 'idle' })
  }, [])

  const loadFileReferencePreview = useCallback(async (entryIds: string[]) => {
    const token = ++referenceRequestToken.current
    setFileReferencePreview({ status: 'loading' })
    try {
      const requests: Array<Promise<FileEntryRefCount[]>> = []
      for (let index = 0; index < entryIds.length; index += REF_COUNTS_MAX_ENTRY_IDS) {
        requests.push(
          dataApiService.get('/files/entries/ref-counts', {
            query: { entryIds: entryIds.slice(index, index + REF_COUNTS_MAX_ENTRY_IDS) }
          })
        )
      }
      const counts = (await Promise.all(requests)).flat()
      if (referenceRequestToken.current !== token) return
      setFileReferencePreview({
        status: 'ready',
        referencedFiles: counts.filter(({ refCount }) => refCount > 0).length,
        totalReferences: counts.reduce((total, { refCount }) => total + refCount, 0)
      })
    } catch (error) {
      if (referenceRequestToken.current !== token) return
      logger.error('file reference preview failed', error as Error)
      setFileReferencePreview({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    if (!pendingDelete?.fileEntryIds) {
      setFileReferencePreview({ status: 'idle' })
      return
    }
    void loadFileReferencePreview(pendingDelete.fileEntryIds)
    return () => {
      referenceRequestToken.current += 1
    }
  }, [loadFileReferencePreview, pendingDelete])

  const handleRequestDelete = (request: PendingPermanentDelete) => {
    setPendingDelete(request)
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    setIsDeleting(true)
    try {
      await pendingDelete.run(pendingDelete.items)
    } catch (error) {
      logger.error('permanent delete failed', error as Error)
      toast.error(t('settings.data.trash.permanent_delete.error'))
    } finally {
      setIsDeleting(false)
      closePendingDelete()
    }
  }

  const handleEmptyTrash = async () => {
    setIsEmptying(true)
    try {
      const { status, reclaimed } = await ipcApi.request('trash.purge_now')
      await invalidate(PURGE_INVALIDATE_PATHS)
      if (status === 'completed') {
        // The rows are gone either way, but the sweeps are batch-capped — do not
        // promise the disk space back when reclamation has not finished.
        toast.success(
          t(reclaimed ? 'settings.data.trash.empty_trash.success' : 'settings.data.trash.empty_trash.partial')
        )
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

  const sectionProps = {
    retentionDays,
    isBatchMode,
    isPermanentDeleting: isDeleting,
    onRequestDelete: handleRequestDelete
  }
  const isFilePreview = pendingDelete?.fileEntryIds !== undefined
  const fileReferenceBlocksDelete =
    isFilePreview && (fileReferencePreview.status !== 'ready' || fileReferencePreview.referencedFiles > 0)

  const fileReferenceContent = isFilePreview ? (
    <div className="text-sm">
      {fileReferencePreview.status === 'loading' && (
        <span className="text-muted-foreground">{t('settings.data.trash.file_refs.loading')}</span>
      )}
      {fileReferencePreview.status === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-error-subtle-foreground">{t('settings.data.trash.file_refs.error')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pendingDelete?.fileEntryIds && loadFileReferencePreview(pendingDelete.fileEntryIds)}>
            {t('settings.data.trash.file_refs.retry')}
          </Button>
        </div>
      )}
      {fileReferencePreview.status === 'ready' && fileReferencePreview.referencedFiles > 0 && (
        <span className="text-error-subtle-foreground">
          {t(getFileReferenceBlockedKey(fileReferencePreview.referencedFiles, fileReferencePreview.totalReferences), {
            count: fileReferencePreview.referencedFiles,
            records: fileReferencePreview.totalReferences
          })}
        </span>
      )}
    </div>
  ) : undefined

  return (
    <>
      <SettingTitle>
        <span>{t('settings.data.trash.title')}</span>
        <Button variant="outline" onClick={() => setEmptyTrashOpen(true)}>
          {t('settings.data.trash.empty_trash.button')}
        </Button>
      </SettingTitle>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitle>{t('settings.data.trash.retention.label')}</SettingRowTitle>
          <SelectDropdown
            items={retentionOptions}
            selectedId={String(retentionDays)}
            onSelect={(id) => setRetentionDays(Number(id))}
            triggerClassName="w-40 max-w-full"
            renderSelected={({ label }) => <span className="truncate">{label}</span>}
            renderItem={({ label }, isSelected) => (
              <div className="flex w-full items-center gap-2">
                <span className="flex-1 truncate">{label}</span>
                {isSelected && <Check size={16} className="shrink-0 text-primary" />}
              </div>
            )}
          />
        </SettingRow>
        <SettingHelpText>
          {retentionDays > 0
            ? t('settings.data.trash.retention_hint', { count: retentionDays })
            : t('settings.data.trash.retention_hint_never')}
        </SettingHelpText>
      </SettingGroup>
      <SettingGroup>
        <SettingRow>
          <SelectDropdown
            items={categoryOptions}
            selectedId={category}
            onSelect={(id) => {
              closePendingDelete()
              setCategory(id as TrashCategory)
            }}
            triggerClassName="w-56 max-w-full"
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
          <Button variant="outline" aria-pressed={isBatchMode} onClick={() => setIsBatchMode((current) => !current)}>
            {t(isBatchMode ? 'settings.data.trash.selection.done' : 'settings.data.trash.selection.manage')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <ActiveSection {...sectionProps} />
      </SettingGroup>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) closePendingDelete()
        }}
        destructive
        title={
          pendingDelete && pendingDelete.items.length > 1
            ? t('settings.data.trash.permanent_delete.batch_confirm_title', { count: pendingDelete.items.length })
            : t('settings.data.trash.permanent_delete.confirm_title')
        }
        description={t('settings.data.trash.permanent_delete.confirm_content')}
        content={fileReferenceContent}
        confirmText={t('settings.data.trash.permanent_delete.label')}
        cancelText={t('common.cancel')}
        confirmLoading={isDeleting}
        confirmDisabled={fileReferenceBlocksDelete}
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
