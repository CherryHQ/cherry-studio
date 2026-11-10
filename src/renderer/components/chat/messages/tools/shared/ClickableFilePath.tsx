import { Icon } from '@iconify/react'
import { Copy, FileText, Save } from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { getOpenTargetBadge, getOpenTargetLabel, OpenTargetIcon } from '@renderer/components/OpenTarget'
import { useExternalOpenTargets } from '@renderer/hooks/useExternalOpenTargets'
import { ipcApi } from '@renderer/ipc'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { isMac, isWin } from '@renderer/utils/platform'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { useOptionalMessageListActions } from '../../MessageListProvider'

interface ClickableFilePathProps {
  path: string
  displayName?: string
  interactive?: boolean
  preserveWrappingPunctuation?: boolean
}

export const ClickableFilePath = memo(function ClickableFilePath({
  path,
  displayName,
  interactive = true,
  preserveWrappingPunctuation = false
}: ClickableFilePathProps) {
  const { t } = useTranslation()
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const displayPath = useMemo(
    () => (preserveWrappingPunctuation ? path : normalizeInlineFilePath(path)),
    [path, preserveWrappingPunctuation]
  )
  const unresolvedTargetPath = useMemo(
    () => resolveInlineFilePath(path, { preserveWrappingPunctuation }),
    [path, preserveWrappingPunctuation]
  )
  const iconName = useMemo(() => getFileIconName(displayPath), [displayPath])
  const actions = useOptionalMessageListActions()
  const resolvePath = actions?.resolvePath
  const targetPath = useMemo(
    () => resolvePath?.(unresolvedTargetPath) ?? unresolvedTargetPath,
    [resolvePath, unresolvedTargetPath]
  )
  const openArtifactFile = interactive ? actions?.openArtifactFile : undefined
  const openPath = interactive ? actions?.openPath : undefined
  const isDirectory = interactive ? actions?.isDirectory : undefined
  const notifyError = actions?.notifyError
  const canOpen = Boolean(openArtifactFile || openPath)
  const hasAbsoluteTargetPath = AbsoluteFilePathSchema.safeParse(targetPath).success
  const { isLoading, targets, openTarget } = useExternalOpenTargets(targetPath, 'file', {
    enabled: canOpen && hasAbsoluteTargetPath && actionsMenuOpen
  })
  const hasMoreActions = canOpen && hasAbsoluteTargetPath
  const { data: metadata } = useSWR(
    actionsMenuOpen && hasMoreActions ? ['file-context-metadata', targetPath] : null,
    ([, path]) => ipcApi.request('file.get_metadata', createFilePathHandle(AbsoluteFilePathSchema.parse(path))),
    { shouldRetryOnError: false }
  )
  const applicationTargets = targets.filter((target) => target.kind !== 'file_manager')
  const revealLabel = isMac
    ? t('chat.input.tools.reveal_in_finder')
    : isWin
      ? t('chat.input.tools.reveal_in_file_explorer')
      : t('chat.input.tools.reveal_in_file_manager')

  const handleCopy = async (content: boolean) => {
    try {
      const text = content ? await window.api.fs.readText(targetPath) : targetPath
      await navigator.clipboard.writeText(text)
      actions?.notifySuccess?.(t('message.copy.success'))
    } catch {
      notifyError?.(t('message.copy.failed'))
    }
  }

  const handleReveal = async () => {
    try {
      await ipcApi.request('file.show_in_folder', createFilePathHandle(AbsoluteFilePathSchema.parse(targetPath)))
    } catch {
      notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
    }
  }

  const handleSaveAs = async () => {
    try {
      const { content } = await ipcApi.request('file.read', {
        handle: createFilePathHandle(AbsoluteFilePathSchema.parse(targetPath)),
        options: { mode: 'full', encoding: 'binary' }
      })
      const fileName = targetPath.split(/[/\\]/).at(-1) ?? targetPath
      const savedPath = await window.api.file.save(fileName, content)
      if (savedPath) actions?.notifySuccess?.(t('common.saved'))
    } catch {
      notifyError?.(t('common.save_failed'))
    }
  }

  const handleOpenTarget = useCallback(
    (target: ExternalOpenTarget) => {
      void openTarget(target).catch(() => {
        notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [notifyError, openTarget, t, targetPath]
  )

  const handleOpen = useCallback(
    async (e?: React.MouseEvent | React.KeyboardEvent) => {
      if (!canOpen) return
      e?.stopPropagation()
      // Each action takes the unresolved path and resolves it itself — the pane and `isDirectory`
      // against the workspace, `openPath` in main. `targetPath` is left for the menu and the toast.
      await openFileTarget(unresolvedTargetPath, {
        openArtifactFile,
        openPath,
        isDirectory,
        onError: () => notifyError?.(t('chat.input.tools.open_file_error', { path: targetPath }))
      })
    },
    [canOpen, isDirectory, notifyError, openArtifactFile, openPath, t, targetPath, unresolvedTargetPath]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        void handleOpen(e)
      }
    },
    [handleOpen]
  )

  return (
    <ContextMenu onOpenChange={setActionsMenuOpen}>
      <Tooltip asChild content={targetPath} delay={500}>
        <ContextMenuTrigger
          asChild
          disabled={!hasMoreActions}
          onContextMenu={hasMoreActions ? (e) => e.stopPropagation() : undefined}>
          <span
            role={canOpen ? 'link' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            onClick={canOpen ? handleOpen : undefined}
            onKeyDown={canOpen ? handleKeyDown : undefined}
            className={`break-all [table_&]:break-normal ${
              canOpen ? 'cursor-pointer text-link hover:underline' : 'cursor-default text-muted-foreground'
            }`}>
            <Icon
              icon={`material-icon-theme:${iconName}`}
              className="mr-1 inline-block align-text-top"
              style={{ fontSize: '1.1em' }}
            />
            {displayName ?? displayPath}
          </span>
        </ContextMenuTrigger>
      </Tooltip>
      {hasMoreActions && (
        <ContextMenuContent className="w-56" onClick={(e) => e.stopPropagation()}>
          <ContextMenuItem onSelect={() => void handleOpen()}>
            <ContextMenuItemContent icon={<FileText />}>{t('common.open')}</ContextMenuItemContent>
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!isLoading && applicationTargets.length === 0}>
              {t('chat.input.tools.open_with')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {isLoading && applicationTargets.length === 0 && (
                <ContextMenuItem disabled>{t('common.loading')}</ContextMenuItem>
              )}
              {applicationTargets.map((target) => (
                <ContextMenuItem key={target.id} onSelect={() => handleOpenTarget(target)}>
                  <ContextMenuItemContent
                    icon={<OpenTargetIcon target={target} />}
                    badge={getOpenTargetBadge(target, t)}>
                    {getOpenTargetLabel(target, t)}
                  </ContextMenuItemContent>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => void handleReveal()}>
            <ContextMenuItemContent icon={<OpenTargetIcon target={{ id: 'file_manager', kind: 'file_manager' }} />}>
              {revealLabel}
            </ContextMenuItemContent>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void handleCopy(false)}>
            <ContextMenuItemContent icon={<Copy />}>{t('agent.preview_pane.copy_path')}</ContextMenuItemContent>
          </ContextMenuItem>
          {metadata?.kind === 'file' && (
            <>
              <ContextMenuItem disabled={metadata.type !== 'text'} onSelect={() => void handleCopy(true)}>
                <ContextMenuItemContent icon={<FileText />}>
                  {t('chat.input.tools.copy_file_content')}
                </ContextMenuItemContent>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => void handleSaveAs()}>
                <ContextMenuItemContent icon={<Save />}>{t('preview.save_as')}</ContextMenuItemContent>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
})
