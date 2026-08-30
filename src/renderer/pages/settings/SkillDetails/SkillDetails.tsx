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
import { formatRelativeTime } from '@renderer/utils/time'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, MoreHorizontal, Play, ToolCase, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { SkillFileBrowser } from './SkillFileBrowser'

const logger = loggerService.withContext('SkillDetails')

export function SkillDetails({ skillId }: { skillId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  const { data: skill, isLoading, error, refetch } = useQuery('/skills/:skillId', { params: { skillId } })
  const { updateGlobalEnabled, uninstallSkill, isUpdating } = useSkillMutationsById(skillId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const folder = useSWR(['skill.folder.resolve', skillId], () => ipcApi.request('skill.folder.resolve', { skillId }))

  useDataChange('/skills/:skillId', () => void refetch())

  const locale = i18n.resolvedLanguage ?? i18n.language
  const updatedLabel = useMemo(() => (skill ? formatRelativeTime(skill.updatedAt, locale) : ''), [locale, skill])

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
      <div className="flex min-w-0 shrink-0 items-start gap-3">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={goBack} className="shrink-0">
          <ArrowLeft size={18} />
        </Button>
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info-subtle text-info-subtle-foreground">
          <ToolCase size={22} strokeWidth={1.5} className="lucide-custom" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-foreground text-lg">{skill.name}</h1>
            {skill.version ? <Badge variant="secondary">{skill.version}</Badge> : null}
            <SkillSourceBadge source={skill.source} />
            {folder.data?.access === 'read_only' ? (
              <Badge variant="secondary" className="border-0 bg-secondary text-muted-foreground">
                {t('settings.skills.readOnly')}
              </Badge>
            ) : null}
          </div>
          <SettingDescription className="mt-1 line-clamp-2 text-sm leading-5">
            {skill.description || t('library.skill_detail.no_description')}
          </SettingDescription>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {skill.sourceTags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-normal text-xs">
                {tag}
              </Badge>
            ))}
            <span className="text-foreground-tertiary text-xs">
              {t('library.skill_detail.updated_at')} {updatedLabel}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button size="sm" onClick={() => void launchSkill(skill)} className="gap-1.5">
            <Play size={13} />
            {t('settings.skills.tryNow')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleOpenFolder()} className="gap-1.5">
            <FolderOpen size={13} />
            {t('library.skill_detail.open_folder')}
          </Button>
          <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1">
            <span className="text-muted-foreground text-xs">{t('settings.skills.enabled')}</span>
            <Switch
              size="sm"
              checked={skill.isGlobalEnabled}
              disabled={isUpdating}
              aria-label={t('settings.skills.globalToggle', { name: skill.name })}
              onCheckedChange={(checked) => void handleToggle(checked)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                {t('library.action.uninstall')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {folder.isLoading ? (
          <Skeleton className="h-full min-h-80 rounded-xl" />
        ) : folder.data ? (
          <SkillFileBrowser rootPath={folder.data.rootPath} skillId={skill.id} />
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
    </SettingsContentBody>
  )
}
