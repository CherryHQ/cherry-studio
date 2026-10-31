import { Check, MoreHorizontal, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SelectDropdown,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { type FileEntryRefCount, REF_COUNTS_MAX_ENTRY_IDS } from '@shared/data/api/schemas/files'
import type { FileRef } from '@shared/data/types/file'

import AllArchiveSection from './AllArchiveSection'
import {
  AgentArchiveSection,
  AssistantArchiveSection,
  FileArchiveSection,
  PaintingArchiveSection,
  SessionArchiveSection,
  TopicArchiveSection,
  type ArchiveDomainSectionProps
} from './ArchiveDomainSections'
import type { PendingPermanentDelete } from './ArchiveSection'

const logger = loggerService.withContext('ArchiveSettings')

type ArchiveCategory = 'all' | 'topics' | 'agents' | 'sessions' | 'assistants' | 'paintings' | 'files'

const CATEGORIES: { id: ArchiveCategory; labelKey: string }[] = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'assistants', labelKey: 'settings.data.trash.domain.assistants' },
  { id: 'agents', labelKey: 'settings.data.trash.domain.agents' },
  { id: 'topics', labelKey: 'settings.data.trash.domain.topics' },
  { id: 'sessions', labelKey: 'settings.data.trash.domain.sessions' },
  { id: 'paintings', labelKey: 'settings.data.trash.domain.paintings' },
  { id: 'files', labelKey: 'settings.data.trash.domain.files' }
]

const SECTION_BY_CATEGORY: Record<ArchiveCategory, FC<ArchiveDomainSectionProps>> = {
  all: AllArchiveSection,
  topics: TopicArchiveSection,
  agents: AgentArchiveSection,
  sessions: SessionArchiveSection,
  assistants: AssistantArchiveSection,
  paintings: PaintingArchiveSection,
  files: FileArchiveSection
}

