import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  Switch
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { SkillSourceBadge } from '@renderer/components/resourceCatalog/catalog'
import { SettingDescription, SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useSkillMutationsById } from '@renderer/hooks/resourceCatalog'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import type { SkillRemoteUpdateCheck } from '@shared/types/skill'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, MoreHorizontal, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { SkillFileBrowser, type SkillFileBrowserHandles } from './SkillFileBrowser'

const logger = loggerService.withContext('SkillDetails')

export function SkillDetails({ skillId }: { skillId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  const { data: skill, isLoading, error, refetch } = useQuery('/skills/:skillId', { params: { skillId } })
  const { updateGlobalEnabled, uninstallSkill, isUpdating } = useSkillMutationsById(skillId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [remoteCheck, setRemoteCheck] = useState<Extract<SkillRemoteUpdateCheck, { state: 'available' }> | null>(null)
  const [checkingRemote, setCheckingRemote] = useState(false)
  const [applyingRemote, setApplyingRemote] = useState(false)
  const [browserRevision, setBrowserRevision] = useState(0)
  const fileBrowserRef = useRef<SkillFileBrowserHandles>(null)
  const folder = useSWR(['skill.folder.resolve', skillId], () => ipcApi.request('skill.folder.resolve', { skillId }))

  useDataChange('/skills/:skillId', () => void refetch())

  const goBack = () => void navigate({ to: '/settings/skills' })

  const handleOpenFolder = async () => {
    try {
      await ipcApi.request('skill.folder.open', { skillId })
    } catch (error) {
      logger.error('Failed to open Skill folder', error as Error, { skillId })
      toast.error(t('library.skill_detail.open_folder_failed'))
    }
  }

  const handleToggle = async (checked: boolean) => {
    if (!skill) return
    try {
      await updateGlobalEnabled(checked)
    } catch (error) {
      logger.error('Failed to update Skill global state', error as Error, { skillId })
      toast.error(t('settings.skills.toggleFailed', { name: skill.name }))
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await uninstallSkill()
      setDeleteOpen(false)
      goBack()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.delete_failed'))
    } finally {
      setDeleting(false)
    }
  }

  const checkRemoteUpdate = async () => {
    setCheckingRemote(true)
    try {
      await fileBrowserRef.current?.flush()
      const result = await ipcApi.request('skill.remote.check', { skillId })
      if (result.state === 'unsupported') {
        toast.info({
          title: t('settings.skills.remote.unsupportedTitle'),
          description:
            result.reason === 'missing_provenance'
              ? t('settings.skills.remote.unsupported.missing_provenance')
              : t('settings.skills.remote.unsupported.not_remote')
        })
        return
      }
      if (result.state === 'up_to_date') {
        toast.success(
          result.localChanges
            ? t('settings.skills.remote.upToDateWithLocalChanges')
            : t('settings.skills.remote.upToDate')
        )
        return
      }
      setRemoteCheck(result)
    } catch (error) {
      logger.error('Failed to check Skill update', error as Error, { skillId })
      toast.error(t('settings.skills.remote.checkFailed'))
    } finally {
      setCheckingRemote(false)
    }
  }

  const applyRemoteUpdate = async () => {
    if (!remoteCheck) return
    setApplyingRemote(true)
    try {
      await fileBrowserRef.current?.flush()
      await ipcApi.request('skill.remote.apply', {
        skillId,
        revision: remoteCheck.revision,
        overwriteLocalChanges: remoteCheck.localChanges
      })
      setRemoteCheck(null)
      setBrowserRevision((current) => current + 1)
      await refetch()
      toast.success(t('settings.skills.remote.updated'))
    } catch (error) {
      if (error instanceof IpcError && error.code === skillErrorCodes.REMOTE_STALE) {
        setRemoteCheck(null)
        toast.info({
          title: t('settings.skills.remote.staleTitle'),
          description: t('settings.skills.remote.staleDescription')
        })
        setTimeout(() => void checkRemoteUpdate(), 0)
      } else {
        logger.error('Failed to apply Skill update', error as Error, { skillId })
        toast.error(t('settings.skills.remote.applyFailed'))
      }
    } finally {
      setApplyingRemote(false)
    }
  }

  if (isLoading) {
    return (
      <SettingsContentBody
        className="min-h-0 flex-1 overflow-hidden"
        innerClassName="flex min-h-0 max-w-5xl flex-1 flex-col gap-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="min-h-80 flex-1 rounded-xl" />
      </SettingsContentBody>
    )
  }

  if (!skill || error) {
    return (
      <SettingsContentBody className="min-h-0 flex-1">
        <EmptyState
          preset="no-resource"
          title={t('settings.skills.notFound')}
          description={error?.message}
          actionLabel={t('common.back')}
          onAction={goBack}
          className="min-h-80"
        />
      </SettingsContentBody>
    )
  }

  return (
    <SettingsContentBody
      className="min-h-0 flex-1 overflow-hidden pt-4"
      innerClassName="flex min-h-0 max-w-5xl flex-1 flex-col gap-4">
      <div
        data-ui="skill-detail-header"
        className="grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Button variant="ghost" size="icon-sm" aria-label={t('common.back')} onClick={goBack} className="shrink-0">
          <ArrowLeft size={18} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-foreground text-lg">{skill.name}</h1>
            {skill.version ? <span className="text-foreground-tertiary text-xs">{skill.version}</span> : null}
            <SkillSourceBadge source={skill.source} sourceUrl={skill.sourceUrl} />
            {folder.data?.access === 'read_only' ? (
              <Badge variant="secondary" className="border-0 bg-secondary text-muted-foreground">
                {t('settings.skills.readOnly')}
              </Badge>
            ) : null}
            <Switch
              size="sm"
              checked={skill.isGlobalEnabled}
              disabled={isUpdating}
              aria-label={t('settings.skills.globalToggle', { name: skill.name })}
              onCheckedChange={(checked) => void handleToggle(checked)}
            />
          </div>
          <SettingDescription className="mt-1 line-clamp-2 text-sm leading-5">
            {skill.description || t('library.skill_detail.no_description')}
          </SettingDescription>
        </div>
        <div
          data-ui="skill-detail-actions"
          className="col-start-2 flex shrink-0 items-center gap-1.5 lg:col-start-3 lg:row-start-1">
          <Button size="sm" onClick={() => void launchSkill(skill)} className="gap-1.5">
            <Play size={13} />
            {t('settings.skills.tryNow')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleOpenFolder()}>
                <FolderOpen size={14} />
                {t('library.skill_detail.open_folder')}
              </DropdownMenuItem>
              {skill.source === 'marketplace' ? (
                <DropdownMenuItem disabled={checkingRemote || applyingRemote} onSelect={() => void checkRemoteUpdate()}>
                  <RefreshCw className={checkingRemote ? 'animate-spin' : undefined} size={14} />
                  {checkingRemote ? t('settings.skills.remote.checking') : t('settings.skills.remote.check')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                {t('library.action.uninstall')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {folder.isLoading ? (
          <Skeleton className="h-full min-h-80 rounded-xl" />
        ) : folder.data ? (
          <SkillFileBrowser
            key={browserRevision}
            ref={fileBrowserRef}
            rootPath={folder.data.rootPath}
            skillId={skill.id}
            access={folder.data.access}
            disabled={applyingRemote}
          />
        ) : (
          <EmptyState
            preset="no-resource"
            title={t('library.skill_detail.no_files')}
            description={folder.error?.message}
            className="h-full min-h-80"
          />
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteOpen(false)
        }}
        title={t('library.delete.skill.title')}
        description={t('library.delete.skill.content')}
        confirmText={t('library.action.uninstall')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={remoteCheck !== null}
        onOpenChange={(open) => {
          if (!open && !applyingRemote) setRemoteCheck(null)
        }}
        title={t('settings.skills.remote.updateAvailableTitle')}
        description={
          remoteCheck?.localChanges
            ? t('settings.skills.remote.overwriteWarning')
            : t('settings.skills.remote.updateAvailableDescription', {
                version: remoteCheck?.remoteVersion ?? t('settings.skills.remote.unknownVersion')
              })
        }
        confirmText={t('settings.skills.remote.update')}
        cancelText={t('common.cancel')}
        destructive={remoteCheck?.localChanges ?? false}
        confirmLoading={applyingRemote}
        onConfirm={applyRemoteUpdate}
      />
    </SettingsContentBody>
  )
}