const PURGE_INVALIDATE_PATHS = [
  '/archives',
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
  | {
      status: 'ready'
      referencedFiles: number
      totalReferences: number
      refsByEntryId: Map<string, FileRef[]>
      jobTypesById: Map<string, string | null>
    }

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

const ArchiveSettings: FC = () => {
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

  const [category, setCategory] = useState<ArchiveCategory>('all')
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [batchToolbarContainer, setBatchToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [canBatchManage, setCanBatchManage] = useState(false)
  const ActiveSection = SECTION_BY_CATEGORY[category]

  const [pendingDelete, setPendingDelete] = useState<PendingPermanentDelete | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [fileReferencePreview, setFileReferencePreview] = useState<FileReferencePreview>({ status: 'idle' })
  const referenceRequestToken = useRef(0)
  const [emptyArchiveOpen, setEmptyArchiveOpen] = useState(false)
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
      const referencedIds = new Set(counts.filter(({ refCount }) => refCount > 0).map(({ entryId }) => entryId))
      const referencedEntryIds = entryIds.filter((entryId) => referencedIds.has(entryId))
      const refsByEntryId = new Map<string, FileRef[]>()
      for (let index = 0; index < referencedEntryIds.length; index += 8) {
        if (referenceRequestToken.current !== token) return
        const wave = referencedEntryIds.slice(index, index + 8)
        const results = await Promise.allSettled(
          wave.map((entryId) => dataApiService.get(`/files/entries/${entryId}/refs`) as Promise<FileRef[]>)
        )
        if (referenceRequestToken.current !== token) return
        for (const [offset, result] of results.entries()) {
          if (result.status === 'rejected') throw result.reason
          if (result.value.length === 0) throw new Error('Referenced file no longer has reference details')
          refsByEntryId.set(wave[offset], result.value)
        }
      }
      const jobIds = [
        ...new Set(
          [...refsByEntryId.values()]
            .flat()
            .filter((ref) => ref.sourceType === 'job')
            .map((ref) => ref.sourceId)
        )
      ]
      const jobTypesById = new Map<string, string | null>()
      for (let index = 0; index < jobIds.length; index += 8) {
        if (referenceRequestToken.current !== token) return
        const wave = jobIds.slice(index, index + 8)
        const results = await Promise.allSettled(
          wave.map((jobId) => dataApiService.get(`/jobs/${jobId}`).then(({ type }) => type))
        )
        if (referenceRequestToken.current !== token) return
        for (const [offset, result] of results.entries()) {
          jobTypesById.set(wave[offset], result.status === 'fulfilled' ? result.value : null)
        }
      }
      if (referenceRequestToken.current !== token) return
      setFileReferencePreview({
        status: 'ready',
        refsByEntryId,
        jobTypesById,
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

  const handleEmptyArchive = async () => {
    setIsEmptying(true)
    try {
      const { status, reclaimed, deletedCount, retainedReferencedFileCount } = await ipcApi.request('trash.purge_now')
      await invalidate(PURGE_INVALIDATE_PATHS)
      if (status === 'completed') {
        toast.success(
          retainedReferencedFileCount > 0
            ? t('settings.data.trash.empty_trash.retained', {
                deleted: deletedCount,
                count: retainedReferencedFileCount
              })
            : t(reclaimed ? 'settings.data.trash.empty_trash.success' : 'settings.data.trash.empty_trash.partial')
        )
        if (retainedReferencedFileCount > 0 && !reclaimed) {
          toast.info(t('settings.data.trash.empty_trash.partial'))
        }
      } else {
        logger.error(`empty trash finished with non-completed status: ${status}`)
        toast.error(t('settings.data.trash.empty_trash.error'))
      }
    } catch (error) {
      logger.error('empty trash failed', error as Error)
      toast.error(t('settings.data.trash.empty_trash.error'))
    } finally {
      setIsEmptying(false)
      setEmptyArchiveOpen(false)
    }
  }

  const sectionProps = {
    onBatchAvailabilityChange: setCanBatchManage,
    retentionDays,
    isBatchMode,
    batchToolbarContainer,
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
        <div className="max-h-[50vh] space-y-3 overflow-y-auto break-words">
          <p className="text-error-subtle-foreground">
            {t(getFileReferenceBlockedKey(fileReferencePreview.referencedFiles, fileReferencePreview.totalReferences), {
              count: fileReferencePreview.referencedFiles,
              records: fileReferencePreview.totalReferences
            })}
          </p>
          {pendingDelete.items.map((item) => {
            const entryId = category === 'all' ? (item.id.startsWith('files:') ? item.id.slice(6) : undefined) : item.id
            const refs = entryId ? fileReferencePreview.refsByEntryId.get(entryId) : undefined
            if (!refs) return null
            return (
              <section key={item.id} aria-label={item.name} className="space-y-1">
                <p className="font-medium">{item.name}</p>
                <ul className="space-y-1 text-muted-foreground">
                  {refs.map((ref) => {
                    const type = fileReferencePreview.jobTypesById.get(ref.sourceId)
                    const role = 'role' in ref ? ref.role : '—'
                    const key =
                      ref.sourceType !== 'job'
                        ? 'settings.data.trash.file_refs.holder_other'
                        : type == null
                          ? 'settings.data.trash.file_refs.holder_job_unresolved'
                          : type === 'image-generation.generate' && role === 'input'
                            ? 'settings.data.trash.file_refs.holder_image_input'
                            : type === 'image-generation.generate' && role === 'mask'
                              ? 'settings.data.trash.file_refs.holder_image_mask'
                              : 'settings.data.trash.file_refs.holder_job'
                    return <li key={ref.id}>{t(key, { id: ref.sourceId, type, role, sourceType: ref.sourceType })}</li>
                  })}
                </ul>
              </section>
            )
          })}
          {[...fileReferencePreview.jobTypesById.values()].includes('image-generation.generate') && (
            <p className="text-muted-foreground">{t('settings.data.trash.file_refs.job_release')}</p>
          )}
        </div>
      )}
    </div>
  ) : undefined

  return (
    <SettingsContentColumn>
      <SettingGroup>
        <SettingTitle className="flex-wrap gap-3">
          <span>{t('settings.data.trash.title')}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.more')} title={t('common.more')}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setEmptyArchiveOpen(true)}>
                <Trash2 />
                {t('settings.data.trash.empty_trash.button')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SettingTitle>
        <Tabs
          className="mt-2"
          variant="underline"
          value={category}
          onValueChange={(value) => {
            closePendingDelete()
            setCanBatchManage(false)
            setCategory(value as ArchiveCategory)
          }}>
          <div className="flex items-center justify-between gap-4 border-border border-b">
            <div
              hidden={isBatchMode}
              className={isBatchMode ? 'hidden' : '-mb-px flex min-w-0 items-center overflow-x-auto'}>
              <TabsList aria-label={t('settings.data.trash.title')}>
                {CATEGORIES.map(({ id, labelKey }) => (
                  <TabsTrigger key={id} value={id} className="py-3">
                    {t(labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div ref={setBatchToolbarContainer} className={isBatchMode ? 'min-w-0 flex-1' : 'hidden'} />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!isBatchMode && !canBatchManage}
              aria-pressed={isBatchMode}
              onClick={() => setIsBatchMode((current) => !current)}>
              {t(isBatchMode ? 'settings.data.trash.selection.done' : 'settings.data.trash.selection.manage')}
            </Button>
          </div>
          <TabsContent key={category} value={category}>
            <ActiveSection {...sectionProps} />
          </TabsContent>
        </Tabs>
      </SettingGroup>
      <SettingGroup>
        <SettingRow role="group" aria-label={t('settings.data.trash.retention.label')}>
          <SettingRowTitle>{t('settings.data.trash.retention.label')}</SettingRowTitle>
          <SelectDropdown
            items={retentionOptions}
            selectedId={String(retentionDays)}
            onSelect={(id) => setRetentionDays(Number(id))}
            triggerClassName="h-8 w-28 max-w-full gap-2 px-2"
            renderSelected={({ label }) => <span className="truncate">{label}</span>}
            renderItem={({ label }, isSelected) => (
              <div className="flex w-full items-center gap-2">
                <span className="flex-1 truncate">{label}</span>
                {isSelected && <Check size={16} className="shrink-0 text-primary" />}
              </div>
            )}
          />
        </SettingRow>
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
        open={emptyArchiveOpen}
        onOpenChange={(open) => {
          if (!open && !isEmptying) setEmptyArchiveOpen(false)
        }}
        destructive
        title={t('settings.data.trash.empty_trash.confirm_title')}
        description={t('settings.data.trash.empty_trash.confirm_content')}
        confirmText={t('settings.data.trash.empty_trash.button')}
        cancelText={t('common.cancel')}
        confirmLoading={isEmptying}
        onConfirm={handleEmptyArchive}
      />
    </SettingsContentColumn>
  )
}

export default ArchiveSettings
